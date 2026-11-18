import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { getStandaloneI18n } from "@/lib/i18n/messages";
import { brandedMessage } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/resend";
import { recipients } from "@/lib/plans/notify";
import { logError } from "@/lib/log";

/**
 * Dunning notices: in-app notification + e-mail to every guardian of the
 * family, in each guardian's language, in the club's branded shell, with the
 * club's currency. Only the invoice number, amounts and dates are included.
 */
export type DunningNotice = {
  notice_id: string; invoice_id: string; number: string; family_id: string; level: number; fee: number; balance: number;
  currency: string; due_date: string;
};

/** Sends one notice; returns true when at least one guardian got the e-mail. Never throws. */
export async function sendDunningNotice(orgId: string, n: DunningNotice): Promise<boolean> {
  let sent = 0;
  try {
    const admin = createAdminClient();
    const level = Math.min(Math.max(n.level, 1), 3);
    for (const r of await recipients(orgId, n.family_id)) {
      const org = await getOrgEmailContext(orgId, r.locale);
      const { t, f } = getStandaloneI18n({ locale: r.locale ?? undefined, currency: n.currency, timeZone: org.f.timeZone });
      const params = { invoice: n.number, amount: f.money(Number(n.balance), n.currency), fee: f.money(Number(n.fee), n.currency), date: f.date(n.due_date), club: org.clubName ?? "" };
      const title = t.dynamic(`accounting.email.level${level}.subject`, params);
      const intro = t.dynamic(`accounting.email.level${level}.intro`, params);
      const link = `/parent/invoices/${n.invoice_id}`;
      const msg = brandedMessage({
        ...org.brand,
        title, intro,
        rows: [
          { label: t("accounting.email.invoice"), value: n.number },
          { label: t("accounting.email.dueDate"), value: f.date(n.due_date) },
          ...(Number(n.fee) > 0 ? [{ label: t("accounting.email.fee"), value: params.fee }] : []),
          { label: t("accounting.email.balance"), value: params.amount },
        ],
        note: level === 3 ? t("accounting.email.level3.warning") : t("accounting.email.contact"),
        cta: { label: t("accounting.email.cta"), url: org.link(link) },
        footer: t("accounting.email.footer"),
      });
      if (r.profileId) {
        await admin.from("notifications").insert({ org_id: orgId, recipient_id: r.profileId, type: "payment", title, body: intro, link });
      }
      const { data: log } = await admin.from("email_logs")
        .insert({ org_id: orgId, recipient_id: r.profileId, to_email: r.email, subject: msg.subject, template: `dunning.level${level}`, html: msg.html, status: "queued", attempts: 0, invoice_id: n.invoice_id })
        .select("id").single();
      const res = await sendEmail({ to: r.email, subject: msg.subject, html: msg.html, fromName: org.senderName ?? org.clubName });
      if (log) {
        await admin.from("email_logs")
          .update({ status: res.ok ? "sent" : "failed", attempts: 1, error: res.ok ? null : res.error ?? "unknown", sent_at: res.ok ? new Date().toISOString() : null })
          .eq("id", (log as { id: string }).id);
      }
      if (res.ok) sent += 1;
    }
  } catch (e) {
    logError("accounting.dunning.notify", e);
  }
  return sent > 0;
}
