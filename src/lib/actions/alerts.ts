"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireRole, writeAudit, type ActionResult } from "@/lib/people/server";
import { getLocaleContext } from "@/lib/i18n/server";
import { zonedWallTimeToUtc } from "@/lib/format";
import { logError } from "@/lib/log";
import { msgDb, type AlertRow } from "@/lib/messaging/db";
import { dispatchAlert } from "@/lib/messaging/notify";
import { alertSchema, messagingErrorKey, SCOPED_AUDIENCES, uuid, type AlertInput } from "@/lib/messaging/validation";

/**
 * Alerts: admins address any audience, coaches their own teams, programmes
 * and camp editions (enforced by RLS on club_alerts). "Send now" dispatches
 * in-app notifications (+ email per preferences) right after the response;
 * scheduled alerts go out from /api/messaging/cron or when staff next open
 * the alerts page. The banner shows an alert between its start and expiry.
 */

function revalidateAlerts() {
  revalidatePath("/admin/alerts");
  revalidatePath("/coach/alerts");
  revalidatePath("/admin", "layout");
  revalidatePath("/coach", "layout");
  revalidatePath("/parent", "layout");
}

function wallToIso(local: string | null, timeZone: string): string | null {
  if (!local) return null;
  const [d, tm] = local.split("T");
  return zonedWallTimeToUtc(d, tm, timeZone)?.toISOString() ?? null;
}

export async function createAlert(input: AlertInput): Promise<ActionResult<{ id: string; scheduled: boolean }>> {
  const { me, t } = await requireRole(["admin", "coach"]);
  if (!me) return { ok: false, error: t("messaging.errors.forbidden") };
  const p = alertSchema.safeParse(input);
  if (!p.success) {
    const scopeIssue = p.error.issues.some((i) => i.path[0] === "scopeId");
    const expiryIssue = p.error.issues.some((i) => i.path[0] === "expiresAt");
    return { ok: false, error: t(scopeIssue ? "messaging.errors.scopeRequired" : expiryIssue ? "messaging.errors.expiry" : "messaging.errors.invalid") };
  }
  const v = p.data;
  if (!me.roles.includes("admin") && !SCOPED_AUDIENCES.includes(v.audience)) return { ok: false, error: t("messaging.errors.coachAudience") };
  const { timeZone } = await getLocaleContext(me.orgId);
  const now = new Date();
  const startsAt = wallToIso(v.startsAt, timeZone) ?? now.toISOString();
  const expiresAt = wallToIso(v.expiresAt, timeZone);
  if (expiresAt && new Date(expiresAt) <= new Date(Math.max(now.getTime(), new Date(startsAt).getTime()))) {
    return { ok: false, error: t("messaging.errors.expiry") };
  }
  const db = await msgDb();
  const { data, error } = await db
    .from("club_alerts")
    .insert({
      org_id: me.orgId,
      title: v.title,
      body: v.body,
      severity: v.severity,
      audience: v.audience,
      team_id: v.audience === "team" ? v.scopeId : null,
      program_id: v.audience === "program" ? v.scopeId : null,
      camp_edition_id: v.audience === "camp_edition" ? v.scopeId : null,
      starts_at: startsAt,
      expires_at: expiresAt,
      created_by: me.id,
    })
    .select("*")
    .single();
  if (error || !data) {
    logError("alerts.create", error);
    return { ok: false, error: t.dynamic(messagingErrorKey(error?.message)) };
  }
  const alert = data as AlertRow;
  const scheduled = new Date(alert.starts_at).getTime() > now.getTime() + 60_000;
  await writeAudit(me, "alert.create", "club_alerts", alert.id, { audience: v.audience, severity: v.severity, scheduled });
  if (!scheduled) after(() => dispatchAlert(alert, { email: v.alsoEmail }).then(() => undefined).catch((e) => logError("alerts.dispatch", e)));
  revalidateAlerts();
  return { ok: true, message: t(scheduled ? "messaging.messages.alertScheduled" : "messaging.messages.alertSent"), data: { id: alert.id, scheduled } };
}

export async function cancelAlert(id: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin", "coach"]);
  if (!me) return { ok: false, error: t("messaging.errors.forbidden") };
  if (!uuid.safeParse(id).success) return { ok: false, error: t("messaging.errors.notFound") };
  const db = await msgDb();
  const { data, error } = await db
    .from("club_alerts")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", me.orgId)
    .is("cancelled_at", null)
    .select("id");
  if (error || !data?.length) return { ok: false, error: t("messaging.errors.forbidden") };
  await writeAudit(me, "alert.cancel", "club_alerts", id);
  revalidateAlerts();
  return { ok: true, message: t("messaging.messages.alertCancelled") };
}

export async function dismissAlert(id: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin", "finance", "coach", "parent"]);
  if (!me) return { ok: false, error: t("messaging.errors.forbidden") };
  if (!uuid.safeParse(id).success) return { ok: false, error: t("messaging.errors.notFound") };
  const db = await msgDb();
  const { error } = await db
    .from("club_alert_dismissals")
    .upsert({ org_id: me.orgId, alert_id: id, profile_id: me.id }, { onConflict: "alert_id,profile_id", ignoreDuplicates: true });
  if (error) {
    logError("alerts.dismiss", error);
    return { ok: false, error: t("messaging.errors.generic") };
  }
  await writeAudit(me, "alert.dismiss", "club_alerts", id);
  revalidatePath("/", "layout");
  return { ok: true };
}
