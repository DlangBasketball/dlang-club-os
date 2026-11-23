"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import type { AppRole } from "@/lib/auth/roles";
import { inviteUser } from "@/lib/auth/invitations";
import { getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyEventChange, notifyMembers } from "@/lib/family/notify";
import type { Json } from "@/types/database";
import { runAttendanceAlerts } from "@/lib/attendance/alerts";
import {
  absenceSchema, attendanceErrorCode, attendancePortalPath, breakSchema, correctionRequestSchema, correctSchema, finalizeSchema,
  isoDateSchema, resolveCorrectionSchema, rosterAddSchema, rosterLeaveSchema, rosterTransferSchema, saveSchema, uuidSchema,
  type AbsenceInput, type BreakInput, type CorrectInput, type CorrectionRequestInput, type FinalizeInput, type FinalizeResult,
  type ResolveCorrectionInput, type SaveInput, type SaveResult,
} from "@/lib/attendance/types";

/*
 * Team attendance — server actions (migration 20250420104000). The org is
 * always the caller's (session); every RPC re-checks tenant and role in SQL.
 * Writes that must not happen twice take a client-generated requestId (uuid,
 * one per user intent; reuse it on retry). Errors come back translated with
 * the SQL code (teamAttendance.errors.<CODE>). Business refusals that carry
 * data (VERSION_CONFLICT, UNMARKED_PLAYERS, REPORTED_ABSENCE_UNACKNOWLEDGED)
 * are returned as `data` of an ok:true result with data.ok === false — see
 * docs/team-attendance.md.
 */
export type TaResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string; code?: string };

type Me = SessionUser & { orgId: string };

async function session(roles?: AppRole[]): Promise<{ me: Me | null; t: Translator }> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId) return { me: null, t };
  if (roles && !roles.some((r) => me.roles.includes(r))) return { me: null, t };
  return { me: me as Me, t };
}

function fail(t: Translator, error: { message?: string } | string | null | undefined): { ok: false; error: string; code?: string } {
  const msg = typeof error === "string" ? error : error?.message ?? "";
  const code = attendanceErrorCode(msg);
  if (code) return { ok: false, code, error: t.dynamic(`teamAttendance.errors.${code}`, undefined, t("teamAttendance.errors.generic")) };
  if (msg) logError("teamAttendance", msg);
  return { ok: false, error: t("teamAttendance.errors.generic") };
}
const denied = (t: Translator) => ({ ok: false as const, code: "NOT_AUTHORIZED", error: t("teamAttendance.errors.NOT_AUTHORIZED") });
const invalid = (t: Translator) => ({ ok: false as const, code: "INVALID_INPUT", error: t("teamAttendance.errors.invalid") });

function revalidateSession(eventId?: string) {
  revalidatePath("/coach", "layout");
  revalidatePath("/admin/attendance", "layout");
  revalidatePath("/parent/attendance", "layout");
  revalidatePath("/player", "layout");
  if (eventId) revalidatePath(`/admin/schedule/${eventId}`);
}

/** Deliver alerts created by a finalize / correction right away (best effort). */
async function dispatchNow(orgId: string) {
  try {
    await runAttendanceAlerts({ orgId, limit: 50, createDue: false });
  } catch (e) {
    logError("teamAttendance.dispatch", e);
  }
}

// ===========================================================================
// Sheet
// ===========================================================================
/** Create (or return) the sheet of a session; returns the sheet (see AttendanceSheet). */
export async function openAttendance(eventId: string): Promise<TaResult<Json>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  if (!uuidSchema.safeParse(eventId).success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_open", { p_event: eventId });
  if (error) return fail(t, error);
  return { ok: true, data: data as Json };
}

/** Draft save; per-mark merge (conflicts returned, not overwritten). */
export async function saveAttendance(input: SaveInput): Promise<TaResult<SaveResult>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = saveSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const v = p.data;
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_save", {
    p_event: v.eventId, p_expected_version: v.expectedVersion, p_request_id: v.requestId, p_ack_reported: v.ackReported,
    p_marks: v.marks.map((m) => ({ athlete_id: m.athleteId, status: m.status, ...(m.baseRev === undefined ? {} : { base_rev: m.baseRev }),
                                   ...(m.note === undefined ? {} : { note: m.note }) })) as Json,
  });
  if (error) return fail(t, error);
  revalidateSession(v.eventId);
  return { ok: true, data: data as unknown as SaveResult };
}

export async function markAllPresent(input: { eventId: string; expectedVersion: number; requestId: string }): Promise<TaResult<Json>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = z.object({ eventId: uuidSchema, expectedVersion: z.number().int().min(1), requestId: uuidSchema }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_mark_all_present", {
    p_event: p.data.eventId, p_expected_version: p.data.expectedVersion, p_request_id: p.data.requestId,
  });
  if (error) return fail(t, error);
  revalidateSession(p.data.eventId);
  return { ok: true, data: data as Json };
}

export async function addGuest(input: { eventId: string; athleteId: string }): Promise<TaResult<Json>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = z.object({ eventId: uuidSchema, athleteId: uuidSchema }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_add_guest", { p_event: p.data.eventId, p_athlete: p.data.athleteId });
  if (error) return fail(t, error);
  revalidateSession(p.data.eventId);
  return { ok: true, data: data as Json, message: t("teamAttendance.messages.guestAdded") };
}

export async function removeGuest(input: { eventId: string; athleteId: string }): Promise<TaResult<Json>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = z.object({ eventId: uuidSchema, athleteId: uuidSchema }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_remove_guest", { p_event: p.data.eventId, p_athlete: p.data.athleteId });
  if (error) return fail(t, error);
  revalidateSession(p.data.eventId);
  return { ok: true, data: data as Json };
}

/** Finalize. data.ok === false carries UNMARKED_PLAYERS / REPORTED_ABSENCE_UNACKNOWLEDGED / VERSION_CONFLICT. */
export async function finalizeAttendance(input: FinalizeInput): Promise<TaResult<FinalizeResult>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = finalizeSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_finalize", {
    p_event: p.data.eventId, p_led_by_coach: p.data.ledByCoachId ?? null, p_expected_version: p.data.expectedVersion,
    p_request_id: p.data.requestId, p_ack_reported: p.data.ackReported,
  });
  if (error) return fail(t, error);
  const r = data as unknown as FinalizeResult;
  if (r.ok && r.alerts_created > 0) await dispatchNow(me.orgId);
  revalidateSession(p.data.eventId);
  return { ok: true, data: r, message: r.ok ? t("teamAttendance.messages.finalized") : undefined };
}

export async function reopenAttendance(input: { eventId: string; reason: string }): Promise<TaResult<Json>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = z.object({ eventId: uuidSchema, reason: z.string().trim().min(3).max(500) }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_reopen", { p_event: p.data.eventId, p_reason: p.data.reason });
  if (error) return fail(t, error);
  revalidateSession(p.data.eventId);
  return { ok: true, data: data as Json };
}

/** Correction of a finalized mark (history row; correction alerts to guardians when one was sent). */
export async function correctAttendance(input: CorrectInput): Promise<TaResult<Json>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = correctSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_correct", {
    p_event: p.data.eventId, p_athlete: p.data.athleteId, p_new_status: p.data.status, p_reason: p.data.reason,
    p_request_id: p.data.requestId, p_ack_reported: p.data.ackReported,
  });
  if (error) return fail(t, error);
  if (Number((data as { alerts_created?: number } | null)?.alerts_created ?? 0) > 0) await dispatchNow(me.orgId);
  revalidateSession(p.data.eventId);
  return { ok: true, data: data as Json, message: t("teamAttendance.messages.corrected") };
}

// ===========================================================================
// Absence reports (guardian / player)
// ===========================================================================
export async function reportAbsence(input: AbsenceInput): Promise<TaResult<Json>> {
  const { me, t } = await session(["parent", "player"]);
  if (!me) return denied(t);
  const p = absenceSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("absence_report", {
    p_event: p.data.eventId, p_athlete: p.data.athleteId, p_reason: p.data.reason, p_category: p.data.category,
  });
  if (error) return fail(t, error);
  revalidateSession(p.data.eventId);
  return { ok: true, data: data as Json, message: t("teamAttendance.messages.absenceReported") };
}

export async function withdrawAbsence(reportId: string): Promise<TaResult> {
  const { me, t } = await session(["parent", "player"]);
  if (!me) return denied(t);
  if (!uuidSchema.safeParse(reportId).success) return invalid(t);
  const db = await createClient();
  const { error } = await db.rpc("absence_withdraw", { p_report: reportId });
  if (error) return fail(t, error);
  revalidateSession();
  return { ok: true, message: t("teamAttendance.messages.absenceWithdrawn") };
}

export async function acknowledgeAbsence(reportId: string): Promise<TaResult> {
  const { me, t } = await session(["admin", "coach"]);
  if (!me) return denied(t);
  if (!uuidSchema.safeParse(reportId).success) return invalid(t);
  const db = await createClient();
  const { error } = await db.rpc("absence_acknowledge", { p_report: reportId });
  if (error) return fail(t, error);
  revalidateSession();
  return { ok: true };
}

// ===========================================================================
// Session access (substitutes)
// ===========================================================================
async function adminProfiles(orgId: string): Promise<string[]> {
  const { data } = await createAdminClient().from("staff_roles").select("profile_id").eq("org_id", orgId).eq("role", "admin");
  return Array.from(new Set((data ?? []).map((r) => r.profile_id as string)));
}

export async function requestSessionAccess(input: { eventId: string; note?: string | null }): Promise<TaResult<Json>> {
  const { me, t } = await session(["coach"]);
  if (!me) return denied(t);
  const p = z.object({ eventId: uuidSchema, note: z.string().trim().max(500).nullable().optional() }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("session_request_access", { p_event: p.data.eventId, p_note: p.data.note ?? null });
  if (error) return fail(t, error);
  if ((data as { status?: string } | null)?.status === "pending") {
    await notifyMembers({
      orgId: me.orgId, profileIds: await adminProfiles(me.orgId), category: "events", type: "practice", app: "admin",
      tag: `access-${p.data.eventId}`,
      build: ({ t: rt }) => ({
        title: rt("teamAttendance.notify.accessRequested.title"),
        body: rt("teamAttendance.notify.accessRequested.body", { coach: me.fullName ?? "" }),
        path: "/admin/attendance/access",
      }),
    });
  }
  revalidateSession(p.data.eventId);
  return { ok: true, data: data as Json, message: t("teamAttendance.messages.accessRequested") };
}

export async function assignSessionCoach(input: { eventId: string; coachId: string; role?: "substitute" | "lead" }): Promise<TaResult<Json>> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const p = z.object({ eventId: uuidSchema, coachId: uuidSchema, role: z.enum(["substitute", "lead"]).default("substitute") }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("session_assign_coach", { p_event: p.data.eventId, p_coach: p.data.coachId, p_role: p.data.role });
  if (error) return fail(t, error);
  const { data: coach } = await createAdminClient().from("coaches").select("profile_id").eq("id", p.data.coachId).eq("org_id", me.orgId).maybeSingle();
  if (coach?.profile_id) {
    await notifyMembers({
      orgId: me.orgId, profileIds: [coach.profile_id], category: "events", type: "practice", app: "coach", tag: `access-${p.data.eventId}`,
      build: ({ t: rt }) => ({ title: rt("teamAttendance.notify.accessDecided.approvedTitle"), body: rt("teamAttendance.notify.accessDecided.body"), path: `/coach/sessions/${p.data.eventId}` }),
    });
  }
  revalidateSession(p.data.eventId);
  return { ok: true, data: data as Json };
}

export async function decideSessionAccess(input: { assignmentId: string; approve: boolean; note?: string | null }): Promise<TaResult<Json>> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const p = z.object({ assignmentId: uuidSchema, approve: z.boolean(), note: z.string().trim().max(500).nullable().optional() }).safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("session_decide_access", { p_assignment: p.data.assignmentId, p_approve: p.data.approve, p_note: p.data.note ?? null });
  if (error) return fail(t, error);
  const r = data as { changed?: boolean; coach_profile_id?: string | null; event_id?: string } | null;
  if (r?.changed && r.coach_profile_id) {
    await notifyMembers({
      orgId: me.orgId, profileIds: [r.coach_profile_id], category: "events", type: "practice", app: "coach", tag: `access-${r.event_id}`,
      build: ({ t: rt }) => ({
        title: rt(p.data.approve ? "teamAttendance.notify.accessDecided.approvedTitle" : "teamAttendance.notify.accessDecided.rejectedTitle"),
        body: rt("teamAttendance.notify.accessDecided.body"),
        path: `/coach/sessions/${r.event_id ?? ""}`,
      }),
    });
  }
  revalidateSession(r?.event_id);
  return { ok: true, data: data as Json };
}

// ===========================================================================
// Correction requests (guardian <-> staff)
// ===========================================================================
export async function requestAttendanceCorrection(input: CorrectionRequestInput): Promise<TaResult<Json>> {
  const { me, t } = await session(["parent"]);
  if (!me) return denied(t);
  const p = correctionRequestSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_correction_request", {
    p_event: p.data.eventId, p_athlete: p.data.athleteId, p_message: p.data.message, p_requested_status: p.data.requestedStatus ?? null,
  });
  if (error) return fail(t, error);
  const teamId = (data as { team_id?: string } | null)?.team_id;
  if (teamId) {
    const admin = createAdminClient();
    const { data: tc } = await admin.from("team_coaches").select("coaches(profile_id)").eq("team_id", teamId).eq("org_id", me.orgId);
    const coachProfiles = ((tc ?? []) as unknown as { coaches: { profile_id: string | null } | null }[])
      .map((r) => r.coaches?.profile_id).filter((x): x is string => Boolean(x));
    await notifyMembers({
      orgId: me.orgId, profileIds: [...(await adminProfiles(me.orgId)), ...coachProfiles], category: "events", type: "practice",
      tag: `correction-${p.data.eventId}-${p.data.athleteId}`,
      build: ({ t: rt, app }) => ({
        title: rt("teamAttendance.notify.correctionRequested.title"),
        body: rt("teamAttendance.notify.correctionRequested.body"),
        path: app === "admin" ? "/admin/attendance/corrections" : "/coach/attendance/corrections",
      }),
    });
  }
  revalidateSession(p.data.eventId);
  return { ok: true, data: data as Json, message: t("teamAttendance.messages.correctionRequested") };
}

export async function withdrawCorrectionRequest(requestId: string): Promise<TaResult> {
  const { me, t } = await session(["parent"]);
  if (!me) return denied(t);
  if (!uuidSchema.safeParse(requestId).success) return invalid(t);
  const db = await createClient();
  const { error } = await db.rpc("attendance_correction_withdraw", { p_request: requestId });
  if (error) return fail(t, error);
  revalidateSession();
  return { ok: true };
}

/** Accept (-> attendance_correct, correction alerts) or reject (note required); the requester is notified. */
export async function resolveCorrectionRequest(input: ResolveCorrectionInput): Promise<TaResult<Json>> {
  const { me, t } = await session(["admin", "coach"]);
  if (!me) return denied(t);
  const p = resolveCorrectionSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_correction_resolve", {
    p_request: p.data.requestId, p_accept: p.data.accept, p_new_status: p.data.newStatus ?? null, p_note: p.data.note,
  });
  if (error) return fail(t, error);
  const r = data as { requested_by?: string | null; event_id?: string; athlete_id?: string; correction?: { alerts_created?: number } | null } | null;
  if (Number(r?.correction?.alerts_created ?? 0) > 0) await dispatchNow(me.orgId);
  if (r?.requested_by && r.event_id && r.athlete_id) {
    const eventId = r.event_id, athleteId = r.athlete_id;
    await notifyMembers({
      orgId: me.orgId, profileIds: [r.requested_by], category: "events", type: "practice", app: "parent", tag: `correction-${eventId}-${athleteId}`,
      build: ({ t: rt }) => ({
        title: rt(p.data.accept ? "teamAttendance.notify.correctionResolved.acceptedTitle" : "teamAttendance.notify.correctionResolved.rejectedTitle"),
        body: rt("teamAttendance.notify.correctionResolved.body"),
        path: attendancePortalPath(eventId, athleteId),
      }),
    });
  }
  revalidateSession(r?.event_id);
  return { ok: true, data: data as Json };
}

// ===========================================================================
// Effective-dated roster
// ===========================================================================
function revalidateRoster(teamIds: string[]) {
  revalidatePath("/admin/teams");
  for (const id of teamIds) revalidatePath(`/admin/teams/${id}`);
  revalidatePath("/coach/team");
}

export async function rosterAdd(input: z.input<typeof rosterAddSchema>): Promise<TaResult<Json>> {
  const { me, t } = await session(["admin", "coach"]);
  if (!me) return denied(t);
  const p = rosterAddSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("team_member_add", {
    p_team: p.data.teamId, p_athlete: p.data.athleteId, p_effective_on: p.data.effectiveOn ?? null,
    p_jersey: p.data.jerseyNumber ?? null, p_position: p.data.position ?? null,
  });
  if (error) return fail(t, error);
  revalidateRoster([p.data.teamId]);
  return { ok: true, data: data as Json };
}

export async function rosterLeave(input: z.input<typeof rosterLeaveSchema>): Promise<TaResult<Json>> {
  const { me, t } = await session(["admin", "coach"]);
  if (!me) return denied(t);
  const p = rosterLeaveSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("team_member_leave", {
    p_team: p.data.teamId, p_athlete: p.data.athleteId, p_effective_on: p.data.effectiveOn, p_reason: p.data.reason,
  });
  if (error) return fail(t, error);
  revalidateRoster([p.data.teamId]);
  return { ok: true, data: data as Json };
}

export async function rosterTransfer(input: z.input<typeof rosterTransferSchema>): Promise<TaResult<Json>> {
  const { me, t } = await session(["admin", "coach"]);
  if (!me) return denied(t);
  const p = rosterTransferSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("team_member_transfer", {
    p_from_team: p.data.fromTeamId, p_to_team: p.data.toTeamId, p_athlete: p.data.athleteId,
    p_effective_on: p.data.effectiveOn, p_reason: p.data.reason,
  });
  if (error) return fail(t, error);
  revalidateRoster([p.data.fromTeamId, p.data.toTeamId]);
  return { ok: true, data: data as Json };
}

// ===========================================================================
// Club settings: go-live date, training breaks (admin)
// ===========================================================================
export async function setAttendanceGoLive(date: string | null): Promise<TaResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  if (date !== null && !isoDateSchema.safeParse(date).success) return invalid(t);
  const db = await createClient();
  const { error } = await db.rpc("attendance_settings_set", { p_tracking_starts_on: date });
  if (error) return fail(t, error);
  revalidatePath("/admin/settings/seasons");
  revalidateSession();
  return { ok: true, message: t("teamAttendance.messages.saved") };
}

/** Create / change a break; trainings in its range are cancelled and their families notified. */
export async function saveTrainingBreak(input: BreakInput): Promise<TaResult<{ breakId: string; cancelled: string[]; skippedFinal: string[] }>> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const p = breakSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("training_break_save", {
    p_id: p.data.id ?? null, p_label: p.data.label, p_starts_on: p.data.startsOn, p_ends_on: p.data.endsOn, p_season: p.data.seasonId ?? null,
  });
  if (error) return fail(t, error);
  const r = data as { break_id: string; cancelled?: string[]; skipped_final?: string[] };
  const cancelled = r.cancelled ?? [];
  if (cancelled.length) await notifyEventChange(me.orgId, cancelled, "cancelled");
  revalidatePath("/admin/settings/seasons");
  revalidatePath("/admin/schedule", "layout");
  revalidatePath("/parent/schedule");
  revalidateSession();
  return {
    ok: true,
    data: { breakId: r.break_id, cancelled, skippedFinal: r.skipped_final ?? [] },
    message: t("teamAttendance.messages.breakSaved", { count: cancelled.length }),
  };
}

/** Delete a break. Nothing is un-cancelled; the still-cancelled sessions are returned for review. */
export async function deleteTrainingBreak(id: string): Promise<TaResult<{ stillCancelled: { event_id: string; starts_at: string; team_id: string | null }[] }>> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  if (!uuidSchema.safeParse(id).success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("training_break_delete", { p_id: id });
  if (error) return fail(t, error);
  const still = ((data as { still_cancelled?: unknown[] } | null)?.still_cancelled ?? []) as { event_id: string; starts_at: string; team_id: string | null }[];
  revalidatePath("/admin/settings/seasons");
  return { ok: true, data: { stillCancelled: still }, message: t("teamAttendance.messages.breakDeleted", { count: still.length }) };
}

// ===========================================================================
// Player accounts (admin)
// ===========================================================================
/** Invite a player login for an athlete (invitations flow, role 'player'). */
export async function invitePlayer(input: { athleteId: string; email: string }): Promise<TaResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const p = z.object({ athleteId: uuidSchema, email: z.string().trim().toLowerCase().email().max(200) }).safeParse(input);
  if (!p.success) return invalid(t);
  const res = await inviteUser({ email: p.data.email, role: "player", athleteId: p.data.athleteId });
  if (!res.ok) return fail(t, res.error);
  return { ok: true, message: t("teamAttendance.messages.playerInvited") };
}

export async function unlinkPlayerAccount(athleteId: string): Promise<TaResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  if (!uuidSchema.safeParse(athleteId).success) return invalid(t);
  const db = await createClient();
  const { error } = await db.rpc("athlete_player_unlink", { p_athlete: athleteId });
  if (error) return fail(t, error);
  revalidatePath(`/admin/athletes/${athleteId}`);
  return { ok: true, message: t("teamAttendance.messages.playerUnlinked") };
}
