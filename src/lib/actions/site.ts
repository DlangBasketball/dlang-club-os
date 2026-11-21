"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "@/lib/i18n/server";
import { LOCALES } from "@/lib/i18n/config";
import { getTranslator } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/config";
import { getTenant, tenantMatchesOrg } from "@/lib/tenant/server";
import { writeAudit } from "@/lib/people/server";
import { logError } from "@/lib/log";
import { isLibraryPath } from "@/lib/media/cover";
import { getOrgCover } from "@/lib/media/server";
import { websiteDb, type WebsiteDb } from "@/lib/website/server";
import { callClaude } from "@/lib/ai/client";
import { getAssistantState } from "@/lib/ai/settings";
import { assistantActiveForClub } from "@/lib/ai/access";
import {
  applyTexts, imagesBelongTo, pageContentSchema, pageLangSchema, parsePageContent, postContentSchema, translatableTexts,
  type PageContent, type PageLang,
} from "@/lib/site/blocks";
import { isLanguageTag, parseLanguageList, uiCatalogFor } from "@/lib/site/languages";
import { isSafeRedirectTarget, isValidSitePath, normalizeRequestPath, slugify } from "@/lib/site/paths";
import { cleanFonts, cleanPalette, isSiteTemplate } from "@/lib/site/theme";
import { cleanNav } from "@/lib/site/nav";
import { buildStarterSite } from "@/lib/site/starter";
import { revalidateSite } from "@/lib/site/revalidate";
import { SOCIAL_KEYS as SITE_SOCIAL_KEYS } from "@/lib/website/settings-shape";

/**
 * Club site admin actions. The org is ALWAYS the signed-in admin's own org
 * (never from the client) and the request host must belong to it. Writes go
 * through the RLS-scoped session client (admin-only policies re-check every
 * verb); content is zod-validated, rich text sanitised, and every image must
 * be a library path of the same club.
 */

export type SiteResult<T = undefined> = { ok: true; message: string; data?: T } | { ok: false; error: string };

type Me = { id: string; orgId: string };

async function requireSiteAdmin(): Promise<Me | { error: string }> {
  const t = await getTranslations();
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return { error: t("site.errors.forbidden") };
  if (!(await tenantMatchesOrg(me.orgId))) return { error: t("site.errors.forbidden") };
  return { id: me.id, orgId: me.orgId };
}

async function db(): Promise<WebsiteDb> {
  return (await createClient()) as unknown as WebsiteDb;
}

function refresh(orgId: string, pageId?: string) {
  revalidateSite(orgId);
  revalidatePath("/admin/site", "layout");
  if (pageId) revalidatePath(`/admin/site/pages/${pageId}`);
}

function dbError(t: Awaited<ReturnType<typeof getTranslations>>, error: { message?: string; code?: string } | null): string {
  const m = error?.message ?? "";
  if (error?.code === "23505" || m.includes("duplicate key")) return t("site.errors.pathTaken");
  if (m.includes("SITE_PATH_IS_LANGUAGE")) return t("site.errors.pathIsLanguage");
  if (m.includes("site_pages_path_chk") || m.includes("site_path_valid")) return t("site.errors.pathInvalid");
  if (m.includes("site_settings_languages_chk")) return t("site.errors.languages");
  return t("site.errors.generic");
}

const uuid = z.string().uuid();

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const settingsInput = z.object({
  enabled: z.boolean(),
  template: z.string().refine(isSiteTemplate),
  languages: z.string().max(300),
  defaultLanguage: z.string().max(20),
  contactEmail: z.string().trim().max(254).optional().transform((v) => v || null).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)),
  logoPath: z.string().max(300).nullable().optional(),
  faviconPath: z.string().max(300).nullable().optional(),
  palette: z.record(z.string(), z.string().max(20)).default({}),
  fonts: z.record(z.string(), z.union([z.string().max(60), z.boolean()])).default({}),
  contactPhone: z.string().trim().max(40).optional().transform((v) => v || null).refine((v) => !v || /^[+0-9 ().\/-]{3,40}$/.test(v)),
  contactAddress: z.string().trim().max(300).optional().transform((v) => v || null),
  /** Header menu (validated by cleanNav: labels per language, safe links, one level of children). */
  headerNav: z.array(z.unknown()).max(12).optional(),
  social: z.record(z.string(), z.string().max(500)).default({}),
  titleSuffix: z.string().trim().max(80).optional(),
  description: z.record(z.string(), z.string().max(320)).default({}),
  ogImagePath: z.string().max(300).nullable().optional(),
  analyticsProvider: z.enum(["none", "plausible", "ga4"]).default("none"),
  analyticsId: z.string().trim().max(64).optional().refine((v) => !v || /^[A-Za-z0-9._-]{1,64}$/.test(v)),
  homePageId: uuid.nullable().optional(),
});
export type SiteSettingsInput = z.input<typeof settingsInput>;

export async function saveSiteSettings(input: SiteSettingsInput): Promise<SiteResult> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  const p = settingsInput.safeParse(input);
  if (!p.success) return { ok: false, error: t("site.errors.invalid") };
  const v = p.data;
  const { tags, invalid } = parseLanguageList(v.languages);
  if (invalid.length || !tags.length) return { ok: false, error: t("site.errors.languages") };
  const def = tags.find((x) => x.toLowerCase() === v.defaultLanguage.toLowerCase()) ?? tags[0]!;
  for (const path of [v.logoPath, v.faviconPath, v.ogImagePath]) if (path && !isLibraryPath(path, me.orgId)) return { ok: false, error: t("site.errors.image") };
  const social: Record<string, string> = {};
  for (const k of SITE_SOCIAL_KEYS) {
    const url = v.social[k]?.trim();
    if (!url) continue;
    if (!/^https:\/\/[^\s]+$/i.test(url)) return { ok: false, error: t("site.errors.social") };
    social[k] = url;
  }
  const description = Object.fromEntries(Object.entries(v.description).filter(([k, d]) => isLanguageTag(k) && d.trim()).map(([k, d]) => [k, d.trim()]));
  const s = await db();
  const { data: before } = await s.from("site_settings").select("enabled,launched_at").eq("org_id", me.orgId).maybeSingle();
  const row = {
    org_id: me.orgId,
    enabled: v.enabled,
    template: v.template,
    languages: tags,
    default_language: def,
    contact_email: v.contactEmail,
    contact_phone: v.contactPhone,
    contact_address: v.contactAddress,
    ...(v.headerNav ? { header_nav: cleanNav(v.headerNav) } : {}),
    logo_path: v.logoPath || null,
    favicon_path: v.faviconPath || null,
    palette: cleanPalette(v.palette),
    fonts: cleanFonts(v.fonts),
    social_links: social,
    seo: { titleSuffix: v.titleSuffix || undefined, description, ogImagePath: v.ogImagePath || null },
    analytics: v.analyticsProvider === "none" || !v.analyticsId ? {} : { provider: v.analyticsProvider, id: v.analyticsId },
    home_page_id: v.homePageId ?? null,
    launched_at: v.enabled ? ((before as { launched_at?: string } | null)?.launched_at ?? new Date().toISOString()) : ((before as { launched_at?: string } | null)?.launched_at ?? null),
  };
  const { error } = await s.from("site_settings").upsert(row, { onConflict: "org_id" });
  if (error) {
    logError("site.saveSettings", error);
    return { ok: false, error: dbError(t, error) };
  }
  await writeAudit(me, v.enabled && !(before as { enabled?: boolean } | null)?.enabled ? "site.enable" : "site.settings", "site_settings", null, { enabled: v.enabled, template: v.template, languages: tags });
  refresh(me.orgId);
  return { ok: true, message: t("site.settings.saved") };
}

/** Ensure a settings row exists (languages default to the club's app languages). */
async function ensureSettings(s: WebsiteDb, orgId: string): Promise<{ languages: string[]; defaultLanguage: string }> {
  const { data } = await s.from("site_settings").select("languages,default_language").eq("org_id", orgId).maybeSingle();
  if (data) return { languages: (data as { languages: string[] }).languages, defaultLanguage: (data as { default_language: string }).default_language };
  const tenant = await getTenant();
  const langs = parseLanguageList(tenant.supportedLocales?.length ? tenant.supportedLocales : [tenant.defaultLocale || "en"]).tags;
  const languages = langs.length ? langs : ["en"];
  const defaultLanguage = languages.find((l) => l === tenant.defaultLocale) ?? languages[0]!;
  await s.from("site_settings").insert({ org_id: orgId, languages, default_language: defaultLanguage });
  return { languages, defaultLanguage };
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

const createInput = z.object({ title: z.string().trim().min(1).max(200), path: z.string().trim().max(300).optional(), parentId: uuid.nullable().optional() });

export async function createSitePage(input: z.input<typeof createInput>): Promise<SiteResult<{ id: string }>> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  const p = createInput.safeParse(input);
  if (!p.success) return { ok: false, error: t("site.errors.invalid") };
  const s = await db();
  const { languages, defaultLanguage } = await ensureSettings(s, me.orgId);
  let parentPath = "";
  if (p.data.parentId) {
    const { data: parent } = await s.from("site_pages").select("path").eq("id", p.data.parentId).eq("org_id", me.orgId).maybeSingle();
    if (!parent) return { ok: false, error: t("site.errors.notFound") };
    parentPath = (parent as { path: string }).path === "/" ? "" : (parent as { path: string }).path;
  }
  const path = normalizeRequestPath(p.data.path?.trim() || `${parentPath}/${slugify(p.data.title) || "page"}`) ?? "";
  if (!isValidSitePath(path)) return { ok: false, error: t("site.errors.pathInvalid") };
  const content: PageContent = {};
  for (const l of languages) content[l] = l === defaultLanguage ? { title: p.data.title, state: "ok", blocks: [] } : { title: p.data.title, state: "needs_translation", blocks: [] };
  const { count } = await s.from("site_pages").select("id", { count: "exact", head: true }).eq("org_id", me.orgId);
  const { data, error } = await s
    .from("site_pages")
    .insert({ org_id: me.orgId, path, parent_id: p.data.parentId ?? null, content, position: (count ?? 0) * 10, created_by: me.id, updated_by: me.id, show_in_nav: !p.data.parentId })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: dbError(t, error) };
  refresh(me.orgId);
  return { ok: true, message: t("site.pages.created"), data: { id: (data as { id: string }).id } };
}

const metaInput = z.object({
  id: uuid,
  path: z.string().trim().max(300),
  parentId: uuid.nullable(),
  showInNav: z.boolean(),
  template: z.enum(["default", "landing", "narrow"]),
});

export async function updateSitePageMeta(input: z.input<typeof metaInput>): Promise<SiteResult> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  const p = metaInput.safeParse(input);
  if (!p.success) return { ok: false, error: t("site.errors.invalid") };
  const path = normalizeRequestPath(p.data.path) ?? "";
  if (!isValidSitePath(path)) return { ok: false, error: t("site.errors.pathInvalid") };
  if (p.data.parentId === p.data.id) return { ok: false, error: t("site.errors.invalid") };
  const s = await db();
  const { data: before } = await s.from("site_pages").select("path,status").eq("id", p.data.id).eq("org_id", me.orgId).maybeSingle();
  if (!before) return { ok: false, error: t("site.errors.notFound") };
  const { error } = await s
    .from("site_pages")
    .update({ path, parent_id: p.data.parentId, show_in_nav: p.data.showInNav, template: p.data.template, updated_by: me.id })
    .eq("id", p.data.id)
    .eq("org_id", me.orgId);
  if (error) return { ok: false, error: dbError(t, error) };
  const old = (before as { path: string; status: string }).path;
  // A published page moved: keep its old URL working (and its search ranking).
  if (old !== path && old !== "/" && (before as { status: string }).status !== "draft") {
    await s.from("site_redirects").upsert({ org_id: me.orgId, from_path: old, to_path: path, status_code: 301 }, { onConflict: "org_id,from_path" });
  }
  refresh(me.orgId, p.data.id);
  return { ok: true, message: t("site.pages.saved") };
}

export async function saveSitePageContent(input: { id: string; content: unknown; note?: string }): Promise<SiteResult> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  if (!uuid.safeParse(input?.id).success) return { ok: false, error: t("site.errors.invalid") };
  const p = pageContentSchema.safeParse(input.content);
  if (!p.success) {
    const issue = p.error.issues[0];
    return { ok: false, error: t("site.errors.content", { where: (issue?.path ?? []).slice(0, 4).join(" › ") || "-" }) };
  }
  if (!imagesBelongTo(p.data, me.orgId)) return { ok: false, error: t("site.errors.image") };
  const s = await db();
  const { data, error } = await s
    .from("site_pages")
    .update({ content: p.data, updated_by: me.id })
    .eq("id", input.id)
    .eq("org_id", me.orgId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: dbError(t, error) };
  if (!data) return { ok: false, error: t("site.errors.notFound") };
  await addVersion(s, me, input.id, p.data, input.note ?? "save");
  refresh(me.orgId, input.id);
  return { ok: true, message: t("site.editor.saved") };
}

async function addVersion(s: WebsiteDb, me: Me, pageId: string, content: unknown, note: string) {
  const { error } = await s.from("site_page_versions").insert({ org_id: me.orgId, page_id: pageId, content, note: note.slice(0, 120), created_by: me.id });
  if (error) logError("site.version", error);
  // Keep the newest 50 versions per page.
  const { data: old } = await s.from("site_page_versions").select("id").eq("org_id", me.orgId).eq("page_id", pageId).order("created_at", { ascending: false }).range(50, 200);
  const ids = ((old ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length) await s.from("site_page_versions").delete().eq("org_id", me.orgId).in("id", ids);
}

/** What goes live: languages with a title that are not waiting for a translation. */
function publishable(content: PageContent): PageContent {
  const out: PageContent = {};
  for (const [lang, v] of Object.entries(content)) if (v.title.trim() && v.state !== "needs_translation") out[lang] = { ...v, state: "ok" };
  return out;
}

const publishInput = z.object({ id: uuid, at: z.string().datetime({ offset: true }).optional() });

export async function publishSitePage(input: z.input<typeof publishInput>): Promise<SiteResult> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  const p = publishInput.safeParse(input);
  if (!p.success) return { ok: false, error: t("site.errors.invalid") };
  const s = await db();
  const { data: page } = await s.from("site_pages").select("content").eq("id", p.data.id).eq("org_id", me.orgId).maybeSingle();
  if (!page) return { ok: false, error: t("site.errors.notFound") };
  const content = parsePageContent((page as { content: unknown }).content);
  const live = publishable(content);
  if (!Object.keys(live).length) return { ok: false, error: t("site.errors.nothingToPublish") };
  const when = p.data.at ? new Date(p.data.at) : new Date();
  const scheduled = when.getTime() > Date.now() + 30_000;
  const { error } = await s
    .from("site_pages")
    .update({ status: scheduled ? "scheduled" : "published", published_at: when.toISOString(), published_content: live, updated_by: me.id })
    .eq("id", p.data.id)
    .eq("org_id", me.orgId);
  if (error) return { ok: false, error: dbError(t, error) };
  await addVersion(s, me, p.data.id, content, scheduled ? "schedule" : "publish");
  await writeAudit(me, scheduled ? "site.page.schedule" : "site.page.publish", "site_pages", p.data.id, { languages: Object.keys(live) });
  refresh(me.orgId, p.data.id);
  return { ok: true, message: scheduled ? t("site.editor.scheduled") : t("site.editor.published") };
}

export async function unpublishSitePage(id: string): Promise<SiteResult> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  if (!uuid.safeParse(id).success) return { ok: false, error: t("site.errors.invalid") };
  const s = await db();
  const { error } = await s.from("site_pages").update({ status: "draft", updated_by: me.id }).eq("id", id).eq("org_id", me.orgId);
  if (error) return { ok: false, error: dbError(t, error) };
  await writeAudit(me, "site.page.unpublish", "site_pages", id);
  refresh(me.orgId, id);
  return { ok: true, message: t("site.editor.unpublished") };
}

export async function deleteSitePage(id: string): Promise<SiteResult> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  if (!uuid.safeParse(id).success) return { ok: false, error: t("site.errors.invalid") };
  const s = await db();
  const { data, error } = await s.from("site_pages").delete().eq("id", id).eq("org_id", me.orgId).select("path").maybeSingle();
  if (error) return { ok: false, error: dbError(t, error) };
  if (!data) return { ok: false, error: t("site.errors.notFound") };
  await writeAudit(me, "site.page.delete", "site_pages", id, { path: (data as { path: string }).path });
  refresh(me.orgId);
  return { ok: true, message: t("site.pages.deleted") };
}

export async function duplicateSitePage(id: string): Promise<SiteResult<{ id: string }>> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  if (!uuid.safeParse(id).success) return { ok: false, error: t("site.errors.invalid") };
  const s = await db();
  const { data: src } = await s.from("site_pages").select("path,parent_id,content,template,position").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!src) return { ok: false, error: t("site.errors.notFound") };
  const r = src as { path: string; parent_id: string | null; content: unknown; template: string; position: number };
  const base = r.path === "/" ? "/home" : r.path;
  for (let n = 1; n <= 20; n++) {
    const path = `${base}-copy${n > 1 ? `-${n}` : ""}`;
    if (!isValidSitePath(path)) break;
    const { data, error } = await s
      .from("site_pages")
      .insert({ org_id: me.orgId, path, parent_id: r.parent_id, content: r.content, template: r.template, position: r.position + 1, created_by: me.id, updated_by: me.id })
      .select("id")
      .single();
    if (!error && data) {
      refresh(me.orgId);
      return { ok: true, message: t("site.pages.duplicated"), data: { id: (data as { id: string }).id } };
    }
    if (error && error.code !== "23505") return { ok: false, error: dbError(t, error) };
  }
  return { ok: false, error: t("site.errors.pathTaken") };
}

const orderInput = z.array(z.object({ id: uuid, parentId: uuid.nullable(), position: z.number().int().min(0).max(100000) })).max(500);

/** Save the page tree order (drag and drop or move buttons). */
export async function reorderSitePages(items: z.input<typeof orderInput>): Promise<SiteResult> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  const p = orderInput.safeParse(items);
  if (!p.success) return { ok: false, error: t("site.errors.invalid") };
  const s = await db();
  for (const it of p.data) {
    if (it.parentId === it.id) continue;
    const { error } = await s.from("site_pages").update({ parent_id: it.parentId, position: it.position }).eq("id", it.id).eq("org_id", me.orgId);
    if (error) return { ok: false, error: dbError(t, error) };
  }
  refresh(me.orgId);
  return { ok: true, message: t("site.pages.reordered") };
}

export async function restoreSiteVersion(input: { pageId: string; versionId: string }): Promise<SiteResult> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  if (!uuid.safeParse(input?.pageId).success || !uuid.safeParse(input?.versionId).success) return { ok: false, error: t("site.errors.invalid") };
  const s = await db();
  const [{ data: v }, { data: cur }] = await Promise.all([
    s.from("site_page_versions").select("content").eq("id", input.versionId).eq("page_id", input.pageId).eq("org_id", me.orgId).maybeSingle(),
    s.from("site_pages").select("content").eq("id", input.pageId).eq("org_id", me.orgId).maybeSingle(),
  ]);
  if (!v || !cur) return { ok: false, error: t("site.errors.notFound") };
  await addVersion(s, me, input.pageId, (cur as { content: unknown }).content, "before restore");
  const content = parsePageContent((v as { content: unknown }).content);
  const { error } = await s.from("site_pages").update({ content, updated_by: me.id }).eq("id", input.pageId).eq("org_id", me.orgId);
  if (error) return { ok: false, error: dbError(t, error) };
  refresh(me.orgId, input.pageId);
  return { ok: true, message: t("site.editor.restored") };
}

// ---------------------------------------------------------------------------
// Translation drafts (AI assistant add-on only; never auto-published)
// ---------------------------------------------------------------------------

/** Whether the "Draft translation" button is offered (club has the assistant add-on on). */
export async function siteTranslationAvailable(): Promise<boolean> {
  const me = await requireSiteAdmin();
  if ("error" in me) return false;
  try {
    return assistantActiveForClub(await getAssistantState(me.orgId));
  } catch {
    return false;
  }
}

const draftInput = z.object({ from: z.string().refine(isLanguageTag), to: z.string().refine(isLanguageTag), lang: z.unknown() });

/**
 * Machine draft of a page language: sends ONLY the page's own texts (titles,
 * headings, paragraphs) to the club's AI assistant, never personal data, and
 * returns the draft to the editor flagged "machine_draft". Nothing is saved
 * or published here.
 */
export async function draftSiteTranslation(input: z.input<typeof draftInput>): Promise<SiteResult<{ lang: PageLang }>> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  if (!(await siteTranslationAvailable())) return { ok: false, error: t("site.errors.aiUnavailable") };
  const p = draftInput.safeParse(input);
  const src = p.success ? pageLangSchema.safeParse(p.data.lang) : null;
  if (!p.success || !src?.success) return { ok: false, error: t("site.errors.invalid") };
  const texts = translatableTexts(src.data).slice(0, 400);
  if (!texts.length) return { ok: false, error: t("site.errors.nothingToTranslate") };
  const payload = Object.fromEntries(texts.map((x) => [x.key, x.text.slice(0, 4000)]));
  const system = [
    "You translate the public website of a sports club.",
    `Translate every JSON value from the language "${p.data.from}" into the language "${p.data.to}".`,
    "Keep the JSON keys unchanged. Keep HTML tags and links exactly as they are; translate only the visible text.",
    "Use the regional spelling of the target language (for example, Swiss German never uses the letter ß).",
    "Answer with the JSON object only.",
  ].join(" ");
  const res = await callClaude(system, JSON.stringify(payload));
  if (!res.ok) return { ok: false, error: t("site.errors.aiUnavailable") };
  let out: Record<string, string> = {};
  try {
    const raw = res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    out = Object.fromEntries(Object.entries(parsed).filter(([k, v]) => k in payload && typeof v === "string").map(([k, v]) => [k, String(v)]));
  } catch {
    return { ok: false, error: t("site.errors.aiUnavailable") };
  }
  const draft = applyTexts(src.data, out);
  const checked = pageLangSchema.safeParse({ ...draft, state: "machine_draft" });
  if (!checked.success) return { ok: false, error: t("site.errors.aiUnavailable") };
  await writeAudit(me, "site.translation.draft", "site_pages", null, { from: p.data.from, to: p.data.to, texts: texts.length });
  return { ok: true, message: t("site.editor.machineDraftReady"), data: { lang: checked.data } };
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

const postInput = z.object({
  id: uuid.optional(),
  slug: z.string().trim().max(160),
  status: z.enum(["draft", "published", "scheduled"]),
  publishedAt: z.string().datetime({ offset: true }).nullable().optional(),
  coverPath: z.string().max(300).nullable().optional(),
  authorName: z.string().trim().max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  content: z.unknown(),
});

export async function saveSitePost(input: z.input<typeof postInput>): Promise<SiteResult<{ id: string }>> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  const p = postInput.safeParse(input);
  if (!p.success) return { ok: false, error: t("site.errors.invalid") };
  const content = postContentSchema.safeParse(p.data.content);
  if (!content.success) return { ok: false, error: t("site.errors.invalid") };
  const slug = slugify(p.data.slug, 150) || slugify(Object.values(content.data)[0]?.title ?? "", 150);
  if (!slug) return { ok: false, error: t("site.errors.slug") };
  if (p.data.coverPath && !isLibraryPath(p.data.coverPath, me.orgId)) return { ok: false, error: t("site.errors.image") };
  const s = await db();
  const publishedAt = p.data.status === "draft" ? p.data.publishedAt ?? null : p.data.publishedAt ?? new Date().toISOString();
  const status = p.data.status !== "draft" && publishedAt && Date.parse(publishedAt) > Date.now() + 30_000 ? "scheduled" : p.data.status === "draft" ? "draft" : "published";
  const row = {
    org_id: me.orgId, slug, status, published_at: publishedAt, cover_path: p.data.coverPath || null,
    author_name: p.data.authorName || null, tags: Array.from(new Set(p.data.tags.map((x) => slugify(x, 40)).filter(Boolean))), content: content.data,
  };
  const q = p.data.id
    ? s.from("site_posts").update(row).eq("id", p.data.id).eq("org_id", me.orgId).select("id").maybeSingle()
    : s.from("site_posts").insert({ ...row, created_by: me.id }).select("id").single();
  const { data, error } = await q;
  if (error) return { ok: false, error: error.code === "23505" ? t("site.errors.slugTaken") : t("site.errors.generic") };
  if (!data) return { ok: false, error: t("site.errors.notFound") };
  refresh(me.orgId);
  revalidatePath("/admin/site/posts");
  return { ok: true, message: t("site.posts.saved"), data: { id: (data as { id: string }).id } };
}

export async function deleteSitePost(id: string): Promise<SiteResult> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  if (!uuid.safeParse(id).success) return { ok: false, error: t("site.errors.invalid") };
  const s = await db();
  const { error } = await s.from("site_posts").delete().eq("id", id).eq("org_id", me.orgId);
  if (error) return { ok: false, error: t("site.errors.generic") };
  refresh(me.orgId);
  revalidatePath("/admin/site/posts");
  return { ok: true, message: t("site.posts.deleted") };
}

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

const redirectInput = z.object({ from: z.string().trim().max(400), to: z.string().trim().max(500), status: z.union([z.literal(301), z.literal(302)]) });

export async function addSiteRedirect(input: z.input<typeof redirectInput>): Promise<SiteResult> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  const p = redirectInput.safeParse(input);
  if (!p.success) return { ok: false, error: t("site.errors.invalid") };
  let from = p.data.from;
  try {
    if (/^https?:\/\//i.test(from)) from = new URL(from).pathname;
  } catch {
    return { ok: false, error: t("site.errors.redirect") };
  }
  const fromPath = normalizeRequestPath(from);
  if (!fromPath || fromPath === "/" || !isSafeRedirectTarget(p.data.to) || fromPath === normalizeRequestPath(p.data.to)) return { ok: false, error: t("site.errors.redirect") };
  const s = await db();
  const { error } = await s.from("site_redirects").upsert({ org_id: me.orgId, from_path: fromPath, to_path: p.data.to, status_code: p.data.status }, { onConflict: "org_id,from_path" });
  if (error) return { ok: false, error: t("site.errors.redirect") };
  refresh(me.orgId);
  return { ok: true, message: t("site.redirects.saved") };
}

export async function deleteSiteRedirect(id: string): Promise<SiteResult> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  if (!uuid.safeParse(id).success) return { ok: false, error: t("site.errors.invalid") };
  const s = await db();
  const { error } = await s.from("site_redirects").delete().eq("id", id).eq("org_id", me.orgId);
  if (error) return { ok: false, error: t("site.errors.generic") };
  refresh(me.orgId);
  return { ok: true, message: t("site.redirects.deleted") };
}

// ---------------------------------------------------------------------------
// Form submissions
// ---------------------------------------------------------------------------

export async function setSiteSubmissionStatus(input: { id: string; status: "new" | "handled" | "spam" }): Promise<SiteResult> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  if (!uuid.safeParse(input?.id).success || !["new", "handled", "spam"].includes(input?.status)) return { ok: false, error: t("site.errors.invalid") };
  const s = await db();
  const { error } = await s.from("site_form_submissions").update({ status: input.status }).eq("id", input.id).eq("org_id", me.orgId);
  if (error) return { ok: false, error: t("site.errors.generic") };
  revalidatePath("/admin/site/forms");
  return { ok: true, message: t("site.forms.updated") };
}

export async function deleteSiteSubmission(id: string): Promise<SiteResult> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  if (!uuid.safeParse(id).success) return { ok: false, error: t("site.errors.invalid") };
  const s = await db();
  const { error } = await s.from("site_form_submissions").delete().eq("id", id).eq("org_id", me.orgId);
  if (error) return { ok: false, error: t("site.errors.generic") };
  revalidatePath("/admin/site/forms");
  return { ok: true, message: t("site.forms.deleted") };
}

// ---------------------------------------------------------------------------
// Media: "cleared for public use"
// ---------------------------------------------------------------------------

/**
 * Mark a library image as cleared for public use (people shown consented / no
 * identifiable minors without consent) or withdraw it. Only cleared images
 * are ever rendered on the public site.
 */
export async function setMediaPublicUse(input: { id: string; cleared: boolean }): Promise<SiteResult> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  if (!uuid.safeParse(input?.id).success) return { ok: false, error: t("site.errors.invalid") };
  const s = await db();
  const patch = input.cleared ? { public_use_confirmed_at: new Date().toISOString(), public_use_confirmed_by: me.id } : { public_use_confirmed_at: null, public_use_confirmed_by: null };
  const { data, error } = await s.from("media_assets").update(patch).eq("id", input.id).eq("org_id", me.orgId).select("id").maybeSingle();
  if (error) return { ok: false, error: t("site.errors.generic") };
  if (!data) return { ok: false, error: t("site.errors.notFound") };
  await writeAudit(me, input.cleared ? "media.public_use.confirm" : "media.public_use.withdraw", "media_assets", input.id);
  revalidateSite(me.orgId);
  revalidatePath("/admin/media");
  return { ok: true, message: input.cleared ? t("site.media.cleared") : t("site.media.withdrawn") };
}

// ---------------------------------------------------------------------------
// Starter site
// ---------------------------------------------------------------------------

/**
 * Create a complete starter site from the club's app data in all enabled
 * languages. Existing pages (same path) are never overwritten. Pages are
 * published at once unless `publish` is false.
 */
export async function generateStarterSite(input: { publish?: boolean } = {}): Promise<SiteResult<{ created: number; skipped: number }>> {
  const t = await getTranslations();
  const me = await requireSiteAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  const s = await db();
  const svc = websiteDb();
  const { languages, defaultLanguage } = await ensureSettings(s, me.orgId);
  const tenant = await getTenant();
  const cover = await getOrgCover(me.orgId);
  let coverPath: string | null = null;
  if (cover.path && isLibraryPath(cover.path, me.orgId)) {
    const { data } = await svc.from("media_assets").select("path").eq("org_id", me.orgId).eq("path", cover.path).not("public_use_confirmed_at", "is", null).maybeSingle();
    coverPath = data ? cover.path : null;
  }
  /** Does the club have at least one row matching (eq filters, optional "neq"/"gte" pairs)? */
  const has = async (table: string, eq: Record<string, unknown>, extra?: { neq?: [string, unknown]; gte?: [string, string] }) => {
    try {
      let q = svc.from(table).select("id", { count: "exact", head: true }).eq("org_id", me.orgId);
      for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
      if (extra?.neq) q = q.neq(extra.neq[0], extra.neq[1]);
      if (extra?.gte) q = q.gte(extra.gte[0], extra.gte[1]);
      const { count: c } = await q;
      return (c ?? 0) > 0;
    } catch {
      return false;
    }
  };
  const [camps, programs, teams, coaches, training, shop, campaigns, events] = await Promise.all([
    has("programs", { kind: "camp", is_public: true }),
    has("programs", { is_public: true }, { neq: ["kind", "camp"] }),
    has("teams", { is_public: true }),
    has("coaches", { is_public: true }),
    has("training_services", {}),
    has("shop_products", {}),
    has("fundraising_campaigns", { is_public: true }),
    has("events", {}, { gte: ["starts_at", new Date().toISOString()] }),
  ]);
  const tr = (lang: string, key: string, vars?: Record<string, string | number>) => getTranslator(uiCatalogFor(lang, LOCALES, defaultLanguage) as Locale).dynamic(key, vars ?? {}, key);
  const pages = buildStarterSite({
    clubName: tenant.name,
    coverPath,
    languages,
    has: { camps, programs, teams, coaches, training, shop, campaigns, news: true, events },
    t: tr,
    links: { camps: "/register/camps", book: `/book/${tenant.slug}`, shop: "/shop", donate: "/club/donate", login: "/login" },
  });
  const { data: existing } = await s.from("site_pages").select("path").eq("org_id", me.orgId);
  const taken = new Set(((existing ?? []) as { path: string }[]).map((r) => r.path));
  let created = 0;
  let skipped = 0;
  const publish = input.publish !== false;
  for (const pg of pages) {
    if (taken.has(pg.path)) {
      skipped++;
      continue;
    }
    const now = new Date().toISOString();
    const { error } = await s.from("site_pages").insert({
      org_id: me.orgId, path: pg.path, position: pg.position * 10, show_in_nav: pg.showInNav, content: pg.content, template: pg.path === "/" ? "landing" : "default",
      created_by: me.id, updated_by: me.id,
      ...(publish ? { status: "published", published_at: now, published_content: pg.content } : {}),
    });
    if (error) {
      logError("site.starter", error, { path: pg.path });
      skipped++;
    } else created++;
  }
  await writeAudit(me, "site.starter", "site_pages", null, { created, skipped, languages });
  refresh(me.orgId);
  return { ok: true, message: t("site.starter.done", { created, skipped }), data: { created, skipped } };
}
