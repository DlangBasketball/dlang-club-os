"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";
import type { Json } from "@/types/database";
import { z } from "zod";
import { getTranslations } from "@/lib/i18n/server";
import { attendanceCorrectionSchema, dbErrorKey, reasonSchema, zodErrorKey, type AttendanceCorrectionInput } from "@/lib/club-ops/validation";

export type AttendanceMarkInput = {
  athlete_id: string;
  status: "present" | "late" | "absent" | "excused";
  notes?: string;
  injury_flag?: boolean;
};

export type SaveResult =
  | { ok: true; summary: { present: number; late: number; absent: number; excused: number; injuries: number; total: number; submitted: boolean } }
  | { ok: false; error: string };

export async function saveAttendance(
  attendanceSessionId: string,
  marks: AttendanceMarkInput[],
  submit: boolean,
): Promise<SaveResult> {
  const me = await getSessionUser();
  if (!me || !(me.roles.includes("coach") || me.roles.includes("admin"))) {
    return { ok: false, error: "Not permitted" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_attendance", {
    p_session: attendanceSessionId,
    p_marks: marks as unknown as Json,
    p_submit: submit,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/coach");
  revalidatePath("/coach/attendance");
  const summary = (data ?? { present: 0, late: 0, absent: 0, excused: 0, injuries: 0, total: 0, submitted: submit }) as {
    present: number; late: number; absent: number; excused: number; injuries: number; total: number; submitted: boolean;
  };
  return { ok: true, summary };
}

export type CorrectionResult = { ok: true; changed: number } | { ok: false; error: string };

async function tFail(key: string): Promise<{ ok: false; error: string }> {
  const t = await getTranslations();
  return { ok: false, error: t.dynamic(key, undefined, t("editOps.errors.generic")) };
}

function revalidateAttendance(sessionId: string) {
  revalidatePath("/admin/attendance");
  revalidatePath(`/admin/attendance/${sessionId}`);
  revalidatePath("/coach");
  revalidatePath("/coach/attendance");
}

/**
 * Correct marks after submission: change status, add late arrivals, edit
 * notes/injury flag, or remove a mark (status null). Admin, or the session's
 * coach (not once locked). The RPC checks org + role and audits each change.
 */
export async function correctAttendance(input: AttendanceCorrectionInput): Promise<CorrectionResult> {
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("coach"))) return tFail("editOps.errors.notPermitted");
  const p = attendanceCorrectionSchema.safeParse(input);
  if (!p.success) return tFail(zodErrorKey(p.error));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("correct_attendance", {
    p_session: p.data.sessionId,
    p_marks: p.data.marks.map((m) => ({ athlete_id: m.athleteId, status: m.status, notes: m.notes, injury_flag: m.injuryFlag })) as unknown as Json,
    p_reason: p.data.reason || null,
  });
  if (error) return tFail(dbErrorKey(error.message));
  revalidateAttendance(p.data.sessionId);
  return { ok: true, changed: Number((data as { changed?: number } | null)?.changed ?? 0) };
}

/** Reopen a submitted (coach or admin) or locked (admin) session for editing. */
export async function reopenAttendanceSession(sessionId: string, reason?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("coach"))) return tFail("editOps.errors.notPermitted");
  if (!z.string().uuid().safeParse(sessionId).success) return tFail("editOps.errors.invalidRequest");
  const r = reasonSchema.safeParse(reason ?? "");
  if (!r.success) return tFail(zodErrorKey(r.error));
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_attendance_session", { p_session: sessionId, p_reason: r.data || null });
  if (error) return tFail(dbErrorKey(error.message));
  revalidateAttendance(sessionId);
  return { ok: true };
}
