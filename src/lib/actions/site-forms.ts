"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { headers } from "next/headers";
import { logError } from "@/lib/log";
import { LOCALES } from "@/lib/i18n/config";
import type { Locale } from "@/lib/i18n/config";
import { getTranslator } from "@/lib/i18n/messages";
import { clientIpFrom, hashClientIp } from "@/lib/messaging/rate-limit";
import { notifyNewLead } from "@/lib/messaging/notify";
import { createRateLimiter } from "@/lib/website/rate-limit";
import { websiteDb } from "@/lib/website/server";
import { getRequestSite } from "@/lib/site/server";
import { isLanguageTag, uiCatalogFor } from "@/lib/site/languages";
import { leadInterestFor, looksLikeSpam, siteFormSchema, SITE_FORM_LIMITS, type SiteFormInput } from "@/lib/site/forms";

/**
 * Public site forms. The club is resolved from the request host only (the
 * form never names its club), bots are dropped silently (honeypot + fill-time
 * trap), and submissions are rate limited in-process per IP and in the
 * database per salted IP hash and per club (the IP itself is never stored).
 * Contact and join forms also land in the club's "New contacts" inbox
 * (contact_leads); applications stay in the site inbox (Admin -> Site -> Forms).
 */

export type SiteFormResult = { ok: true; message: string } | { ok: false; error: string };

const limiter = createRateLimiter({ limit: SITE_FORM_LIMITS.perIp10Min, windowMs: 10 * 60_000 });

export async function submitSiteForm(input: SiteFormInput): Promise<SiteFormResult> {
  const lang = typeof input?.lang === "string" && isLanguageTag(input.lang) ? input.lang : "en";
  const t = getTranslator(uiCatalogFor(lang, LOCALES) as Locale);
  const site = await getRequestSite();
  if (!site) return { ok: false, error: t("site.form.errors.unavailable") };
  const p = siteFormSchema.safeParse(input);
  if (!p.success) {
    const consent = p.error.issues.some((i) => i.path[0] === "consent");
    return { ok: false, error: t(consent ? "site.form.errors.consent" : "site.form.errors.invalid") };
  }
  const v = p.data;
  if (looksLikeSpam(v)) return { ok: true, message: t("site.form.thanks") };

  const hdrs = await headers();
  const ip = clientIpFrom((n) => hdrs.get(n));
  if (!limiter.check(`${site.orgId}:${ip}`).ok) return { ok: false, error: t("site.form.errors.rateLimited") };
  const secret = process.env.CONTACT_FORM_SECRET || process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const ipHash = hashClientIp(ip, site.orgId, secret);
  const db = websiteDb();

  const { data: row, error } = await db
    .from("site_form_submissions")
    .insert({
      org_id: site.orgId, kind: v.kind, name: v.name, email: v.email, phone: v.phone ?? null, message: v.message,
      locale: isLanguageTag(v.lang) ? v.lang : null, page_path: v.pagePath?.slice(0, 300) ?? null, consent: true, ip_hash: ipHash,
    })
    .select("id")
    .single();
  if (error || !row) {
    if (error?.message?.includes("RATE_LIMITED")) return { ok: false, error: t("site.form.errors.rateLimited") };
    logError("site.form.submit", error);
    return { ok: false, error: t("site.form.errors.generic") };
  }
  const submissionId = (row as { id: string }).id;

  // Contact / join: also a lead in the "New contacts" inbox.
  if (v.kind === "contact" || v.kind === "join") {
    const interest = leadInterestFor(v.kind);
    const { data: leadId, error: leadErr } = await db.rpc("contact_lead_submit", {
      p_org: site.orgId, p_name: v.name, p_email: v.email, p_phone: v.phone ?? null, p_message: v.message, p_interest: interest,
      p_consent: true, p_source: `site:${v.pagePath ?? "/"}`.slice(0, 200), p_locale: lang.slice(0, 10), p_ip_hash: null, p_program: null,
    });
    if (leadErr || !leadId) {
      logError("site.form.lead", leadErr);
    } else {
      await db.from("site_form_submissions").update({ lead_id: leadId }).eq("id", submissionId).eq("org_id", site.orgId);
      const orgId = site.orgId;
      after(() => notifyNewLead(orgId, leadId as string, interest));
      revalidatePath("/admin/leads");
    }
  }
  revalidatePath("/admin/site/forms");
  return { ok: true, message: t("site.form.thanks") };
}
