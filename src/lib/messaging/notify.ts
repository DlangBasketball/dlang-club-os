import "server-only";
import { sendEmail } from "@/lib/email/resend";
import { getOrgEmailContext, type OrgEmailContext } from "@/lib/email/org-context";
import { getStandaloneI18n } from "@/lib/i18n/messages";
import type { Translator } from "@/lib/i18n/translator";
import { logError } from "@/lib/log";
import { msgAdminDb, type AlertRow, type MsgClient } from "./db";
import { messagingEmailHtml } from "./email";
import { appFor, threadPath, APP_HOME, type MessagingApp } from "./paths";
import type { MessagingRole } from "./permissions";
import { parseChannels, resolveDelivery, type NotificationCategory } from "./preferences";

/**
 * Notification delivery for the message board, alerts and new contacts.
 * In-app notifications always go out per the user's preferences; emails are
 * translated into each recipient's language, respect the per-category email
 * switch and quiet hours, and never carry the text of a sensitive thread.
 * Runs with the service role (server only) and always filters by org_id.
 * Email sending is skipped by the Resend client when no key is configured.
 */

type Recipient = { id: string; email: string | null; locale: string | null; app: MessagingApp };

type Built = {
  title: string;
  body: string | null;
  path: string;
  subject: string;
  heading: string;
  lines: string[];
  quote?: string | null;
  cta: string;
};

/** Profiles (in this org, active) + their app, for a set of ids. */
async function loadRecipients(db: MsgClient, orgId: string, ids: string[]): Promise<Recipient[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return [];
  const [{ data: profs }, { data: roles }] = await Promise.all([
    db.from("profiles").select("id,email,locale,locale_set_at,is_active,org_id").in("id", unique).eq("org_id", orgId),
    db.from("staff_roles").select("profile_id,role").in("profile_id", unique).eq("org_id", orgId),
  ]);
  const roleMap = new Map<string, MessagingRole[]>();
  for (const r of roles ?? []) {
    const list = roleMap.get(r.profile_id) ?? [];
    list.push(r.role as MessagingRole);
    roleMap.set(r.profile_id, list);
  }
  type P = { id: string; email: string | null; locale: string | null; locale_set_at?: string | null; is_active: boolean };
  return ((profs ?? []) as unknown as P[])
    .filter((p) => p.is_active)
    .map((p) => ({ id: p.id, email: p.email, locale: p.locale_set_at ? p.locale : null, app: appFor(roleMap.get(p.id) ?? ["parent"]) }));
}

async function deliver(opts: {
  orgId: string;
  recipients: Recipient[];
  category: NotificationCategory;
  type: "message" | "alert" | "new_contact";
  urgent?: boolean;
  /** Skip a recipient who already has an unread notification with this link from the last N minutes. */
  dedupeMinutes?: number;
  email?: boolean;
  build: (t: Translator, ctx: OrgEmailContext, r: Recipient) => Built;
}): Promise<{ inApp: number; emails: number }> {
  const db = msgAdminDb();
  if (!opts.recipients.length) return { inApp: 0, emails: 0 };
  const org = await getOrgEmailContext(opts.orgId);
  const [{ data: prefRows }, { data: settings }, { data: orgRow }] = await Promise.all([
    db.from("notification_preferences").select("profile_id,channels,quiet_start,quiet_end").eq("org_id", opts.orgId).in("profile_id", opts.recipients.map((r) => r.id)),
    db.from("messaging_settings").select("email_notifications,quiet_start,quiet_end").eq("org_id", opts.orgId).maybeSingle(),
    db.from("organizations").select("default_locale,country,currency,timezone").eq("id", opts.orgId).maybeSingle(),
  ]);
  const prefs = new Map((prefRows ?? []).map((p) => [p.profile_id, p]));
  const timeZone = org.f.timeZone;
  const now = new Date();
  let inApp = 0;
  let emails = 0;

  for (const r of opts.recipients) {
    const p = prefs.get(r.id);
    const d = resolveDelivery({
      category: opts.category,
      prefs: parseChannels(p?.channels),
      quiet: p ? { start: p.quiet_start, end: p.quiet_end } : null,
      orgQuiet: settings ? { start: settings.quiet_start, end: settings.quiet_end } : null,
      orgEmailEnabled: settings?.email_notifications ?? true,
      hasEmail: Boolean(r.email),
      now,
      timeZone,
      urgent: opts.urgent,
    });
    const o = orgRow as { default_locale: string | null; country: string | null; currency: string | null; timezone: string | null } | null;
    const { t } = getStandaloneI18n({ locale: r.locale ?? o?.default_locale ?? null, country: o?.country, currency: o?.currency, timeZone: o?.timezone });
    const built = opts.build(t, org, r);

    if (opts.dedupeMinutes) {
      const since = new Date(now.getTime() - opts.dedupeMinutes * 60_000).toISOString();
      const { count } = await db
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("org_id", opts.orgId)
        .eq("recipient_id", r.id)
        .eq("link", built.path)
        .is("read_at", null)
        .gte("created_at", since);
      if ((count ?? 0) > 0) continue;
    }

    let notificationId: string | null = null;
    if (d.inApp) {
      const { data, error } = await db
        .from("notifications")
        .insert({ org_id: opts.orgId, recipient_id: r.id, type: opts.type, title: built.title.slice(0, 200), body: built.body?.slice(0, 500) ?? null, link: built.path })
        .select("id")
        .single();
      if (error) logError("messaging.notify.inApp", error);
      else {
        inApp += 1;
        notificationId = (data as { id: string } | null)?.id ?? null;
      }
    }

    if ((opts.email ?? true) && d.email && r.email) {
      const html = messagingEmailHtml({
        brand: org.brand,
        heading: built.heading,
        lines: built.lines,
        quote: built.quote,
        cta: { label: built.cta, href: org.link(built.path) },
        footer: t("messaging.email.footer"),
      });
      const { data: log } = await db
        .from("email_logs")
        .insert({ org_id: opts.orgId, recipient_id: r.id, to_email: r.email, subject: built.subject, template: `messaging_${opts.type}`, html, status: "queued", attempts: 0, notification_id: notificationId })
        .select("id")
        .single();
      const sent = await sendEmail({ to: r.email, subject: built.subject, html, fromName: org.senderName ?? org.clubName });
      if (sent.ok) emails += 1;
      const logId = (log as { id: string } | null)?.id;
      if (logId) {
        await db
          .from("email_logs")
          .update({ status: sent.ok ? "sent" : "failed", attempts: 1, error: sent.ok ? null : sent.error ?? "unknown", sent_at: sent.ok ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
          .eq("id", logId);
      }
    }
  }
  return { inApp, emails };
}

/** Display name of a sender (coach name, else profile name; never contact details). */
async function senderName(db: MsgClient, orgId: string, profileId: string): Promise<string | null> {
  const [{ data: coach }, { data: prof }] = await Promise.all([
    db.from("coaches").select("display_name").eq("org_id", orgId).eq("profile_id", profileId).maybeSingle(),
    db.from("profiles").select("full_name").eq("org_id", orgId).eq("id", profileId).maybeSingle(),
  ]);
  return (coach as { display_name: string } | null)?.display_name ?? (prof as { full_name: string | null } | null)?.full_name ?? null;
}

const excerpt = (s: string, n = 280) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A new message: notify everyone in the thread's audience except the sender. */
export async function notifyNewMessage(opts: { orgId: string; conversationId: string; senderId: string; body: string }): Promise<void> {
  try {
    const db = msgAdminDb();
    const { data: conv } = await db
      .from("msg_conversations")
      .select("id,org_id,kind,subject,sensitive")
      .eq("id", opts.conversationId)
      .eq("org_id", opts.orgId)
      .maybeSingle();
    if (!conv) return;
    const { data: audience, error } = await db.rpc("msg_conversation_audience", { p_conv: conv.id });
    if (error) {
      logError("messaging.notify.audience", error);
      return;
    }
    const { data: muted } = await db.from("msg_participants").select("profile_id").eq("conversation_id", conv.id).eq("muted", true);
    const mutedIds = new Set((muted ?? []).map((m) => m.profile_id));
    const ids = (audience ?? []).map((a) => a.profile_id).filter((id) => id !== opts.senderId && !mutedIds.has(id));
    const recipients = await loadRecipients(db, opts.orgId, ids);
    const name = (await senderName(db, opts.orgId, opts.senderId)) ?? null;
    await deliver({
      orgId: opts.orgId,
      recipients,
      category: "messages",
      type: "message",
      dedupeMinutes: 30,
      build: (t, ctx, r) => {
        const who = name ?? t("messaging.common.someone");
        const sensitive = conv.sensitive;
        return {
          title: sensitive ? t("messaging.notify.newMessageTitleGeneric") : t("messaging.notify.newMessageTitle", { name: who }),
          body: sensitive ? t("messaging.notify.newMessageBodySensitive") : excerpt(opts.body, 160),
          path: threadPath(r.app, conv.id),
          subject: t("messaging.email.newMessage.subject", { club: ctx.clubName ?? "" }),
          heading: t("messaging.email.newMessage.heading"),
          lines: [sensitive ? t("messaging.email.newMessage.sensitive") : t("messaging.email.newMessage.from", { name: who })],
          quote: sensitive ? null : excerpt(opts.body),
          cta: t("messaging.email.newMessage.cta"),
        };
      },
    });
  } catch (e) {
    logError("messaging.notifyNewMessage", e);
  }
}

/** Send one alert to its audience (in-app + optional email), then mark it dispatched. */
export async function dispatchAlert(alert: AlertRow, opts?: { email?: boolean }): Promise<{ inApp: number; emails: number }> {
  const db = msgAdminDb();
  // Claim it first so two dispatchers never both send it.
  const { data: claimed } = await db
    .from("club_alerts")
    .update({ dispatched_at: new Date().toISOString() })
    .eq("id", alert.id)
    .eq("org_id", alert.org_id)
    .is("dispatched_at", null)
    .is("cancelled_at", null)
    .select("id");
  if (!claimed?.length) return { inApp: 0, emails: 0 };
  const { data: rows, error } = await db.rpc("club_alert_recipients", { p_alert: alert.id });
  if (error) {
    logError("messaging.alert.recipients", error);
    return { inApp: 0, emails: 0 };
  }
  const recipients = await loadRecipients(db, alert.org_id, (rows ?? []).map((r) => r.profile_id).filter((id) => id !== alert.created_by));
  return deliver({
    orgId: alert.org_id,
    recipients,
    category: "alerts",
    type: "alert",
    urgent: alert.severity === "urgent",
    email: opts?.email ?? true,
    build: (t, ctx, r) => ({
      title: t("messaging.notify.alertTitle", { title: alert.title }),
      body: alert.body ? excerpt(alert.body, 300) : null,
      path: APP_HOME[r.app],
      subject: t("messaging.email.alert.subject", { title: alert.title }),
      heading: alert.title,
      lines: [t.dynamic(`messaging.alerts.severity.${alert.severity}`, {}, alert.severity)],
      quote: alert.body,
      cta: t("messaging.email.alert.cta"),
    }),
  });
}

/**
 * Send every scheduled alert whose time has come (optionally one org only).
 * Called by the cron route and lazily when staff open the alerts page.
 */
export async function dispatchDueAlerts(orgId?: string, emailFor?: (a: AlertRow) => boolean): Promise<number> {
  const db = msgAdminDb();
  let q = db
    .from("club_alerts")
    .select("*")
    .is("dispatched_at", null)
    .is("cancelled_at", null)
    .lte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(50);
  if (orgId) q = q.eq("org_id", orgId);
  const { data, error } = await q;
  if (error) {
    logError("messaging.dueAlerts", error);
    return 0;
  }
  let n = 0;
  for (const a of (data ?? []) as AlertRow[]) {
    if (a.expires_at && new Date(a.expires_at) <= new Date()) continue;
    await dispatchAlert(a, { email: emailFor ? emailFor(a) : true });
    n += 1;
  }
  return n;
}

/** A new contact from the public form: tell the club's admins. */
export async function notifyNewLead(orgId: string, leadId: string, interest: string): Promise<void> {
  try {
    const db = msgAdminDb();
    const { data: admins } = await db.from("staff_roles").select("profile_id").eq("org_id", orgId).eq("role", "admin");
    const recipients = await loadRecipients(db, orgId, (admins ?? []).map((a) => a.profile_id));
    await deliver({
      orgId,
      recipients,
      category: "leads",
      type: "new_contact",
      build: (t) => {
        const kind = t.dynamic(`messaging.leads.interest.${interest}`, {}, interest);
        return {
          title: t("messaging.notify.leadTitle"),
          body: t("messaging.notify.leadBody", { interest: kind }),
          path: `/admin/leads/${leadId}`,
          subject: t("messaging.email.lead.subject", { interest: kind }),
          heading: t("messaging.email.lead.heading"),
          lines: [t("messaging.notify.leadBody", { interest: kind })],
          cta: t("messaging.email.lead.cta"),
        };
      },
    });
  } catch (e) {
    logError("messaging.notifyNewLead", e);
  }
}
