"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { runAttendanceAlerts } from "@/lib/attendance/alerts";
import { attendanceErrorCode } from "@/lib/attendance/types";
import { flagGroup } from "@/lib/attendance/review-flags";

/*
 * Admin attendance UI actions (migration 20250420104200): retry a no-show
 * alert, resolve / refresh data review flags. The org is always the
 * caller's; the RPCs re-check tenant and role. Attendance flags are admin
 * only; billing flags stay open to finance (data_review_flag_resolve).
 */
export type AdminResult = { ok: true; message?: string } | { ok: false; error: string; code?: string };

const uuid = z.string().uuid();
const ADMIN_CODES = ["ALERT_NOT_FOUND", "ALERT_NOT_RETRYABLE", "ALERT_NO_GUARDIAN", "FLAG_NOT_FOUND"] as const;

function fail(t: Translator, error: { message?: string } | null | undefined): AdminResult {
  const msg = error?.message ?? "";
  const own = ADMIN_CODES.find((c) => new RegExp(`\\b${c}\\b`).test(msg));
  if (own) return { ok: false, code: own, error: t.dynamic(`adminAttendance.errors.${own}`, undefined, t("teamAttendance.errors.generic")) };
  const code = attendanceErrorCode(msg);
  if (code) return { ok: false, code, error: t.dynamic(`teamAttendance.errors.${code}`, undefined, t("teamAttendance.errors.generic")) };
  if (msg) logError("adminAttendance", msg);
  return { ok: false, error: t("teamAttendance.errors.generic") };
}

async function me(roles: ("admin" | "finance")[]) {
  const [user, t] = await Promise.all([getSessionUser(), getTranslations()]);
  const allowed = !!user?.orgId && roles.some((r) => user.roles.includes(r));
  return { user: allowed ? user : null, t };
}

/** Re-queue a failed / no_contact alert (admin) and try to deliver it right away. */
export async function retryNoShowAlert(alertId: string, eventId?: string): Promise<AdminResult> {
  const { user, t } = await me(["admin"]);
  if (!user?.orgId) return { ok: false, code: "NOT_AUTHORIZED", error: t("teamAttendance.errors.NOT_AUTHORIZED") };
  if (!uuid.safeParse(alertId).success) return { ok: false, code: "INVALID_INPUT", error: t("teamAttendance.errors.invalid") };
  const db = await createClient();
  const { error } = await db.rpc("attendance_alert_retry", { p_alert: alertId });
  if (error) return fail(t, error);
  try {
    await runAttendanceAlerts({ orgId: user.orgId, limit: 50, createDue: false });
  } catch (e) {
    logError("adminAttendance.retry.dispatch", e);
  }
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/attendance", "layout");
  if (eventId && uuid.safeParse(eventId).success) revalidatePath(`/admin/schedule/${eventId}/attendance`);
  return { ok: true, message: t("adminAttendance.messages.alertRetried") };
}

/** Resolve a data review flag. Attendance flags: admin only; billing: admin or finance. */
export async function resolveDataReviewFlag(input: { flagId: string; note?: string | null }): Promise<AdminResult> {
  const { user, t } = await me(["admin", "finance"]);
  if (!user?.orgId) return { ok: false, code: "NOT_AUTHORIZED", error: t("teamAttendance.errors.NOT_AUTHORIZED") };
  const p = z.object({ flagId: uuid, note: z.string().trim().max(1000).nullable().optional() }).safeParse(input);
  if (!p.success) return { ok: false, code: "INVALID_INPUT", error: t("teamAttendance.errors.invalid") };
  const db = await createClient();
  const { data: flag } = await db.from("data_review_flags").select("reason_code").eq("id", p.data.flagId).maybeSingle();
  if (!flag) return { ok: false, code: "FLAG_NOT_FOUND", error: t("adminAttendance.errors.FLAG_NOT_FOUND") };
  if (flagGroup(flag.reason_code) === "attendance" && !user.roles.includes("admin")) {
    return { ok: false, code: "NOT_AUTHORIZED", error: t("teamAttendance.errors.NOT_AUTHORIZED") };
  }
  const { error } = await db.rpc("data_review_flag_resolve", { p_flag: p.data.flagId, p_note: p.data.note || null });
  if (error) return fail(t, error);
  revalidatePath("/admin/data-review");
  revalidatePath("/admin/dashboard");
  return { ok: true, message: t("adminAttendance.messages.flagResolved") };
}

/** Re-run the attendance / roster checks for the club now (admin). */
export async function refreshReviewFlags(): Promise<AdminResult> {
  const { user, t } = await me(["admin"]);
  if (!user?.orgId) return { ok: false, code: "NOT_AUTHORIZED", error: t("teamAttendance.errors.NOT_AUTHORIZED") };
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_review_flags", { p_org: user.orgId });
  if (error) return fail(t, error);
  revalidatePath("/admin/data-review");
  return { ok: true, message: t("adminAttendance.messages.flagsRefreshed", { count: Number(data ?? 0) }) };
}
