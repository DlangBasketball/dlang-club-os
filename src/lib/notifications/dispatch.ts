import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/resend";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { render, ENUM_FOR, type NotifType, type NotifVars } from "./templates";

export type DispatchResult = { notificationId: string | null; emailLogId: string | null; emailOk: boolean };

/**
 * The single path for raising a notification. Always records the in-app row
 * (when there's a recipient profile) and, when an email is requested, writes
 * an email_logs row first (status queued) then updates it to sent/failed —
 * so a crash mid-send still leaves an auditable, retryable log entry.
 */
export async function dispatchNotification(opts: {
  orgId: string;
  type: NotifType;
  recipientProfileId: string | null;
  toEmail?: string | null;
  vars: NotifVars;
  invoiceId?: string | null;
  email?: boolean; // default true when toEmail is present
}): Promise<DispatchResult> {
  const admin = createAdminClient();
  // The issuing club's own name, brand, currency, time zone and host.
  const org = await getOrgEmailContext(opts.orgId);
  const clubName = opts.vars.club_name ?? org.clubName;
  const r = render(opts.type, { ...opts.vars, ...(clubName ? { club_name: clubName } : {}) }, { ...org.brand, timeZone: org.f.timeZone, baseUrl: org.baseUrl });
  const result: DispatchResult = { notificationId: null, emailLogId: null, emailOk: false };

  // 1. In-app notification (only if we have a recipient profile)
  if (opts.recipientProfileId) {
    const { data } = await admin
      .from("notifications")
      .insert({ org_id: opts.orgId, recipient_id: opts.recipientProfileId, type: ENUM_FOR[opts.type], title: r.title, body: r.body, link: r.link ?? null })
      .select("id")
      .single();
    result.notificationId = (data as { id: string } | null)?.id ?? null;
  }

  // 2. Email (logged, then sent)
  const wantEmail = (opts.email ?? true) && Boolean(opts.toEmail);
  if (wantEmail && opts.toEmail) {
    const { data: logRow } = await admin
      .from("email_logs")
      .insert({ org_id: opts.orgId, recipient_id: opts.recipientProfileId, to_email: opts.toEmail, subject: r.subject, template: opts.type, html: r.html, status: "queued", attempts: 0, notification_id: result.notificationId, invoice_id: opts.invoiceId ?? null })
      .select("id")
      .single();
    const logId = (logRow as { id: string } | null)?.id ?? null;
    result.emailLogId = logId;

    const sent = await sendEmail({ to: opts.toEmail, subject: r.subject, html: r.html, fromName: org.senderName ?? clubName });
    result.emailOk = sent.ok;
    if (logId) {
      await admin
        .from("email_logs")
        .update({ status: sent.ok ? "sent" : "failed", attempts: 1, error: sent.ok ? null : sent.error ?? "unknown", sent_at: sent.ok ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
        .eq("id", logId);
    }
  }
  return result;
}

/** Re-send a previously failed email and bump its attempt count. */
export async function retryEmailLog(logId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data } = await admin.from("email_logs").select("id,to_email,subject,html,attempts,status").eq("id", logId).maybeSingle();
  const log = data as { id: string; to_email: string; subject: string | null; html: string | null; attempts: number; status: string } | null;
  if (!log) return { ok: false, error: "Log not found" };
  if (!log.html || !log.subject) return { ok: false, error: "Nothing to resend (no stored body)" };

  const sent = await sendEmail({ to: log.to_email, subject: log.subject, html: log.html });
  await admin
    .from("email_logs")
    .update({ status: sent.ok ? "sent" : "failed", attempts: (log.attempts ?? 0) + 1, error: sent.ok ? null : sent.error ?? "unknown", sent_at: sent.ok ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", logId);
  return { ok: sent.ok, error: sent.ok ? undefined : sent.error };
}

/** Convenience: dispatch the same event to many recipients (bulk reminders). */
export async function dispatchMany(
  rows: { orgId: string; type: NotifType; recipientProfileId: string | null; toEmail?: string | null; vars: NotifVars; invoiceId?: string | null }[],
): Promise<{ sent: number; failed: number; inApp: number }> {
  let sent = 0, failed = 0, inApp = 0;
  for (const row of rows) {
    const res = await dispatchNotification(row);
    if (res.notificationId) inApp += 1;
    if (res.emailLogId) res.emailOk ? (sent += 1) : (failed += 1);
  }
  return { sent, failed, inApp };
}
