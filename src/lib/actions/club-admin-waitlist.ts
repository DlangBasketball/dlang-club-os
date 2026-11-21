"use server";

import { assertFeature } from "@/lib/upgrades/server";
import { revalidatePath } from "next/cache";
import { caAdminDb, caDb } from "@/lib/club-admin/db";
import { audit, dbErrorKey, done, fail, requireMe, type CaResult } from "@/lib/club-admin/server";
import { familyRecipients, sendNotice } from "@/lib/club-admin/notify";
import { processWaitlists } from "@/lib/club-admin/waitlist-server";
import {
  firstIssueKey, tokenSchema, uuid, waitlistAdminAddSchema, waitlistJoinSchema, waitlistMoveSchema, waitlistSkipSchema,
  type WaitlistAdminAddInput, type WaitlistJoinInput,
} from "@/lib/club-admin/validation";

/**
 * Waiting lists that fill themselves. Joining: guardians (RLS insert) or
 * admins; ordering, skipping and manual offers: admins; the acceptance link
 * is public (the token is the credential, only its hash is stored).
 */
function revalidateWaitlist() {
  revalidatePath("/admin/waitlists");
  revalidatePath("/parent/waitlist");
  revalidatePath("/admin/registrations");
}

type Resolved = { row: Record<string, unknown>; familyId: string };

/** Resolve a join request inside the caller's club (RLS client). */
async function resolveJoin(orgId: string, v: { kind: string; targetId: string; athleteId: string; priceOptionId: string | null; ageGroupId: string | null; coachId?: string | null; slotStart?: string | null }): Promise<Resolved | { error: string }> {
  const db = await caDb();
  const { data: a } = await db.from("athletes").select("id,family_id").eq("id", v.athleteId).eq("org_id", orgId).maybeSingle();
  if (!a) return { error: "clubadmin.errors.notFound" };
  const base = { org_id: orgId, athlete_id: v.athleteId, family_id: a.family_id, target_kind: v.kind };
  if (v.kind === "program") {
    const { data: p } = await db.from("programs").select("id").eq("id", v.targetId).eq("org_id", orgId).maybeSingle();
    if (!p) return { error: "clubadmin.errors.notFound" };
    return { row: { ...base, program_id: v.targetId }, familyId: a.family_id };
  }
  if (v.kind === "camp_edition") {
    const { data: e } = await db.from("camp_editions").select("id,program_id").eq("id", v.targetId).eq("org_id", orgId).maybeSingle();
    if (!e) return { error: "clubadmin.errors.notFound" };
    const request: Record<string, string> = {};
    if (v.priceOptionId) {
      const { data: o } = await db.from("camp_price_options").select("id").eq("id", v.priceOptionId).eq("program_id", e.program_id).maybeSingle();
      if (!o) return { error: "clubadmin.errors.notFound" };
      request.price_option_id = v.priceOptionId;
    } else return { error: "clubadmin.errors.optionRequired" };
    if (v.ageGroupId) {
      const { data: g } = await db.from("camp_age_groups").select("id").eq("id", v.ageGroupId).eq("program_id", e.program_id).maybeSingle();
      if (!g) return { error: "clubadmin.errors.notFound" };
      request.age_group_id = v.ageGroupId;
    }
    return { row: { ...base, camp_edition_id: v.targetId, request }, familyId: a.family_id };
  }
  // training slot (admin only)
  if (!v.coachId || !v.slotStart) return { error: "clubadmin.errors.invalid" };
  const { data: s } = await db.from("training_services").select("id").eq("id", v.targetId).eq("org_id", orgId).maybeSingle();
  if (!s) return { error: "clubadmin.errors.notFound" };
  return { row: { ...base, service_id: v.targetId, coach_id: v.coachId, slot_start: new Date(v.slotStart).toISOString() }, familyId: a.family_id };
}

/** Guardian joins a list for their child. */
export async function joinWaitlist(input: WaitlistJoinInput): Promise<CaResult> {
  await assertFeature("waitlists");
  const me = await requireMe(["parent"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  const p = waitlistJoinSchema.safeParse(input);
  if (!p.success) return fail(firstIssueKey(p.error));
  const r = await resolveJoin(me.orgId, p.data);
  if ("error" in r) return fail(r.error);
  const db = await caDb();
  const { data: link } = await db.from("family_members").select("family_id").eq("family_id", r.familyId).eq("profile_id", me.id).maybeSingle();
  if (!link) return fail("clubadmin.errors.forbidden");
  const { data, error } = await db.from("waitlist_entries").insert({ ...r.row, created_by: me.id }).select("id,target_key").single();
  if (error || !data) return fail(dbErrorKey(error?.message));
  await audit(me, "waitlist.join", "waitlist_entries", data.id);
  await processWaitlists({ orgId: me.orgId, targetKey: data.target_key });
  revalidateWaitlist();
  return done("clubadmin.waitlist.joined");
}

/** Leave a list (guardian of the entry, or admin). */
export async function leaveWaitlist(id: string): Promise<CaResult> {
  await assertFeature("waitlists");
  const me = await requireMe(["parent", "admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  if (!uuid.safeParse(id).success) return fail("clubadmin.errors.invalid");
  const db = await caDb();
  const { data: e } = await db.from("waitlist_entries").select("id,family_id,status,target_key").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!e) return fail("clubadmin.errors.notFound");
  if (!me.roles.includes("admin")) {
    const { data: link } = await db.from("family_members").select("family_id").eq("family_id", e.family_id).eq("profile_id", me.id).maybeSingle();
    if (!link) return fail("clubadmin.errors.forbidden");
  }
  if (e.status !== "waiting" && e.status !== "offered") return fail("clubadmin.errors.codes.ENTRY_NOT_WAITING");
  const { error } = await caAdminDb().from("waitlist_entries").update({ status: "removed", responded_at: new Date().toISOString() })
    .eq("id", id).eq("org_id", me.orgId);
  if (error) return fail(dbErrorKey(error.message));
  await audit(me, "waitlist.leave", "waitlist_entries", id);
  await processWaitlists({ orgId: me.orgId, targetKey: e.target_key });
  revalidateWaitlist();
  return done("clubadmin.waitlist.left");
}

export async function adminAddToWaitlist(input: WaitlistAdminAddInput): Promise<CaResult> {
  await assertFeature("waitlists");
  const me = await requireMe(["admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  const p = waitlistAdminAddSchema.safeParse(input);
  if (!p.success) return fail(firstIssueKey(p.error));
  const r = await resolveJoin(me.orgId, p.data);
  if ("error" in r) return fail(r.error);
  const db = await caDb();
  const { data, error } = await db.from("waitlist_entries").insert({ ...r.row, created_by: me.id }).select("id,target_key").single();
  if (error || !data) return fail(dbErrorKey(error?.message));
  await audit(me, "waitlist.add", "waitlist_entries", data.id);
  revalidateWaitlist();
  return done("clubadmin.waitlist.added");
}

export async function moveWaitlistEntry(id: string, position: number): Promise<CaResult> {
  await assertFeature("waitlists");
  const me = await requireMe(["admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  const p = waitlistMoveSchema.safeParse({ id, position });
  if (!p.success) return fail(firstIssueKey(p.error));
  const { error } = await (await caDb()).rpc("waitlist_move", { p_entry: p.data.id, p_position: p.data.position });
  if (error) return fail(dbErrorKey(error.message));
  revalidateWaitlist();
  return done("clubadmin.waitlist.moved");
}

export async function skipWaitlistEntry(id: string, reason: string): Promise<CaResult> {
  await assertFeature("waitlists");
  const me = await requireMe(["admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  const p = waitlistSkipSchema.safeParse({ id, reason });
  if (!p.success) return fail(firstIssueKey(p.error));
  const db = await caDb();
  const { data, error } = await db.from("waitlist_entries").update({ status: "skipped", skip_reason: p.data.reason, responded_at: new Date().toISOString() })
    .eq("id", id).eq("org_id", me.orgId).in("status", ["waiting", "offered"]).select("id,target_key");
  if (error) return fail(dbErrorKey(error.message));
  if (!data?.length) return fail("clubadmin.errors.codes.ENTRY_NOT_WAITING");
  await audit(me, "waitlist.skip", "waitlist_entries", id);
  await processWaitlists({ orgId: me.orgId, targetKey: data[0].target_key });
  revalidateWaitlist();
  return done("clubadmin.waitlist.skipped");
}

/** Admin: offer the spot to this entry now (even without a free spot). */
export async function offerWaitlistEntryNow(id: string): Promise<CaResult> {
  await assertFeature("waitlists");
  const me = await requireMe(["admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  if (!uuid.safeParse(id).success) return fail("clubadmin.errors.invalid");
  const { data: e } = await (await caDb()).from("waitlist_entries").select("id").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!e) return fail("clubadmin.errors.notFound");
  const r = await processWaitlists({ orgId: me.orgId, forceEntry: id });
  if (r.error) return fail(dbErrorKey(r.error));
  await audit(me, "waitlist.offer_now", "waitlist_entries", id);
  revalidateWaitlist();
  return done("clubadmin.waitlist.offered");
}

/** Admin: expire overdue offers and fill free spots on every list now. */
export async function runWaitlistsNow(): Promise<CaResult<{ offers: number }>> {
  await assertFeature("waitlists");
  const me = await requireMe(["admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  const r = await processWaitlists({ orgId: me.orgId });
  if (r.error) return fail(dbErrorKey(r.error));
  await audit(me, "waitlist.process", "waitlist_entries", null, { offers: r.offers });
  revalidateWaitlist();
  return done("clubadmin.waitlist.processed", { offers: r.offers }, { count: r.offers });
}

/**
 * Public acceptance link: accept or decline an offer. No session needed —
 * the 48-hex token is the credential. Accept confirms the registration /
 * booking and issues the invoice; decline / expiry passes the spot on.
 */
export async function respondToOffer(token: string, accept: boolean): Promise<CaResult<{ status: string; invoiceId?: string | null }>> {
  if (!tokenSchema.safeParse(token).success) return fail("clubadmin.errors.invalidLink");
  const db = caAdminDb();
  const { data, error } = await db.rpc("waitlist_respond", { p_token: token, p_accept: accept });
  if (error) return fail(dbErrorKey(error.message));
  const r = (data ?? {}) as { status: string; org_id: string; target_key: string; entry_id: string; invoice_id?: string | null; invoice_number?: string | null; amount?: number; currency?: string; family_id?: string };
  const actor = { id: null, orgId: r.org_id };
  await audit(actor, `waitlist.respond.${r.status}`, "waitlist_entries", r.entry_id);
  if (r.status === "accepted" && r.family_id) {
    const { data: e } = await db.from("waitlist_entries").select("program_id,service_id,athlete_id").eq("id", r.entry_id).maybeSingle();
    const [{ data: prog }, { data: ath }] = await Promise.all([
      e?.program_id ? db.from("programs").select("name").eq("id", e.program_id).maybeSingle() : db.from("training_services").select("name").eq("id", e?.service_id ?? "").maybeSingle(),
      db.from("athletes").select("first_name").eq("id", e?.athlete_id ?? "").maybeSingle(),
    ]);
    await sendNotice({
      orgId: r.org_id, kind: "waitlistAccepted", recipients: await familyRecipients(r.org_id, r.family_id),
      params: { name: (prog as { name?: string } | null)?.name ?? "", child: (ath as { first_name?: string } | null)?.first_name ?? "",
        invoice: r.invoice_number ?? null, amount: r.invoice_id ? Number(r.amount ?? 0) : null, currency: r.currency ?? null },
      link: r.invoice_id ? `/parent/invoices/${r.invoice_id}` : "/parent/waitlist", invoiceId: r.invoice_id ?? null,
    });
  } else {
    await processWaitlists({ orgId: r.org_id, targetKey: r.target_key });
  }
  revalidateWaitlist();
  return done(`clubadmin.waitlist.response.${r.status}`, { status: r.status, invoiceId: r.invoice_id ?? null });
}
