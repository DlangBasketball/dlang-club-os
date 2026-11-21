import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { unstable_cache } from "next/cache";
import { getTenant } from "@/lib/tenant/server";
import { tenantReturnOrigin } from "@/lib/tenant/url";
import type { Tenant } from "@/lib/tenant/types";
import { LOCALES, intlLocaleFor, type Locale } from "@/lib/i18n/config";
import { getTranslator } from "@/lib/i18n/messages";
import type { Translator } from "@/lib/i18n/translator";
import { createFormatter, type Formatter } from "@/lib/format";
import { clubMediaPublicUrl, isLibraryPath } from "@/lib/media/cover";
import { logError } from "@/lib/log";
import { websiteDb } from "@/lib/website/server";
import { hasFeature } from "@/lib/upgrades/server";
import { parsePageContent, parsePostContent, type PageContent, type PostContent } from "./blocks";
import { isLanguageTag, uiCatalogFor } from "./languages";
import { isSiteTemplate, cleanFonts, cleanPalette, type SiteFonts, type SitePalette, type SiteTemplate } from "./theme";

/**
 * Server-side reads of the public club site. The club is ALWAYS resolved
 * from the request host (its own subdomain or custom domain); every read goes
 * through the site_public_* RPCs (service role, explicit org id), which return
 * published content of an enabled site only. Results are cached per club and
 * invalidated by tag (revalidateSite / revalidateSiteLive) when an admin
 * publishes or app data changes.
 */

export const SITE_REVALIDATE_SECONDS = 300;
export const siteTag = (orgId: string) => `site:${orgId}`;
export const siteLiveTag = (orgId: string) => `site-live:${orgId}`;

export type NavItem = { label: Record<string, string>; href: string; children?: NavItem[] };
export type FooterColumn = { title: Record<string, string>; links: { label: Record<string, string>; href: string }[] };

export type PublicSiteSettings = {
  template: SiteTemplate;
  homePageId: string | null;
  headerNav: NavItem[];
  footerColumns: FooterColumn[];
  social: Record<string, string>;
  logoPath: string | null;
  faviconPath: string | null;
  fonts: SiteFonts;
  palette: SitePalette;
  defaultLanguage: string;
  languages: string[];
  seo: { titleSuffix?: string; description?: Record<string, string>; ogImagePath?: string | null; noindex?: boolean };
  analytics: { provider?: "plausible" | "ga4" | null; id?: string | null };
  contactEmail: string | null;
  updatedAt: string | null;
};

export type PublicPageRow = { id: string; path: string; parentId: string | null; position: number; showInNav: boolean; titles: Record<string, string>; updatedAt: string };

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function rowToSiteSettings(raw: unknown): PublicSiteSettings {
  const o = asObj(raw);
  const langs = Array.isArray(o.languages) ? (o.languages as unknown[]).filter(isLanguageTag) : [];
  const def = isLanguageTag(o.default_language) ? o.default_language : langs[0] ?? "en";
  const social: Record<string, string> = {};
  for (const [k, v] of Object.entries(asObj(o.social_links))) if (typeof v === "string" && /^https:\/\//i.test(v) && v.length <= 500) social[k] = v;
  const seo = asObj(o.seo);
  const analytics = asObj(o.analytics);
  return {
    template: isSiteTemplate(o.template) ? o.template : "arena",
    homePageId: typeof o.home_page_id === "string" ? o.home_page_id : null,
    headerNav: Array.isArray(o.header_nav) ? (o.header_nav as NavItem[]).slice(0, 12) : [],
    footerColumns: Array.isArray(o.footer_columns) ? (o.footer_columns as FooterColumn[]).slice(0, 6) : [],
    social,
    logoPath: typeof o.logo_path === "string" ? o.logo_path : null,
    faviconPath: typeof o.favicon_path === "string" ? o.favicon_path : null,
    fonts: cleanFonts(o.fonts),
    palette: cleanPalette(o.palette),
    defaultLanguage: def,
    languages: langs.length ? langs : [def],
    seo: {
      titleSuffix: typeof seo.titleSuffix === "string" ? seo.titleSuffix.slice(0, 80) : undefined,
      description: Object.fromEntries(Object.entries(asObj(seo.description)).filter(([k, v]) => isLanguageTag(k) && typeof v === "string").map(([k, v]) => [k, String(v).slice(0, 320)])),
      ogImagePath: typeof seo.ogImagePath === "string" ? seo.ogImagePath : null,
      noindex: seo.noindex === true,
    },
    analytics: {
      provider: analytics.provider === "plausible" || analytics.provider === "ga4" ? analytics.provider : null,
      id: typeof analytics.id === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(analytics.id) ? analytics.id : null,
    },
    contactEmail: typeof o.contact_email === "string" ? o.contact_email : null,
    updatedAt: typeof o.updated_at === "string" ? o.updated_at : null,
  };
}

/** A host that names a club (its subdomain / custom domain) serves that club's site. */
export function hostServesSite(tenant: Pick<Tenant, "id" | "source" | "status">): boolean {
  return Boolean(tenant.id) && (tenant.source === "subdomain" || tenant.source === "custom_domain") && tenant.status !== "suspended";
}

const loadSettings = (orgId: string) =>
  unstable_cache(
    async () => {
      const { data, error } = await websiteDb().rpc("site_public_settings", { p_org: orgId });
      if (error) throw new Error(error.message);
      return data ? rowToSiteSettings(data) : null;
    },
    ["site-settings", orgId],
    { tags: [siteTag(orgId)], revalidate: SITE_REVALIDATE_SECONDS },
  )();

const loadPages = (orgId: string) =>
  unstable_cache(
    async () => {
      const { data, error } = await websiteDb().rpc("site_public_pages", { p_org: orgId });
      if (error) throw new Error(error.message);
      return ((data ?? []) as { id: string; path: string; parent_id: string | null; position: number; show_in_nav: boolean; titles: Record<string, unknown>; updated_at: string }[]).map(
        (r): PublicPageRow => ({
          id: r.id, path: r.path, parentId: r.parent_id, position: r.position, showInNav: r.show_in_nav, updatedAt: r.updated_at,
          titles: Object.fromEntries(Object.entries(r.titles ?? {}).filter(([, v]) => typeof v === "string")) as Record<string, string>,
        }),
      );
    },
    ["site-pages", orgId],
    { tags: [siteTag(orgId)], revalidate: SITE_REVALIDATE_SECONDS },
  )();

export type ResolvedSite = { orgId: string; tenant: Tenant & { id: string }; settings: PublicSiteSettings; pages: PublicPageRow[]; origin: string };

/** The site of the current request's host, or null (not a club host, site off, error). */
export const getRequestSite = cache(async (): Promise<ResolvedSite | null> => {
  const tenant = await getTenant();
  if (!hostServesSite(tenant)) return null;
  return loadSite(tenant as Tenant & { id: string });
});

/** Same, for a known club (admin preview). Never call with a client-supplied id. */
export async function loadSite(tenant: Tenant & { id: string }, opts: { allowDisabled?: boolean } = {}): Promise<ResolvedSite | null> {
  try {
    // The public site is a paid module: without it the club's site is off (data is kept).
    if (!opts.allowDisabled && !(await hasFeature(tenant.id, "site_builder"))) return null;
    let settings = await loadSettings(tenant.id);
    if (!settings && opts.allowDisabled) {
      const { data } = await websiteDb().from("site_settings").select("*").eq("org_id", tenant.id).maybeSingle();
      settings = rowToSiteSettings(data ?? { languages: tenant.supportedLocales, default_language: tenant.defaultLocale });
    }
    if (!settings) return null;
    const pages = await loadPages(tenant.id);
    let host: string | null = null;
    try {
      host = (await headers()).get("host");
    } catch {
      host = null;
    }
    return { orgId: tenant.id, tenant, settings, pages, origin: tenantReturnOrigin({ slug: tenant.slug, customDomain: tenant.customDomain }, host) };
  } catch (e) {
    logError("site.loadSite", e);
    return null;
  }
}

export type PublicPage = { id: string; path: string; parentId: string | null; template: string; publishedAt: string; updatedAt: string; content: PageContent };

export async function getPublicPage(orgId: string, path: string): Promise<PublicPage | null> {
  try {
    return await unstable_cache(
      async () => {
        const { data, error } = await websiteDb().rpc("site_public_page", { p_org: orgId, p_path: path });
        if (error) throw new Error(error.message);
        if (!data) return null;
        const r = data as { id: string; path: string; parent_id: string | null; template: string; published_at: string; updated_at: string; content: unknown };
        return { id: r.id, path: r.path, parentId: r.parent_id, template: r.template, publishedAt: r.published_at, updatedAt: r.updated_at, content: parsePageContent(r.content) };
      },
      ["site-page", orgId, path],
      { tags: [siteTag(orgId)], revalidate: SITE_REVALIDATE_SECONDS },
    )();
  } catch (e) {
    logError("site.getPublicPage", e);
    return null;
  }
}

export type PublicPost = { id: string; slug: string; publishedAt: string; updatedAt: string; coverPath: string | null; focalX: number; focalY: number; author: string | null; tags: string[]; content: PostContent };

function rowToPost(r: Record<string, unknown>): PublicPost {
  return {
    id: String(r.id), slug: String(r.slug), publishedAt: String(r.published_at), updatedAt: String(r.updated_at ?? r.published_at),
    coverPath: typeof r.cover_path === "string" ? r.cover_path : null, focalX: Number(r.cover_focal_x ?? 50), focalY: Number(r.cover_focal_y ?? 50),
    author: typeof r.author_name === "string" ? r.author_name : null, tags: Array.isArray(r.tags) ? (r.tags as string[]) : [], content: parsePostContent(r.content),
  };
}

export async function listPublicPosts(orgId: string, limit = 12, offset = 0, tag: string | null = null): Promise<PublicPost[]> {
  try {
    return await unstable_cache(
      async () => {
        const { data, error } = await websiteDb().rpc("site_public_posts", { p_org: orgId, p_limit: limit, p_offset: offset, p_tag: tag });
        if (error) throw new Error(error.message);
        return ((data ?? []) as Record<string, unknown>[]).map(rowToPost);
      },
      ["site-posts", orgId, String(limit), String(offset), tag ?? ""],
      { tags: [siteTag(orgId)], revalidate: SITE_REVALIDATE_SECONDS },
    )();
  } catch (e) {
    logError("site.listPublicPosts", e);
    return [];
  }
}

export async function getPublicPost(orgId: string, slug: string): Promise<PublicPost | null> {
  try {
    return await unstable_cache(
      async () => {
        const { data, error } = await websiteDb().rpc("site_public_post", { p_org: orgId, p_slug: slug });
        if (error) throw new Error(error.message);
        return data ? rowToPost(data as Record<string, unknown>) : null;
      },
      ["site-post", orgId, slug],
      { tags: [siteTag(orgId)], revalidate: SITE_REVALIDATE_SECONDS },
    )();
  } catch (e) {
    logError("site.getPublicPost", e);
    return null;
  }
}

export async function getSiteRedirect(orgId: string, path: string): Promise<{ to: string; status: 301 | 302 } | null> {
  try {
    const { data } = await websiteDb().rpc("site_public_redirect", { p_org: orgId, p_path: path });
    const r = ((data ?? []) as { to_path: string; status_code: number }[])[0];
    return r ? { to: r.to_path, status: r.status_code === 302 ? 302 : 301 } : null;
  } catch (e) {
    logError("site.getSiteRedirect", e);
    return null;
  }
}

/**
 * Library images the admin cleared for public use (media library toggle).
 * Anything else is never rendered on the public site (children in photos:
 * CLAUDE.md section 8). Returns path -> { url, alt }.
 */
export async function clearedImages(orgId: string, paths: readonly string[]): Promise<Map<string, { url: string; alt: string | null; width: number | null; height: number | null }>> {
  const mine = Array.from(new Set(paths.filter((p) => isLibraryPath(p, orgId)))).sort();
  const out = new Map<string, { url: string; alt: string | null; width: number | null; height: number | null }>();
  if (!mine.length) return out;
  try {
    const rows = await unstable_cache(
      async () => {
        const { data } = await websiteDb().from("media_assets").select("path,alt_text,width,height").eq("org_id", orgId).in("path", mine).not("public_use_confirmed_at", "is", null);
        return (data ?? []) as { path: string; alt_text: string | null; width: number | null; height: number | null }[];
      },
      ["site-cleared", orgId, mine.join("|").slice(0, 2000), String(mine.length)],
      { tags: [siteTag(orgId)], revalidate: SITE_REVALIDATE_SECONDS },
    )();
    for (const r of rows) out.set(r.path, { url: clubMediaPublicUrl(r.path), alt: r.alt_text, width: r.width, height: r.height });
  } catch (e) {
    logError("site.clearedImages", e);
  }
  return out;
}

/** Admin preview: every library image of the club, with its cleared flag (no cache). */
export async function previewImages(orgId: string, paths: readonly string[]): Promise<Map<string, { url: string; alt: string | null; width: number | null; height: number | null; cleared: boolean }>> {
  const mine = Array.from(new Set(paths.filter((p) => isLibraryPath(p, orgId))));
  const out = new Map<string, { url: string; alt: string | null; width: number | null; height: number | null; cleared: boolean }>();
  if (!mine.length) return out;
  const { data } = await websiteDb().from("media_assets").select("path,alt_text,width,height,public_use_confirmed_at").eq("org_id", orgId).in("path", mine);
  for (const r of (data ?? []) as { path: string; alt_text: string | null; width: number | null; height: number | null; public_use_confirmed_at: string | null }[]) {
    out.set(r.path, { url: clubMediaPublicUrl(r.path), alt: r.alt_text, width: r.width, height: r.height, cleared: !!r.public_use_confirmed_at });
  }
  return out;
}

/**
 * Translator + formatter for a site language. UI strings come from the
 * nearest app catalog (de-CH -> de -> site default -> en); dates, numbers and
 * money use the page language itself with the club's currency and time zone.
 */
export function siteI18n(lang: string, tenant: Pick<Tenant, "country" | "currency" | "timezone">, siteDefault?: string | null): { t: Translator; f: Formatter; ui: Locale; intl: string } {
  const ui = uiCatalogFor(lang, LOCALES, siteDefault) as Locale;
  let intl = lang;
  if (!lang.includes("-") && tenant.country) {
    const withRegion = `${lang}-${tenant.country.toUpperCase()}`;
    try {
      if (Intl.NumberFormat.supportedLocalesOf([withRegion]).length && ui === lang) intl = intlLocaleFor(ui, tenant.country);
      else if (Intl.NumberFormat.supportedLocalesOf([withRegion]).length) intl = withRegion;
    } catch {
      intl = lang;
    }
  }
  try {
    Intl.NumberFormat.supportedLocalesOf([intl]);
  } catch {
    intl = "en";
  }
  return { t: getTranslator(ui, intl), f: createFormatter({ locale: intl, currency: tenant.currency, timeZone: tenant.timezone }), ui, intl };
}

/** Public URL of a library path of this club (or null). */
export function libraryUrl(orgId: string, path: string | null | undefined): string | null {
  return path && isLibraryPath(path, orgId) ? clubMediaPublicUrl(path) : null;
}
