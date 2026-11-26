"use server";

import { assertFeature } from "@/lib/upgrades/server";
import { revalidatePath } from "next/cache";
import { familyAdminDb, familyDb } from "@/lib/family/db";
import { fail, failDb, myFamilyIds, ok, requireMember, type FamilyResult } from "@/lib/family/action-helpers";
import { carpoolOfferSchema, carpoolRequestSchema, uuid, type CarpoolOfferInput, type CarpoolRequestInput } from "@/lib/family/validation";
import { notifyMembers } from "@/lib/family/notify";
import { threadPath } from "@/lib/messaging/paths";

function revalidateCarpool(eventId: string) {
  for (const base of ["/parent/carpool", "/coach/carpool", "/admin/carpool"]) {
    revalidatePath(base);
    revalidatePath(`${base}/${eventId}`);
  }
}

/** Which of my families has a child on this event's roster (team roster, or RSVP for club-wide events)? */
async function rosterFamily(me: { id: string; orgId: string }, eventId: string): Promise<{ familyId: string; open: boolean } | null> {
  const db = familyAdminDb();
  const { data: ev } = await db.from("events").select("id,team_id,status,ends_at").eq("id", eventId).eq("org_id", me.orgId).maybeSingle();
  if (!ev) return null;
  const mine = await myFamilyIds(me);
  if (!mine.length) return null;
  let athleteIds: string[] = [];
  if (ev.team_id) {
    const { data } = await db.from("team_memberships").select("athlete_id").eq("org_id", me.orgId).eq("team_id", ev.team_id).neq("status", "inactive");
    athleteIds = (data ?? []).map((r) => r.athlete_id);
  } else {
    const { data } = await db.from("event_rsvps").select("athlete_id").eq("org_id", me.orgId).eq("event_id", ev.id);
    athleteIds = (data ?? []).map((r) => r.athlete_id);
  }
  if (!athleteIds.length) return null;
  const { data: ath } = await db.from("athletes").select("family_id").eq("org_id", me.orgId).in("id", athleteIds).in("family_id", mine).limit(1).maybeSingle();
  if (!ath) return null;
  return { familyId: ath.family_id, open: ev.status !== "cancelled" && Date.parse(ev.ends_at) > Date.now() };
}

export async function postCarpoolOffer(input: CarpoolOfferInput): Promise<FamilyResult> {
  await assertFeature("carpooling");
  const me = await requireMember();
  if (!me) return fail("forbidden");
  const p = carpoolOfferSchema.safeParse(input);
  if (!p.success) return fail("invalid");
  const fam = await rosterFamily(me, p.data.eventId);
  if (!fam) return fail("notOnRoster");
  if (!fam.open) return fail("EVENT_CLOSED");
  const db = await familyDb();
  const { error } = await db.from("carpool_offers").insert({
    org_id: me.orgId, event_id: p.data.eventId, family_id: fam.familyId, profile_id: me.id, from_area: p.data.fromArea,
    departs_at: new Date(p.data.departsAt).toISOString(), seats_total: p.data.seats, return_trip: p.data.returnTrip, note: p.data.note,
  });
  if (error) return failDb("family.carpool.offer", error);
  revalidateCarpool(p.data.eventId);
  return ok("family.messages.offerPosted");
}

export async function postCarpoolRequest(input: CarpoolRequestInput): Promise<FamilyResult> {
  await assertFeature("carpooling");
  const me = await requireMember();
  if (!me) return fail("forbidden");
  const p = carpoolRequestSchema.safeParse(input);
  if (!p.success) return fail("invalid");
  const fam = await rosterFamily(me, p.data.eventId);
  if (!fam) return fail("notOnRoster");
  if (!fam.open) return fail("EVENT_CLOSED");
  const db = await familyDb();
  const { error } = await db.from("carpool_requests").insert({
    org_id: me.orgId, event_id: p.data.eventId, family_id: fam.familyId, profile_id: me.id, from_area: p.data.fromArea,
    seats_needed: p.data.seats, return_trip: p.data.returnTrip, note: p.data.note,
  });
  if (error) return failDb("family.carpool.request", error);
  revalidateCarpool(p.data.eventId);
  return ok("family.messages.requestPosted");
}

/** Withdraw my offer or request (an admin may withdraw any); live matches on it are cancelled. */
export async function withdrawCarpoolPost(input: { kind: "offer" | "request"; id: string }): Promise<FamilyResult> {
  await assertFeature("carpooling");
  const me = await requireMember();
  if (!me) return fail("forbidden");
  if (!uuid.safeParse(input.id).success || !["offer", "request"].includes(input.kind)) return fail("invalid");
  const db = await familyDb();
  const table = input.kind === "offer" ? "carpool_offers" : "carpool_requests";
  const { data: row } = await db.from(table).select("id,event_id").eq("id", input.id).maybeSingle();
  if (!row) return fail("NOT_FOUND");
  const { data: matches } = await db.from("carpool_matches").select("id").eq(input.kind === "offer" ? "offer_id" : "request_id", input.id).eq("status", "confirmed");
  for (const m of matches ?? []) {
    const { error } = await db.rpc("carpool_cancel_match", { p_match: m.id });
    if (error) return failDb("family.carpool.withdraw", error);
  }
  const { data: upd, error } = await db.from(table).update({ status: "cancelled" }).eq("id", input.id).select("id");
  if (error) return failDb("family.carpool.withdraw", error);
  if (!upd?.length) return fail("NOT_ALLOWED");
  revalidateCarpool(row.event_id);
  return ok("family.messages.postWithdrawn");
}

/**
 * Match a request to an offer (driver accepts, passenger joins, or staff
 * pairs them). The database checks seats and opens a private in-app thread
 * between the two guardians; both are notified (in-app + push).
 */
export async function matchCarpool(input: { offerId: string; requestId: string }): Promise<FamilyResult<{ conversationId: string }>> {
  await assertFeature("carpooling");
  const me = await requireMember();
  if (!me) return fail("forbidden");
  if (!uuid.safeParse(input.offerId).success || !uuid.safeParse(input.requestId).success) return fail("invalid");
  const db = await familyDb();
  const { data, error } = await db.rpc("carpool_match", { p_offer: input.offerId, p_request: input.requestId });
  if (error || !data) return failDb("family.carpool.match", error);
  const { data: ev } = await familyAdminDb().from("events").select("title,type,starts_at").eq("id", data.event_id).eq("org_id", me.orgId).maybeSingle();
  await notifyMembers({
    orgId: me.orgId, profileIds: [data.driver_id, data.passenger_id].filter((x) => x !== me.id), category: "events", type: "other",
    app: "parent", tag: `carpool-${data.match_id}`,
    build: ({ t, f }) => ({
      title: t("family.push.carpool.matched.title"),
      body: t("family.push.carpool.matched.body", {
        event: ev?.title ?? t.dynamic(`family.push.event.types.${ev?.type ?? "other"}`, {}, ""),
        date: ev ? f.dateTime(ev.starts_at) : "",
      }),
      path: threadPath("parent", data.conversation_id),
    }),
  });
  revalidateCarpool(data.event_id);
  return ok("family.messages.matched", { conversationId: data.conversation_id });
}

export async function cancelCarpoolMatch(matchId: string): Promise<FamilyResult> {
  await assertFeature("carpooling");
  const me = await requireMember();
  if (!me) return fail("forbidden");
  if (!uuid.safeParse(matchId).success) return fail("invalid");
  const db = await familyDb();
  const { data, error } = await db.rpc("carpool_cancel_match", { p_match: matchId });
  if (error || !data) return failDb("family.carpool.cancel", error);
  await notifyMembers({
    orgId: me.orgId, profileIds: [data.driver_id, data.passenger_id].filter((x) => x !== me.id), category: "events", type: "other",
    app: "parent", tag: `carpool-${matchId}`,
    build: ({ t }) => ({ title: t("family.push.carpool.cancelled.title"), body: t("family.push.carpool.cancelled.body"), path: `/parent/carpool/${data.event_id}` }),
  });
  revalidateCarpool(data.event_id);
  return ok("family.messages.matchCancelled");
}
