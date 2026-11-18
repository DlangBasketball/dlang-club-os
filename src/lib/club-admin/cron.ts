import "server-only";
import { logError } from "@/lib/log";
import { orgTimeZone } from "@/lib/plans/settings";
import { todayIn } from "@/lib/payments/plans";
import { caAdminDb, type CertificateRow } from "./db";
import { toSettings } from "./data";
import { dueReminder, thresholdsCovered } from "./compliance";
import { daysBetween } from "./membership";
import { adminRecipients, profileRecipients, sendNotice } from "./notify";
import { processWaitlists } from "./waitlist-server";

/**
 * Daily (or more frequent) club-admin job for every club, service role:
 *   1. memberships past their end date -> expired
 *   2. waiting lists: expire overdue offers, offer free spots (+ emails)
 *   3. certificate expiry reminders (60 / 30 / 7 days by default) to the
 *      coach and the club's admins — once per threshold and validity date
 * Idempotent: a repeated run sends nothing twice (reminder rows are unique).
 */
export async function runClubAdminCron(): Promise<{ expired: number; offers: number; reminders: number }> {
  const db = caAdminDb();
  let expired = 0, offers = 0, reminders = 0;

  const { data: n, error } = await db.rpc("membership_expire_due", { p_org: null });
  if (error) logError("clubadmin.cron.expire", error);
  else expired = Number(n ?? 0);

  const w = await processWaitlists({});
  offers = w.offers;

  try {
    reminders = await certificateReminders();
  } catch (e) {
    logError("clubadmin.cron.reminders", e);
  }
  return { expired, offers, reminders };
}

async function certificateReminders(): Promise<number> {
  const db = caAdminDb();
  // Verified or pending certificates ending within the widest threshold (+ margin).
  const horizon = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
  const { data: certs } = await db.from("staff_certificates").select("*").neq("status", "rejected")
    .not("valid_until", "is", null).lte("valid_until", horizon).limit(5000);
  const rows = (certs ?? []) as CertificateRow[];
  if (!rows.length) return 0;
  const orgIds = Array.from(new Set(rows.map((c) => c.org_id)));
  const { data: settingsRows } = await db.from("club_admin_settings").select("*").in("org_id", orgIds);
  const settings = new Map(((settingsRows ?? []) as { org_id: string }[]).map((s) => [s.org_id, toSettings(s as never)]));
  const { data: sentRows } = await db.from("staff_certificate_reminders").select("certificate_id,threshold_days,valid_until").in("certificate_id", rows.map((c) => c.id));
  const sent = new Map<string, number[]>();
  for (const r of (sentRows ?? []) as { certificate_id: string; threshold_days: number; valid_until: string }[]) {
    const k = `${r.certificate_id}:${r.valid_until}`;
    sent.set(k, [...(sent.get(k) ?? []), r.threshold_days]);
  }
  const todayByOrg = new Map<string, string>();
  let count = 0;
  for (const c of rows) {
    if (!todayByOrg.has(c.org_id)) todayByOrg.set(c.org_id, todayIn(await orgTimeZone(c.org_id)));
    const today = todayByOrg.get(c.org_id)!;
    const thresholds = settings.get(c.org_id)?.complianceReminderDays ?? toSettings(null).complianceReminderDays;
    const due = dueReminder(c.valid_until, today, thresholds, sent.get(`${c.id}:${c.valid_until}`) ?? []);
    if (due == null) continue;
    // Claim first (unique per certificate / threshold / validity): a concurrent run skips.
    const claims = thresholdsCovered(due, thresholds).map((t) => ({ org_id: c.org_id, certificate_id: c.id, threshold_days: t, valid_until: c.valid_until! }));
    const { data: claimed, error } = await db.from("staff_certificate_reminders").upsert(claims, { onConflict: "certificate_id,threshold_days,valid_until", ignoreDuplicates: true }).select("threshold_days");
    if (error || !(claimed ?? []).some((r) => (r as { threshold_days: number }).threshold_days === due)) continue;
    const { data: coach } = await db.from("coaches").select("display_name,profile_id").eq("id", c.coach_id).eq("org_id", c.org_id).maybeSingle();
    const days = daysBetween(today, c.valid_until!);
    const name = c.title ?? "";
    const coachRow = coach as { display_name: string; profile_id: string | null } | null;
    if (coachRow?.profile_id) {
      await sendNotice({ orgId: c.org_id, kind: "certificateExpiring", recipients: await profileRecipients(c.org_id, [coachRow.profile_id]),
        params: { name, certKind: c.kind, date: c.valid_until, days }, link: "/coach/compliance" });
    }
    await sendNotice({ orgId: c.org_id, kind: "certificateExpiringAdmin", recipients: await adminRecipients(c.org_id),
      params: { name, certKind: c.kind, coach: coachRow?.display_name ?? "", date: c.valid_until, days }, link: "/admin/staff-compliance" });
    count += 1;
  }
  return count;
}
