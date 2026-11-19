"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { headers } from "next/headers";
import { requireRole, writeAudit, type ActionResult } from "@/lib/people/server";
import { getTenant } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { getStandaloneI18n } from "@/lib/i18n/messages";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { sendEmail } from "@/lib/email/resend";
import { logError } from "@/lib/log";
import { msgAdminDb, msgDb } from "@/lib/messaging/db";
import { messagingEmailHtml } from "@/lib/messaging/email";
import { notifyNewLead } from "@/lib/messaging/notify";
import { clientIpFrom, hashClientIp, leadRateDecision, looksLikeBot } from "@/lib/messaging/rate-limit";
import { contactFormSchema, leadReplySchema, leadStatusSchema, messagingErrorKey, uuid, type ContactFormInput } from "@/lib/messaging/validation";

/**
 * New contacts ("Questions? Contact us"). The public form never names its
 * club: the org is resolved on the server from the request host (or the
 * page's slug, which must match the host's club), the honeypot and fill-time
 * trap drop bots silently, and the per-IP-hash / per-club rate limit is
 * checked here and again inside contact_lead_submit(). Admin actions work on
 * the signed-in admin's own club only (RLS: contact_leads is admin-only).
 */

export async function submitContactForm(input: ContactFormInput): Promise<ActionResult> {
  const t = await getTranslations();
  const p = contactFormSchema.safeParse(input);
  if (!p.success) {
    const consent = p.error.issues.some((i) => i.path[0] === "consent");
    return { ok: false, error: t(consent ? "messaging.errors.consentRequired" : "messaging.errors.contactInvalid") };
  }
  const v = p.data;
  // Bots: pretend success, store nothing.
  if (looksLikeBot(v.website, v.renderedAt ?? null, Date.now())) return { ok: true, message: t("messaging.contact.thanks") };

  const tenant = await getTenant();
  const admin = msgAdminDb();
  let orgId = tenant.id;
  if (v.clubSlug && v.clubSlug !== tenant.slug.toLowerCase()) {
    const named = tenant.source === "custom_domain" || tenant.source === "subdomain" || tenant.source === "unknown";
    if (named) return { ok: false, error: t("messaging.errors.notFound") };
    const { data } = await admin.from("organizations").select("id").eq("slug", v.clubSlug).maybeSingle();
    orgId = (data as { id: string } | null)?.id ?? null;
  }
  if (!orgId) return { ok: false, error: t("messaging.errors.notFound") };

  const hdrs = await headers();
  const ip = clientIpFrom((n) => hdrs.get(n));
  const secret = process.env.CONTACT_FORM_SECRET || process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const ipHash = hashClientIp(ip, orgId, secret);
  const now = Date.now();
  const iso = (ms: number) => new Date(now - ms).toISOString();
  const [ip10, ipDay, orgHour] = await Promise.all([
    ipHash ? admin.from("contact_leads").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("ip_hash", ipHash).gte("created_at", iso(10 * 60_000)) : Promise.resolve({ count: 0 }),
    ipHash ? admin.from("contact_leads").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("ip_hash", ipHash).gte("created_at", iso(24 * 3600_000)) : Promise.resolve({ count: 0 }),
    admin.from("contact_leads").select("id", { count: "exact", head: true }).eq("org_id", orgId).gte("created_at", iso(3600_000)),
  ]);
  const decision = leadRateDecision({ ipLast10Min: ip10.count ?? 0, ipLastDay: ipDay.count ?? 0, orgLastHour: orgHour.count ?? 0 });
  if (!decision.allowed) return { ok: false, error: t("messaging.errors.rateLimited") };

  const { data: leadId, error } = await admin.rpc("contact_lead_submit", {
    p_org: orgId,
    p_name: v.name,
    p_email: v.email,
    p_phone: v.phone,
    p_message: v.message,
    p_interest: v.interest,
    p_consent: v.consent,
    p_source: v.source ?? null,
    p_locale: t.locale,
    p_ip_hash: ipHash,
    p_program: v.programId ?? null,
  });
  if (error || !leadId) {
    logError("leads.submit", error);
    return { ok: false, error: t.dynamic(messagingErrorKey(error?.message)) };
  }
  // Audit without the person's details (the lead row itself is the record).
  await admin.from("audit_logs").insert({ org_id: orgId, actor_id: null, action: "lead.submit", target_table: "contact_leads", target_id: leadId, new_data: { interest: v.interest } });
  const finalOrg = orgId;
  after(() => notifyNewLead(finalOrg, leadId, v.interest));
  revalidatePath("/admin/leads");
  revalidatePath("/admin/notifications");
  return { ok: true, message: t("messaging.contact.thanks") };
}

export async function setLeadStatus(input: { leadId: string; status: "new" | "replied" | "converted" | "closed" }): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("messaging.errors.forbidden") };
  const p = leadStatusSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("messaging.errors.invalid") };
  const db = await msgDb();
  const { data, error } = await db
    .from("contact_leads")
    .update({ status: p.data.status, handled_by: me.id, closed_at: p.data.status === "closed" ? new Date().toISOString() : null })
    .eq("id", p.data.leadId)
    .eq("org_id", me.orgId)
    .select("id");
  if (error || !data?.length) return { ok: false, error: t("messaging.errors.forbidden") };
  await writeAudit(me, "lead.status", "contact_leads", p.data.leadId, { status: p.data.status });
  revalidatePath("/admin/leads");
  revalidatePath(`/admin/leads/${p.data.leadId}`);
  revalidatePath("/admin/notifications");
  return { ok: true, message: t("messaging.messages.leadUpdated") };
}

export async function replyToLead(input: { leadId: string; body: string }): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("messaging.errors.forbidden") };
  const p = leadReplySchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("messaging.errors.emptyMessage") };
  const db = await msgDb();
  const { data: lead } = await db.from("contact_leads").select("*").eq("id", p.data.leadId).eq("org_id", me.orgId).maybeSingle();
  if (!lead) return { ok: false, error: t("messaging.errors.notFound") };

  const org = await getOrgEmailContext(me.orgId, lead.locale);
  const { t: tl } = getStandaloneI18n({ locale: lead.locale });
  const subject = tl("messaging.email.leadReply.subject", { club: org.clubName ?? "" });
  const html = messagingEmailHtml({
    brand: org.brand,
    heading: tl("messaging.email.leadReply.heading"),
    lines: [tl("messaging.email.leadReply.greeting", { name: lead.name })],
    quote: p.data.body,
    cta: null,
    footer: tl("messaging.email.leadReply.footer"),
  });
  const sent = await sendEmail({ to: lead.email, subject, html, fromName: org.senderName ?? org.clubName });
  const { error } = await db.from("contact_lead_replies").insert({ org_id: me.orgId, lead_id: lead.id, author_id: me.id, body: p.data.body, email_sent: sent.ok });
  if (error) {
    logError("leads.reply", error);
    return { ok: false, error: t("messaging.errors.generic") };
  }
  await db
    .from("contact_leads")
    .update({ status: lead.status === "new" ? "replied" : lead.status, replied_at: new Date().toISOString(), handled_by: me.id })
    .eq("id", lead.id)
    .eq("org_id", me.orgId);
  await db.from("email_logs").insert({
    org_id: me.orgId, recipient_id: null, to_email: lead.email, subject, template: "messaging_lead_reply", html,
    status: sent.ok ? "sent" : "failed", attempts: 1, error: sent.ok ? null : sent.error ?? "unknown", sent_at: sent.ok ? new Date().toISOString() : null,
  });
  await writeAudit(me, "lead.reply", "contact_leads", lead.id, { email_sent: sent.ok });
  revalidatePath(`/admin/leads/${lead.id}`);
  revalidatePath("/admin/leads");
  return sent.ok
    ? { ok: true, message: t("messaging.messages.replySent") }
    : { ok: true, message: t("messaging.messages.replySavedNotSent") };
}

/** Turn a lead into a family record (reuses a family with the same contact email). */
export async function convertLeadToFamily(leadId: string): Promise<ActionResult<{ familyId: string }>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("messaging.errors.forbidden") };
  if (!uuid.safeParse(leadId).success) return { ok: false, error: t("messaging.errors.notFound") };
  const db = await msgDb();
  const { data: lead } = await db.from("contact_leads").select("*").eq("id", leadId).eq("org_id", me.orgId).maybeSingle();
  if (!lead) return { ok: false, error: t("messaging.errors.notFound") };
  if (lead.family_id) return { ok: true, message: t("messaging.messages.leadConverted"), data: { familyId: lead.family_id } };

  const { data: existing } = await db.from("families").select("id").eq("org_id", me.orgId).ilike("contact_email", lead.email).limit(1).maybeSingle();
  let familyId = (existing as { id: string } | null)?.id ?? null;
  if (!familyId) {
    const { data, error } = await db
      .from("families")
      .insert({ org_id: me.orgId, name: t("messaging.leads.familyName", { name: lead.name }).slice(0, 120), phone: lead.phone, contact_name: lead.name, contact_email: lead.email })
      .select("id")
      .single();
    if (error || !data) {
      logError("leads.convert", error);
      return { ok: false, error: t("messaging.errors.generic") };
    }
    familyId = (data as { id: string }).id;
  }
  const { error: upErr } = await db
    .from("contact_leads")
    .update({ status: "converted", family_id: familyId, handled_by: me.id })
    .eq("id", lead.id)
    .eq("org_id", me.orgId);
  if (upErr) {
    logError("leads.convert.link", upErr);
    return { ok: false, error: t("messaging.errors.generic") };
  }
  await writeAudit(me, "lead.convert", "contact_leads", lead.id, { family_id: familyId, reused: Boolean(existing) });
  revalidatePath("/admin/leads");
  revalidatePath(`/admin/leads/${lead.id}`);
  revalidatePath("/admin/families");
  return { ok: true, message: t("messaging.messages.leadConverted"), data: { familyId } };
}
