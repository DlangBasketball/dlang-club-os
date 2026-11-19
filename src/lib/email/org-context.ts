import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeBranding } from "@/lib/tenant/normalize";
import { resolveAppName } from "@/lib/tenant/app-name";
import { tenantBaseUrl, tenantLink } from "@/lib/tenant/url";
import { getStandaloneI18n } from "@/lib/i18n/messages";
import type { Formatter } from "@/lib/format";
import type { ClubBrand } from "./templates";

export type OrgEmailContext = {
  clubName: string | null;
  /** Email "From" display name: the club's app name ("DLang OS"), else the club name. */
  senderName: string | null;
  /** Branding + money/locale for the email templates. */
  brand: ClubBrand;
  /** Tenant-bound formatter (club currency, time zone; recipient language when known). */
  f: Formatter;
  /** https://<club host> — links in emails must open the club's own branded host. */
  baseUrl: string;
  link: (path: string) => string;
};

/**
 * Everything an outgoing email needs to look and read like the issuing club:
 * name, brand colour, logo, currency, locale, time zone and its own host.
 * Resolved per org with the service client (emails are sent from actions and
 * webhooks, outside the tenant's request). Server only.
 */
export async function getOrgEmailContext(orgId: string | null | undefined, recipientLocale?: string | null): Promise<OrgEmailContext> {
  type OrgRow = { name: string; slug: string; custom_domain: string | null; branding: unknown; country: string | null; currency: string | null; timezone: string | null; default_locale: string | null };
  let org: OrgRow | null = null;
  if (orgId) {
    const { data } = await createAdminClient()
      .from("organizations")
      .select("name,slug,custom_domain,branding,country,currency,timezone,default_locale")
      .eq("id", orgId)
      .maybeSingle();
    org = (data as OrgRow | null) ?? null;
  }
  const branding = normalizeBranding(org?.branding);
  const { f } = getStandaloneI18n({
    locale: recipientLocale ?? org?.default_locale ?? null,
    country: org?.country ?? null,
    currency: org?.currency ?? null,
    timeZone: org?.timezone ?? null,
  });
  const baseUrl = tenantBaseUrl({ slug: org?.slug, customDomain: org?.custom_domain });
  const logo = branding.logoUrl ? (branding.logoUrl.startsWith("/") ? (baseUrl ? tenantLink(baseUrl, branding.logoUrl) : null) : branding.logoUrl) : null;
  return {
    clubName: org?.name ?? null,
    senderName: org ? resolveAppName(org.name, org.branding) : null,
    brand: {
      clubName: org?.name ?? null,
      primaryColor: branding.colors.primary,
      background: branding.darkMode ? branding.colors.background : null,
      logoUrl: logo,
      currency: f.currency,
      locale: f.locale,
    },
    f,
    baseUrl,
    link: (path: string) => tenantLink(baseUrl, path),
  };
}
