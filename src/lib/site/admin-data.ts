import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTenant } from "@/lib/tenant/server";
import type { WebsiteDb } from "@/lib/website/server";
import { getWebsiteSettings } from "@/lib/website/server";
import { parseLanguageList } from "./languages";
import { parsePageContent, parsePostContent, type PageContent, type PostContent } from "./blocks";
import { rowToSiteSettings, type PublicSiteSettings } from "./server";

/**
 * Admin reads for Admin -> Site. Session client: RLS (admin of the org) is
 * the boundary; every query also filters by the signed-in admin's org.
 */

export type AdminSite = {
  orgId: string;
  enabled: boolean;
  launchedAt: string | null;
  settings: PublicSiteSettings;
  websiteUrl: string | null;
  customDomain: string | null;
  slug: string;
  coachesPublic: boolean;
};

export type AdminPageRow = {
  id: string; path: string; parentId: string | null; position: number; status: "draft" | "published" | "scheduled"; publishedAt: string | null;
  showInNav: boolean; template: string; title: string; updatedAt: string; langs: { tag: string; state: string }[]; dirty: boolean;
};

async function db(): Promise<WebsiteDb> {
  return (await createClient()) as unknown as WebsiteDb;
}

export async function requireAdminOrg(): Promise<{ id: string; orgId: string } | null> {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return null;
  return { id: me.id, orgId: me.orgId };
}

export async function loadAdminSite(orgId: string): Promise<AdminSite> {
  const s = await db();
  const [{ data }, tenant, website] = await Promise.all([
    s.from("site_settings").select("*").eq("org_id", orgId).maybeSingle(),
    getTenant(),
    getWebsiteSettings(orgId),
  ]);
  const row = data as Record<string, unknown> | null;
  const fallbackLangs = parseLanguageList(tenant.supportedLocales?.length ? tenant.supportedLocales : [tenant.defaultLocale || "en"]).tags;
  const settings = rowToSiteSettings(row ?? { languages: fallbackLangs, default_language: fallbackLangs.includes(tenant.defaultLocale) ? tenant.defaultLocale : fallbackLangs[0] });
  return {
    orgId,
    enabled: row?.enabled === true,
    launchedAt: typeof row?.launched_at === "string" ? row.launched_at : null,
    settings,
    websiteUrl: website.websiteUrl,
    customDomain: tenant.customDomain,
    slug: tenant.slug,
    coachesPublic: website.sections.coaches,
  };
}

export async function listAdminPages(orgId: string, defaultLang: string): Promise<AdminPageRow[]> {
  const s = await db();
  const { data } = await s
    .from("site_pages")
    .select("id,path,parent_id,position,status,published_at,show_in_nav,template,content,published_content,updated_at")
    .eq("org_id", orgId)
    .order("position")
    .order("path")
    .limit(1000);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const content = parsePageContent(r.content);
    const title = content[defaultLang]?.title || Object.values(content)[0]?.title || String(r.path);
    return {
      id: String(r.id), path: String(r.path), parentId: (r.parent_id as string | null) ?? null, position: Number(r.position ?? 0),
      status: r.status as AdminPageRow["status"], publishedAt: (r.published_at as string | null) ?? null, showInNav: r.show_in_nav === true,
      template: String(r.template ?? "default"), title, updatedAt: String(r.updated_at),
      langs: Object.entries(content).map(([tag, v]) => ({ tag, state: v.state })),
      dirty: r.status !== "draft" && JSON.stringify(r.published_content ?? null) !== JSON.stringify(content),
    };
  });
}

export async function loadAdminPage(orgId: string, id: string) {
  const s = await db();
  const { data } = await s
    .from("site_pages")
    .select("id,path,parent_id,status,published_at,show_in_nav,template,content,updated_at")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const { data: versions } = await s
    .from("site_page_versions")
    .select("id,note,created_at")
    .eq("org_id", orgId)
    .eq("page_id", id)
    .order("created_at", { ascending: false })
    .limit(30);
  return {
    id: String(r.id), path: String(r.path), parentId: (r.parent_id as string | null) ?? null, status: String(r.status), publishedAt: (r.published_at as string | null) ?? null,
    showInNav: r.show_in_nav === true, template: String(r.template), content: parsePageContent(r.content) as PageContent, updatedAt: String(r.updated_at),
    versions: ((versions ?? []) as { id: string; note: string | null; created_at: string }[]).map((v) => ({ id: v.id, note: v.note, createdAt: v.created_at })),
  };
}

export type AdminPostRow = { id: string; slug: string; status: string; publishedAt: string | null; title: string; coverPath: string | null; authorName: string | null; tags: string[]; content: PostContent };

export async function listAdminPosts(orgId: string, defaultLang: string): Promise<AdminPostRow[]> {
  const s = await db();
  const { data } = await s.from("site_posts").select("id,slug,status,published_at,cover_path,author_name,tags,content").eq("org_id", orgId).order("published_at", { ascending: false, nullsFirst: true }).limit(500);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const content = parsePostContent(r.content);
    return {
      id: String(r.id), slug: String(r.slug), status: String(r.status), publishedAt: (r.published_at as string | null) ?? null,
      title: content[defaultLang]?.title || Object.values(content)[0]?.title || String(r.slug), coverPath: (r.cover_path as string | null) ?? null,
      authorName: (r.author_name as string | null) ?? null, tags: (r.tags as string[]) ?? [], content,
    };
  });
}

export async function listAdminRedirects(orgId: string) {
  const s = await db();
  const { data } = await s.from("site_redirects").select("id,from_path,to_path,status_code,created_at").eq("org_id", orgId).order("from_path").limit(2000);
  return ((data ?? []) as { id: string; from_path: string; to_path: string; status_code: number; created_at: string }[]).map((r) => ({ id: r.id, from: r.from_path, to: r.to_path, status: r.status_code, createdAt: r.created_at }));
}

export async function listAdminSubmissions(orgId: string) {
  const s = await db();
  const { data } = await s.from("site_form_submissions").select("id,kind,name,email,phone,message,locale,page_path,status,lead_id,created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(300);
  return ((data ?? []) as { id: string; kind: string; name: string; email: string; phone: string | null; message: string; locale: string | null; page_path: string | null; status: string; lead_id: string | null; created_at: string }[]).map((r) => ({
    id: r.id, kind: r.kind, name: r.name, email: r.email, phone: r.phone, message: r.message, locale: r.locale, pagePath: r.page_path, status: r.status, leadId: r.lead_id, createdAt: r.created_at,
  }));
}

/** Library images for the block editor's image picker (with the public-use flag). */
export async function listPickerImages(orgId: string) {
  const s = await db();
  const { data } = await s.from("media_assets").select("id,path,alt_text,width,height,public_use_confirmed_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(500);
  const { clubMediaPublicUrl, isLibraryPath } = await import("@/lib/media/cover");
  return ((data ?? []) as { id: string; path: string; alt_text: string | null; width: number | null; height: number | null; public_use_confirmed_at: string | null }[])
    .filter((r) => isLibraryPath(r.path, orgId))
    .map((r) => ({ id: r.id, path: r.path, url: clubMediaPublicUrl(r.path), alt: r.alt_text, cleared: !!r.public_use_confirmed_at }));
}
export type PickerImage = Awaited<ReturnType<typeof listPickerImages>>[number];

/** Go-live checklist (Admin -> Site). */
export function goLiveChecklist(site: AdminSite, pages: AdminPageRow[], redirects: number) {
  const home = pages.find((p) => p.path === "/" || p.id === site.settings.homePageId);
  return [
    { key: "pages", done: pages.some((p) => p.status !== "draft") },
    { key: "home", done: !!home && home.status !== "draft" },
    { key: "languages", done: pages.filter((p) => p.status !== "draft").every((p) => p.langs.every((l) => l.state !== "needs_translation")) },
    { key: "redirects", done: redirects > 0 || !site.websiteUrl },
    { key: "enabled", done: site.enabled },
    { key: "domain", done: !!site.customDomain },
    { key: "sitemap", done: site.enabled && !!home && home.status !== "draft" },
  ] as const;
}
