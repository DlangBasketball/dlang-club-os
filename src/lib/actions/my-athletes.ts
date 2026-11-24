"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { logError } from "@/lib/log";
import { revalidatePersonEverywhere } from "@/lib/people/revalidate";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { participantsDb } from "@/lib/participants/db";
import {
  ACTIVE_ATHLETE_COOKIE, ACTIVE_ATHLETE_MAX_AGE, ALL_ATHLETES, encodeActiveAthleteCookie, isUuid,
} from "@/lib/participants/active-athlete";

/*
 * My Athletes (migration 20250420106200_my_athletes_sync.sql).
 *   setActiveAthlete  — parent app switcher (cookie; validated by the DB here
 *                       and again on every read)
 *   runAthleteDataCheck / decideSelfLink / mergeAthletes — staff (admin) only;
 *                       each RPC re-checks the role and the club.
 * The club always comes from the session, never from the client.
 */
export type MAResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; code: string; error: string };

const CODES = [
  "NOT_ALLOWED", "NOT_FOUND", "INVALID_MERGE", "ALREADY_MERGED", "MERGE_BLOCKED", "REQUEST_ID_REQUIRED", "TOO_LONG",
  "PROFILE_ALREADY_LINKED", "LINK_FAILED", "INVALID_DECISION",
] as const;

function fail(t: Translator, error: { message?: string } | string | null | undefined): { ok: false; code: string; error: string } {
  const msg = typeof error === "string" ? error : error?.message ?? "";
  const code = CODES.find((c) => new RegExp(`\\b${c}\\b`).test(msg));
  if (!code) logError("myAthletes", msg);
  return { ok: false, code: code ?? "GENERIC", error: t.dynamic(`myAthletes.errors.${code ?? "generic"}`, undefined, t("myAthletes.errors.generic")) };
}

async function staff() {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId || !me.roles.includes("admin") || !(await tenantMatchesOrg(me.orgId))) return { me: null, t };
  return { me: me as typeof me & { orgId: string }, t };
}

// ---------------------------------------------------------------------------
// Parent app: active athlete
// ---------------------------------------------------------------------------
/** Set the active athlete (an athlete the caller manages, or "all"). */
export async function setActiveAthlete(athleteId: string): Promise<MAResult> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId) return { ok: false, code: "NOT_ALLOWED", error: t("myAthletes.errors.NOT_ALLOWED") };
  let value: string = ALL_ATHLETES;
  if (athleteId !== ALL_ATHLETES) {
    if (!isUuid(athleteId)) return { ok: false, code: "NOT_FOUND", error: t("myAthletes.errors.NOT_FOUND") };
    const db = await participantsDb();
    const { data, error } = await db.rpc("my_athlete_resolve", { p_athlete: athleteId });
    if (error) return fail(t, error);
    if (!data) return { ok: false, code: "NOT_FOUND", error: t("myAthletes.errors.NOT_FOUND") };
    value = String(data);
  }
  const jar = await cookies();
  jar.set(ACTIVE_ATHLETE_COOKIE, encodeActiveAthleteCookie({ userId: me.id, orgId: me.orgId, athleteId: value }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: ACTIVE_ATHLETE_MAX_AGE,
  });
  revalidatePath("/parent", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Staff: data check, self link, merge
// ---------------------------------------------------------------------------
export type DataCheckResult = { possibleDuplicates: number; possibleSelfLinks: number; withoutGuardian: number; total: number };

/** Duplicate / self-link / no-guardian checks of the club (flags only; nothing is merged or linked). */
export async function runAthleteDataCheck(): Promise<MAResult<DataCheckResult>> {
  const { me, t } = await staff();
  if (!me) return { ok: false, code: "NOT_ALLOWED", error: t("myAthletes.errors.NOT_ALLOWED") };
  const db = await participantsDb();
  const { data, error } = await db.rpc("athlete_data_check", {});
  if (error) return fail(t, error);
  const d = (data ?? {}) as Record<string, number>;
  const res = {
    possibleDuplicates: Number(d.possible_duplicates ?? 0), possibleSelfLinks: Number(d.possible_self_links ?? 0),
    withoutGuardian: Number(d.without_guardian ?? 0), total: Number(d.total ?? 0),
  };
  revalidatePath("/admin/data-review");
  return { ok: true, data: res, message: t("myAthletes.dataCheck.done", { count: res.total }) };
}

const selfLinkInput = z.object({ flagId: z.string().uuid(), decision: z.enum(["link", "dismiss"]) });

/** Confirm (link the adult player to the login) or dismiss a POSSIBLE_SELF_LINK finding. */
export async function decideSelfLink(input: z.input<typeof selfLinkInput>): Promise<MAResult> {
  const { me, t } = await staff();
  if (!me) return { ok: false, code: "NOT_ALLOWED", error: t("myAthletes.errors.NOT_ALLOWED") };
  const p = selfLinkInput.safeParse(input);
  if (!p.success) return { ok: false, code: "INVALID_DECISION", error: t("myAthletes.errors.INVALID_DECISION") };
  const db = await participantsDb();
  const { data, error } = await db.rpc("athlete_self_link_decide", { p_flag: p.data.flagId, p_decision: p.data.decision });
  if (error) return fail(t, error);
  const athleteId = (data as { athlete_id?: string } | null)?.athlete_id;
  revalidatePath("/admin/data-review");
  if (athleteId) revalidatePath(`/admin/athletes/${athleteId}`);
  revalidatePersonEverywhere(me.orgId);
  return { ok: true, message: t(p.data.decision === "link" ? "myAthletes.selfLink.linked" : "myAthletes.selfLink.dismissed") };
}

const mergeInput = z.object({
  keepId: z.string().uuid(),
  duplicateId: z.string().uuid(),
  reason: z.string().trim().max(1000).optional().default(""),
  requestId: z.string().uuid(),
}).refine((v) => v.keepId !== v.duplicateId, { message: "INVALID_MERGE" });

export type MergeOutcome = { keptAthleteId: string; moved: number; conflicts: { table: string; column: string; kept: string }[] };

/** Merge a duplicate athlete into the kept one (one transaction, server-side; see athlete_merge). */
export async function mergeAthletes(input: z.input<typeof mergeInput>): Promise<MAResult<MergeOutcome>> {
  const { me, t } = await staff();
  if (!me) return { ok: false, code: "NOT_ALLOWED", error: t("myAthletes.errors.NOT_ALLOWED") };
  const p = mergeInput.safeParse(input);
  if (!p.success) {
    const tooLong = p.error.issues.some((i) => i.path[0] === "reason");
    return { ok: false, code: tooLong ? "TOO_LONG" : "INVALID_MERGE", error: t(tooLong ? "myAthletes.errors.TOO_LONG" : "myAthletes.errors.INVALID_MERGE") };
  }
  const db = await participantsDb();
  const { data, error } = await db.rpc("athlete_merge", {
    p_keep: p.data.keepId, p_duplicate: p.data.duplicateId, p_reason: p.data.reason || null, p_request_id: p.data.requestId,
  });
  if (error) return fail(t, error);
  const d = (data ?? {}) as { kept_athlete_id?: string; moved?: { rows: number }[]; conflicts?: { table: string; column: string; kept: string }[] };
  const moved = (d.moved ?? []).reduce((s, m) => s + Number(m.rows ?? 0), 0);
  const conflicts = d.conflicts ?? [];
  revalidatePath("/admin/data-review");
  revalidatePath(`/admin/athletes/${p.data.keepId}`);
  revalidatePath(`/admin/athletes/${p.data.duplicateId}`);
  revalidatePersonEverywhere(me.orgId);
  return {
    ok: true,
    data: { keptAthleteId: d.kept_athlete_id ?? p.data.keepId, moved, conflicts },
    message: t("myAthletes.merge.done", { moved, conflicts: conflicts.length }),
  };
}
