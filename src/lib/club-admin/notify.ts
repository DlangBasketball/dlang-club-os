import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { getStandaloneI18n } from "@/lib/i18n/messages";
import { brandedMessage } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/resend";
import { logError } from "@/lib/log";

/**
 * Club-admin notices: one in-app notification per recipient profile plus an
 * email in the recipient's language, in the club's branded shell. Texts live
 * under clubadmin.email.<kind>.{subject,intro,cta}. Only what the recipient
 * already knows goes in: a child's FIRST name at most, never health details
 * or identity numbers.
 */
export type NoticeKind =
  | "membershipInvoice"
  | "membershipRenewal"
  | "waitlistOffer"
  | "waitlistAccepted"
  | "certificateExpiring"
  | "certificateExpiringAdmin"
  | "incidentRecorded";

export type Recipient = { profileId: string | null; email: string | null; locale: string | null };

export type NoticeParams = {
  name?: string;        // programme / membership / certificate name
  child?: string;       // child's first name
  coach?: string;       // coach display name (admin notices)
  date?: string | null; // ISO day or timestamp, formatted per recipient
  dateTime?: boolean;
  amount?: number | null;
  currency?: string | null;
  invoice?: string | null;
  days?: number | null;
  /** Certificate kind: translated per recipient when `name` is empty. */
  certKind?: string | null;
};

const TYPE: Record<NoticeKind, string> = {
  membershipInvoice: "payment",
  membershipRenewal: "payment",
  waitlistOffer: "registration",
  waitlistAccepted: "registration_confirmation",
  certificateExpiring: "system",
  certificateExpiringAdmin: "system",
  incidentRecorded: "system",
};

/** Guardians of a family (profiles in the same club), else the family contact email. */
export async function familyRecipients(orgId: string, familyId: string): Promise<Recipient[]> {
  const admin = createAdminClient();
  const { data: links } = await admin.from("family_members").select("profile_id").eq("family_id", familyId);
  const ids = (links ?? []).map((l) => l.profile_id);
  const out: Recipient[] = [];
  if (ids.length) {
    const { data: profiles } = await admin.from("profiles").select("id,email,locale,org_id").in("id", ids);
    for (const p of profiles ?? []) if (p.org_id === orgId) out.push({ profileId: p.id, email: p.email ? String(p.email) : null, locale: p.locale ?? null });
  }
  if (!out.length) {
    const { data: fam } = await admin.from("families").select("contact_email,org_id").eq("id", familyId).maybeSingle();
    const f = fam as { contact_email?: string | null; org_id?: string } | null;
    if (f?.org_id === orgId && f.contact_email) out.push({ profileId: null, email: String(f.contact_email), locale: null });
  }
  return out;
}

export async function profileRecipients(orgId: string, profileIds: (string | null | undefined)[]): Promise<Recipient[]> {
  const ids = Array.from(new Set(profileIds.filter((x): x is string => !!x)));
  if (!ids.length) return [];
  const { data } = await createAdminClient().from("profiles").select("id,email,locale,org_id").in("id", ids);
  return (data ?? []).filter((p) => p.org_id === orgId).map((p) => ({ profileId: p.id, email: p.email ? String(p.email) : null, locale: p.locale ?? null }));
}

/** The club's admins (staff role admin). */
export async function adminRecipients(orgId: string): Promise<Recipient[]> {
  const { data } = await createAdminClient().from("staff_roles").select("profile_id").eq("org_id", orgId).eq("role", "admin");
  return profileRecipients(orgId, (data ?? []).map((r) => r.profile_id));
}

/**
 * Send a notice. `link` is an app path (in-app + email CTA on the club host)
 * or an absolute URL (public waitlist acceptance link). Never throws.
 */
export async function sendNotice(opts: {
  orgId: string;
  kind: NoticeKind;
  recipients: Recipient[];
  params: NoticeParams;
  link: string;
  email?: boolean;
  invoiceId?: string | null;
}): Promise<number> {
  let sent = 0;
  try {
    const admin = createAdminClient();
    for (const r of opts.recipients) {
      const org = await getOrgEmailContext(opts.orgId, r.locale);
      const { t, f } = getStandaloneI18n({ locale: r.locale ?? undefined, currency: opts.params.currency ?? org.brand.currency ?? null, timeZone: org.f.timeZone });
      const p = opts.params;
      const vars = {
        name: p.name || (p.certKind ? t.dynamic(`clubadmin.compliance.kinds.${p.certKind}`, undefined, p.certKind) : ""), child: p.child ?? "", coach: p.coach ?? "", club: org.clubName ?? "",
        date: p.date ? (p.dateTime ? f.dateTime(p.date) : f.date(p.date)) : "",
        amount: p.amount != null ? f.money(p.amount, p.currency ?? undefined) : "",
        invoice: p.invoice ?? "", days: p.days ?? 0,
      };
      const title = t.dynamic(`clubadmin.email.${opts.kind}.subject`, vars);
      const intro = t.dynamic(`clubadmin.email.${opts.kind}.intro`, vars);
      const url = /^https?:\/\//.test(opts.link) ? opts.link : org.link(opts.link);
      const inAppLink = /^https?:\/\//.test(opts.link) ? null : opts.link;
      if (r.profileId) {
        await admin.from("notifications").insert({
          org_id: opts.orgId, recipient_id: r.profileId, type: TYPE[opts.kind] as "system", title, body: intro, link: inAppLink,
        });
      }
      if ((opts.email ?? true) && r.email) {
        const rows = [
          ...(p.invoice ? [{ label: t("clubadmin.email.invoice"), value: p.invoice }] : []),
          ...(vars.amount ? [{ label: t("clubadmin.email.amount"), value: vars.amount }] : []),
        ];
        const msg = brandedMessage({
          ...org.brand, title, intro, rows,
          cta: { label: t.dynamic(`clubadmin.email.${opts.kind}.cta`, vars), url },
          footer: t("clubadmin.email.footer"),
        });
        const { data: log } = await admin.from("email_logs")
          .insert({ org_id: opts.orgId, recipient_id: r.profileId, to_email: r.email, subject: msg.subject, template: `clubadmin.${opts.kind}`, html: msg.html, status: "queued", attempts: 0, invoice_id: opts.invoiceId ?? null })
          .select("id").single();
        const res = await sendEmail({ to: r.email, subject: msg.subject, html: msg.html, fromName: org.senderName ?? org.clubName });
        if (log) {
          await admin.from("email_logs")
            .update({ status: res.ok ? "sent" : "failed", attempts: 1, error: res.ok ? null : res.error ?? "unknown", sent_at: res.ok ? new Date().toISOString() : null })
            .eq("id", (log as { id: string }).id);
        }
        if (res.ok) sent += 1;
      }
    }
  } catch (e) {
    logError("clubadmin.notify", e, { kind: opts.kind });
  }
  return sent;
}
