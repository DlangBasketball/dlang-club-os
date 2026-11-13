"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { requireRole, writeAudit, type ActionResult } from "@/lib/people/server";
import { getLocaleContext } from "@/lib/i18n/server";
import { zonedWallTimeToUtc } from "@/lib/format";
import { staffDb } from "@/lib/staff/db";
import { clubEventSchema, staffErrorKey, uuid, type ClubEventInput } from "@/lib/staff/validation";
import { logError } from "@/lib/log";

/**
 * Club events (admin) and personal calendar subscription links. The feed
 * token is 32 random bytes shown to the user once; only its SHA-256 hash is
 * stored, so a database leak does not expose working links.
 */

function revalidateCalendars() {
  revalidatePath("/admin/calendar", "layout");
  revalidatePath("/coach/calendar");
  revalidatePath("/parent/calendar");
}

export async function saveClubEvent(input: ClubEventInput): Promise<ActionResult<{ id: string }>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  const p = clubEventSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("staff.errors.invalid") };
  const { timeZone } = await getLocaleContext(me.orgId);
  const e = p.data;
  const start = zonedWallTimeToUtc(e.startDate, e.allDay ? "00:00" : (e.startTime as string), timeZone);
  const end = zonedWallTimeToUtc(e.endDate, e.allDay ? "23:59" : (e.endTime as string), timeZone);
  if (!start || !end || end < start) return { ok: false, error: t("staff.errors.invalidTimes") };
  const row = {
    title: e.title, type: e.type, starts_at: start.toISOString(), ends_at: end.toISOString(), all_day: e.allDay,
    venue_id: e.venueId, team_id: e.teamId, location: e.location, audience: e.audience, description: e.description, url: e.url,
  };
  const db = await staffDb();
  const res = e.id
    ? await db.from("club_events").update(row).eq("id", e.id).eq("org_id", me.orgId).select("id").maybeSingle()
    : await db.from("club_events").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id").single();
  if (res.error || !res.data) {
    logError("calendar.saveClubEvent", res.error);
    return { ok: false, error: t.dynamic(staffErrorKey(res.error?.message ?? "NOT_AUTHORIZED")) };
  }
  await writeAudit(me, e.id ? "club_event.update" : "club_event.create", "club_events", res.data.id, { type: e.type, audience: e.audience });
  revalidateCalendars();
  return { ok: true, message: t("staff.messages.clubEventSaved"), data: { id: res.data.id } };
}

export async function deleteClubEvent(id: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  if (!uuid.safeParse(id).success) return { ok: false, error: t("staff.errors.notFound") };
  const db = await staffDb();
  const { data, error } = await db.from("club_events").delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error || !data?.length) return { ok: false, error: t(error ? "staff.errors.forbidden" : "staff.errors.notFound") };
  await writeAudit(me, "club_event.delete", "club_events", id);
  revalidateCalendars();
  return { ok: true, message: t("staff.messages.clubEventDeleted") };
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Create (or rotate) the caller's read-only calendar link. The URL is returned once. */
export async function createCalendarFeed(): Promise<ActionResult<{ url: string }>> {
  const { me, t } = await requireRole(["admin", "finance", "coach", "parent"]);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  const db = await staffDb();
  const now = new Date().toISOString();
  await db.from("calendar_feed_tokens").update({ revoked_at: now }).eq("org_id", me.orgId).eq("profile_id", me.id).is("revoked_at", null);
  const token = randomBytes(32).toString("base64url");
  const { data, error } = await db.from("calendar_feed_tokens")
    .insert({ org_id: me.orgId, profile_id: me.id, token_hash: hashToken(token) }).select("id").single();
  if (error || !data) {
    logError("calendar.createFeed", error);
    return { ok: false, error: t("staff.errors.tokenFailed") };
  }
  await writeAudit(me, "calendar_feed.create", "calendar_feed_tokens", data.id);
  revalidateCalendars();
  return { ok: true, message: t("staff.messages.feedCreated"), data: { url: `${await origin()}/api/calendar/feed/${token}` } };
}

export async function revokeCalendarFeed(): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin", "finance", "coach", "parent"]);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  const db = await staffDb();
  const { data, error } = await db.from("calendar_feed_tokens").update({ revoked_at: new Date().toISOString() })
    .eq("org_id", me.orgId).eq("profile_id", me.id).is("revoked_at", null).select("id");
  if (error) return { ok: false, error: t("staff.errors.generic") };
  for (const row of data ?? []) await writeAudit(me, "calendar_feed.revoke", "calendar_feed_tokens", row.id);
  revalidateCalendars();
  return { ok: true, message: t("staff.messages.feedRevoked") };
}
