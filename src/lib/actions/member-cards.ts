"use server";

import { assertFeature } from "@/lib/upgrades/server";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { shopDb } from "@/lib/shop/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";
import { normalizeTagId, scanPayload } from "@/lib/member-cards/token";

/**
 * Member cards: QR / NFC roll call. Tokens are issued, rotated and resolved
 * by security-definer RPCs that check the caller's club and role (guardian
 * or admin for a card; admin or a coach of the athlete for a scan). The
 * actions add the role gate, the tenant check and translated messages.
 */
export type CardResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
type Me = SessionUser & { orgId: string };

const ERR: [RegExp, string][] = [
  [/NOT_AUTHORIZED|permission denied/, "notPermitted"],
  [/ATHLETE_NOT_FOUND/, "notFound"],
  [/TAG_IN_USE/, "tagInUse"],
  [/TAG_INVALID/, "tagInvalid"],
  [/CARD_INACTIVE/, "inactive"],
];

async function fail(key: string, orgId?: string | null): Promise<{ ok: false; error: string }> {
  const t = await getTranslations(orgId);
  return { ok: false, error: t.dynamic(`sports.cards.errors.${key}`, undefined, t("sports.cards.errors.generic")) };
}
function dbKey(message: string): string {
  for (const [re, k] of ERR) if (re.test(message)) return k;
  return "generic";
}

async function requireRole(roles: ("admin" | "coach" | "parent")[]): Promise<Me | null> {
  const me = await getSessionUser();
  if (!me?.orgId || !roles.some((r) => me.roles.includes(r))) return null;
  if (!(await tenantMatchesOrg(me.orgId))) return null;
  return me as Me;
}

const athleteId = z.string().uuid();

/** The athlete's card token + its QR code (SVG markup, no personal data inside). */
export async function getMemberCard(id: string): Promise<CardResult<{ token: string; qrSvg: string }>> {
  await assertFeature("member_cards");
  const me = await requireRole(["admin", "parent"]);
  if (!me) return fail("notPermitted");
  if (!athleteId.safeParse(id).success) return fail("notFound", me.orgId);
  const db = await shopDb();
  const { data, error } = await db.rpc("member_card_token", { p_athlete: id });
  if (error || typeof data !== "string") return fail(dbKey(error?.message ?? ""), me.orgId);
  const qrSvg = await QRCode.toString(data, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  return { ok: true, data: { token: data, qrSvg } };
}

export async function rotateMemberCard(id: string): Promise<CardResult<{ token: string; qrSvg: string }>> {
  await assertFeature("member_cards");
  const me = await requireRole(["admin", "parent"]);
  if (!me) return fail("notPermitted");
  if (!athleteId.safeParse(id).success) return fail("notFound", me.orgId);
  const db = await shopDb();
  const { data, error } = await db.rpc("rotate_member_card", { p_athlete: id });
  if (error || typeof data !== "string") return fail(dbKey(error?.message ?? ""), me.orgId);
  const qrSvg = await QRCode.toString(data, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  revalidatePath(`/parent/children/${id}`);
  revalidatePath(`/admin/athletes/${id}`);
  return { ok: true, data: { token: data, qrSvg } };
}

export async function assignMemberTag(id: string, tag: string | null): Promise<CardResult<{ tag: string | null }>> {
  await assertFeature("member_cards");
  const me = await requireRole(["admin"]);
  if (!me) return fail("notPermitted");
  if (!athleteId.safeParse(id).success) return fail("notFound", me.orgId);
  const norm = tag ? normalizeTagId(tag) : null;
  if (tag && !norm) return fail("tagInvalid", me.orgId);
  const db = await shopDb();
  const { error } = await db.rpc("assign_member_tag", { p_athlete: id, p_tag: norm });
  if (error) return fail(dbKey(error.message), me.orgId);
  revalidatePath(`/admin/athletes/${id}`);
  return { ok: true, data: { tag: norm } };
}

/**
 * Card check-in on a team / booked-session attendance sheet: the coach (or
 * admin) who can run the event scans a card; the database resolves it in the
 * caller's club and marks the athlete present on THE sheet of that event
 * (attendance_open + attendance_save: same marks, history, stats and
 * follow-ups as a tap on the sheet). A repeated scan is a no-op.
 */
export type CheckInOutcome = { outcome: "checkedIn" | "already"; athleteId: string; name: string };
const CHECK_IN_CODES = ["UNKNOWN_CARD", "NOT_ON_SHEET", "SHEET_FINAL", "CONFLICT"] as const;

export async function checkInWithCard(eventId: string, raw: string, requestId: string): Promise<CardResult<CheckInOutcome>> {
  await assertFeature("member_cards");
  const me = await requireRole(["admin", "coach"]);
  if (!me) return fail("notPermitted");
  const t = await getTranslations(me.orgId);
  if (!athleteId.safeParse(eventId).success || !athleteId.safeParse(requestId).success) return fail("generic", me.orgId);
  const payload = scanPayload(typeof raw === "string" ? raw.slice(0, 300) : "");
  if (!payload) return fail("unknownCard", me.orgId);
  try {
    const db = (await createClient()) as unknown as SupabaseClient;
    const { data, error } = await db.rpc("member_card_check_in", { p_event: eventId, p_token: payload, p_request_id: requestId });
    if (error) {
      if (/NOT_AUTHORIZED|EVENT_NOT_FOUND|permission denied/.test(error.message)) return fail("notPermitted", me.orgId);
      if (/EVENT_CANCELLED/.test(error.message)) return { ok: false, error: t("memberCard.checkIn.cancelled") };
      throw error;
    }
    const r = data as { ok: boolean; code?: string; already?: boolean; athlete_id?: string | null; name?: string | null };
    if (r.ok && r.athlete_id) {
      revalidatePath(`/coach/trainings/${eventId}/attendance`);
      return { ok: true, data: { outcome: r.already ? "already" : "checkedIn", athleteId: r.athlete_id, name: r.name ?? "" } };
    }
    const code = (CHECK_IN_CODES as readonly string[]).includes(r.code ?? "") ? r.code! : "UNKNOWN_CARD";
    return { ok: false, error: t.dynamic(`memberCard.checkIn.codes.${code}`, { name: r.name ?? "" }, t("memberCard.checkIn.codes.UNKNOWN_CARD")) };
  } catch (e) {
    logError("cards.checkIn", e);
    return fail("generic", me.orgId);
  }
}

/** A coach / admin scanned a QR code or an NFC tag: which athlete is it? */
export async function resolveScan(raw: string): Promise<CardResult<{ athleteId: string; name: string }>> {
  await assertFeature("member_cards");
  const me = await requireRole(["admin", "coach"]);
  if (!me) return fail("notPermitted");
  const payload = scanPayload(typeof raw === "string" ? raw.slice(0, 300) : "");
  if (!payload) return fail("unknownCard", me.orgId);
  try {
    const db = await shopDb();
    const { data, error } = await db.rpc("resolve_member_token", { p_token: payload });
    if (error) throw error;
    const row = (data ?? [])[0];
    if (!row) return fail("unknownCard", me.orgId);
    return { ok: true, data: { athleteId: row.athlete_id, name: `${row.first_name} ${row.last_name}`.trim() } };
  } catch (e) {
    logError("cards.resolve", e);
    return fail("generic", me.orgId);
  }
}
