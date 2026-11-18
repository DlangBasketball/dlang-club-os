import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { getStandaloneI18n } from "@/lib/i18n/messages";
import { brandedMessage } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/resend";
import { logError } from "@/lib/log";
import { billingRecipientFilter } from "@/lib/family/billing";
import { pushOnly } from "@/lib/family/notify";

/**
 * Family notices for instalments, recurring fees and autopay: one in-app
 * notification per guardian + an email in the guardian's language, in the
 * club's branded shell, with the club's currency and time zone. Nothing but
 * the invoice number, amounts and dates is included (no child names, no card
 * details beyond brand + last 4 digits the parent already knows).
 */
export type PlanNoticeKind =
  | "reminderBefore"     // instalment / period due in N days
  | "overdue"            // instalment / period overdue
  | "periodInvoice"      // new recurring period invoice (no autopay)
  | "autopayCharged"     // card charged successfully
  | "authRequired"       // 3-D Secure needed: pay on-session
  | "chargeFailed"       // declined, retry scheduled
  | "fallback"           // retries exhausted: pay by QR-bill / online
  | "cardExpiring";      // saved card expires soon

export type PlanNoticeVars = {
  invoiceId?: string | null;
  invoiceNumber?: string;
  amount?: number;
  currency?: string;
  dueDate?: string | null;
  seq?: number | null;
  count?: number | null;
  retryDate?: string | null;
  card?: string | null;
  installmentId?: string | null;
};

type Recipient = { profileId: string | null; email: string; locale: string | null };

async function recipients(orgId: string, familyId: string): Promise<Recipient[]> {
  const admin = createAdminClient();
  const { data: links } = await admin.from("family_members").select("profile_id").eq("family_id", familyId);
  const ids = (links ?? []).map((l) => l.profile_id);
  const out: Recipient[] = [];
  if (ids.length) {
    const { data: profiles } = await admin.from("profiles").select("id,email,locale,org_id").in("id", ids);
    for (const p of profiles ?? []) {
      if (p.org_id === orgId && p.email) out.push({ profileId: p.id, email: String(p.email), locale: p.locale ?? null });
    }
  }
  if (!out.length) {
    const { data: fam } = await admin.from("families").select("contact_email,org_id").eq("id", familyId).maybeSingle();
    const f = fam as { contact_email?: string | null; org_id?: string } | null;
    if (f?.org_id === orgId && f.contact_email) out.push({ profileId: null, email: String(f.contact_email), locale: null });
  }
  return out;
}

function linkFor(kind: PlanNoticeKind, v: PlanNoticeVars): string {
  if (kind === "cardExpiring") return "/parent/payment-plans";
  if (!v.invoiceId) return "/parent/payment-plans";
  return v.installmentId ? `/parent/invoices/${v.invoiceId}?installment=${v.installmentId}` : `/parent/invoices/${v.invoiceId}`;
}

/** Sends one notice to every guardian of the family. Never throws. */
export async function notifyFamily(orgId: string, familyId: string, kind: PlanNoticeKind, vars: PlanNoticeVars): Promise<number> {
  let sent = 0;
  try {
    const admin = createAdminClient();
    // Split invoices: only the responsible payer; else guardians who receive emails.
    const people = await billingRecipientFilter(orgId, vars.invoiceId ?? null, familyId, await recipients(orgId, familyId));
    for (const r of people) {
      const org = await getOrgEmailContext(orgId, r.locale);
      const { t, f } = getStandaloneI18n({ locale: r.locale ?? undefined, currency: vars.currency ?? org.brand.currency ?? null, timeZone: org.f.timeZone });
      const money = vars.amount != null ? f.money(vars.amount, vars.currency ?? org.brand.currency ?? undefined) : "";
      const params = {
        invoice: vars.invoiceNumber ?? "", amount: money, date: vars.dueDate ? f.date(vars.dueDate) : "",
        seq: vars.seq ?? 0, count: vars.count ?? 0, retry: vars.retryDate ? f.date(vars.retryDate) : "",
        card: vars.card ?? "", club: org.clubName ?? "",
      };
      const title = t.dynamic(`plans.email.${kind}.subject`, params);
      const intro = t.dynamic(`plans.email.${kind}.intro`, params);
      const rows = [
        ...(vars.invoiceNumber ? [{ label: t("plans.email.invoice"), value: vars.invoiceNumber }] : []),
        ...(vars.seq && vars.count ? [{ label: t("plans.email.instalment"), value: t("plans.common.seqOf", { seq: vars.seq, count: vars.count }) }] : []),
        ...(money ? [{ label: t("plans.email.amount"), value: money }] : []),
        ...(vars.dueDate ? [{ label: t("plans.email.dueDate"), value: f.date(vars.dueDate) }] : []),
      ];
      const url = org.link(linkFor(kind, vars));
      const msg = brandedMessage({
        ...org.brand,
        title, intro, rows,
        note: kind === "fallback" || kind === "overdue" || kind === "periodInvoice" ? t("plans.email.payOptions") : null,
        cta: { label: t.dynamic(`plans.email.${kind}.cta`, params), url },
        footer: t("plans.email.footer"),
      });

      if (r.profileId) {
        await admin.from("notifications").insert({
          org_id: orgId, recipient_id: r.profileId, type: "payment", title, body: intro, link: linkFor(kind, vars),
        });
        // Payment due / failed reach the payer's devices too (Web Push, if opted in).
        if (kind === "reminderBefore" || kind === "overdue" || kind === "chargeFailed" || kind === "authRequired" || kind === "fallback") {
          await pushOnly({ orgId, profileIds: [r.profileId], category: "payments", title, body: intro, path: linkFor(kind, vars), tag: `pay-${vars.invoiceId ?? kind}` });
        }
      }
      const { data: log } = await admin.from("email_logs")
        .insert({ org_id: orgId, recipient_id: r.profileId, to_email: r.email, subject: msg.subject, template: `plans.${kind}`, html: msg.html, status: "queued", attempts: 0, invoice_id: vars.invoiceId ?? null })
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
    logError("plans.notify", e);
  }
  return sent;
}
