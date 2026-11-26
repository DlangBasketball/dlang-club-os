import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { logError } from "@/lib/log";
import { CLUB_MEDIA_BUCKET, libraryObjectPath, sniffCoverType, COVER_MAX_BYTES } from "@/lib/media/cover";
import { contrastRatio } from "@/lib/tenant/theme";
import { ResponseTooLargeError, UnsafeUrlError, safeFetch } from "@/lib/website/ssrf";
import type { WebsiteDb } from "@/lib/website/server";
import { pageContentSchema, parsePageContent, type PageContent, type PageLang } from "./blocks";
import { langSlug } from "./languages";
import { isReservedPath, isValidSitePath, localizedPath, normalizeRequestPath, postPath, slugify } from "./paths";
import {
  absoluteImageUrl, detectLanguages, extractImageUrls, groupTranslations, hasLiveFor, imageRefsOf, liveBlocksFor, mapWpItem, needsTranslation,
  pageLangFromItem, postBodyHtml, replaceImageRefs, sitePathFor, skipReasonFor, suggestLive, visibleText,
  type LiveSuggestion, type SkipReason, type WpItem, type WpLanguage,
} from "./wp-convert";
import { contentHash, editedSinceImport, rerunAction } from "./wp-rerun";
import {
  detectColors, detectFonts, extractContact, extractHeaderMenu, extractLogoUrl, extractSocialLinks, fontChoice, makeMenuResolver, menuFromRest, mergeMenus, pickMenuLocation,
  type DetectedContact, type SiteNavItem, type WpMenuItem,
} from "./wp-theme";

/**
 * "Import my current website": pages, posts and their images from a club's
 * WordPress site through its PUBLIC REST API (no credentials), plus the
 * site's frame read from its public home page(s): header menu (per
 * language), logo, theme fonts, brand colours, social profiles and contact
 * details. Works for any WordPress site (white-label). Network: server-side
 * only, through the SSRF-guarded fetcher (https only, private / internal IPs
 * refused, 10 s timeout, size caps per response).
 *
 *   preview  fetch + convert, write nothing
 *   run      write: images -> club media library (dedupe by source URL; alt
 *            text kept; cleared for public use ONLY if the admin ticked it;
 *            the club logo is a logo, not a photo, and is always cleared),
 *            pages / posts (original paths kept; reserved paths renamed),
 *            translations (WPML / Polylang, front pages matched per language),
 *            redirects for every changed URL, optionally the design (menu,
 *            logo, fonts, colours, social, contact: fills empty settings,
 *            replaces them only with "overwrite my edits") and live blocks.
 *            Idempotent: site_import_map (source, source id) -> row + hash of
 *            what was written; a re-run updates rows nobody edited since,
 *            keeps edited ones unless "overwrite my edits", and continues with
 *            images not yet copied.
 */

// Page-builder sites send very large page bodies, so lists are read in small pages
// (and the page size halves again if one page is still too large).
const PER_PAGE = 10;
const MAX_ITEMS_PER_LIST = 300;
const LIST_MAX_BYTES = 8_000_000;
const MAX_IMAGES_PER_RUN = 120;
const IMAGE_CONCURRENCY = 4;

const PAGE_FIELDS = "id,slug,link,parent,menu_order,status,title,content,excerpt,featured_media,date_gmt,modified_gmt,lang,translations,wpml_translations,wpml_current_locale";

export type ImportErrorCode = "unsafe_url" | "not_wordpress" | "network" | "too_large";

export class ImportError extends Error {
  constructor(public code: ImportErrorCode) {
    super(code);
  }
}

function codeOf(e: unknown): ImportErrorCode {
  if (e instanceof ImportError) return e.code;
  if (e instanceof UnsafeUrlError) return "unsafe_url";
  if (e instanceof ResponseTooLargeError) return "too_large";
  return "network";
}

/** https base URL of the WordPress site ("https://club.ch"), or null. */
export function normalizeBaseUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const u = new URL(input.trim().startsWith("http") ? input.trim() : `https://${input.trim()}`);
    if (u.protocol === "http:") u.protocol = "https:";
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

async function fetchJsonList(base: string, path: string, query: Record<string, string>): Promise<unknown[]> {
  const out: unknown[] = [];
  let perPage = PER_PAGE;
  let offset = 0;
  while (out.length < MAX_ITEMS_PER_LIST) {
    const u = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries({ ...query, per_page: String(perPage), offset: String(offset) })) u.searchParams.set(k, v);
    let res: Awaited<ReturnType<typeof safeFetch>>;
    try {
      res = await safeFetch(u.toString(), { timeoutMs: 15_000, maxBytes: LIST_MAX_BYTES, headers: { Accept: "application/json" } });
    } catch (e) {
      if (e instanceof ResponseTooLargeError && perPage > 1) {
        perPage = Math.max(1, Math.floor(perPage / 2));
        continue;
      }
      throw e;
    }
    if (res.status === 400 && offset > 0) break;
    if (res.status === 404 || res.status === 401 || res.status === 403) throw new ImportError("not_wordpress");
    if (!res.ok) throw new ImportError("network");
    let data: unknown;
    try {
      data = JSON.parse(res.text());
    } catch {
      throw new ImportError("not_wordpress");
    }
    if (!Array.isArray(data)) throw new ImportError("not_wordpress");
    out.push(...data);
    offset += data.length;
    const total = Number(res.headers.get("x-wp-total") ?? "0");
    if (data.length < perPage || (total && offset >= total)) break;
  }
  return out;
}

async function fetchText(url: string, maxBytes = 4_000_000): Promise<string | null> {
  try {
    const res = await safeFetch(url, { timeoutMs: 15_000, maxBytes, headers: { Accept: "text/html" } });
    return res.ok ? res.text() : null;
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw new ImportError("unsafe_url");
    return null;
  }
}

type WpRoot = { name: string | null; description: string | null; frontPageId: string | null; siteIconUrl: string | null };

/** WordPress REST root (site name, tagline, front page id, site icon), per language when prefixed (/fr/wp-json/). */
async function fetchRoot(url: string): Promise<WpRoot | null> {
  try {
    const res = await safeFetch(url, { timeoutMs: 15_000, maxBytes: 3_000_000, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const j = JSON.parse(res.text()) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null);
    const front = typeof j.page_on_front === "number" && j.page_on_front > 0 && j.show_on_front === "page" ? String(j.page_on_front) : null;
    return { name: str(j.name), description: str(j.description), frontPageId: front, siteIconUrl: str(j.site_icon_url) };
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await safeFetch(url, { timeoutMs: 10_000, maxBytes: 2_000_000, headers: { Accept: "application/json" } });
    return res.ok ? JSON.parse(res.text()) : null;
  } catch {
    return null;
  }
}

/** Header menu from the public menus REST endpoint (plugin), or null; the home page HTML is the fallback. */
async function fetchRestMenu(apiBase: string): Promise<WpMenuItem[] | null> {
  const loc = pickMenuLocation(await fetchJson(`${apiBase}/wp-json/menus/v1/locations`));
  if (!loc) return null;
  const items = menuFromRest(await fetchJson(`${apiBase}/wp-json/menus/v1/locations/${encodeURIComponent(loc)}`));
  return items.length ? items : null;
}

export type ImportPlanPage = {
  sourceId: string;
  title: string;
  oldPath: string;
  newPath: string;
  translations: string[];
  images: number;
  skip: SkipReason | null;
  /** Live block the page gets when "add live blocks" is ticked. */
  live: LiveSuggestion | null;
};

/** What the importer found about the site's look (shown in the preview, applied on request). */
export type ImportPlanDesign = {
  menu: SiteNavItem[];
  logoUrl: string | null;
  fonts: { detectedDisplay: string | null; detectedBody: string | null; display: string | null; ui: string | null; uppercase: boolean };
  colors: { primary: string | null; accent: string | null; primaryContrastOnWhite: number | null; primaryContrastOnDark: number | null };
  social: Record<string, string>;
  contact: DetectedContact;
  tagline: string | null;
};

export type ImportPlan = {
  baseUrl: string;
  languages: WpLanguage[];
  defaultLanguage: string;
  pages: ImportPlanPage[];
  posts: { sourceId: string; title: string; slug: string; oldPath: string; translations: string[] }[];
  unmatched: { sourceId: string; title: string; lang: string | null; path: string }[];
  imageCount: number;
  missingLanguages: string[];
  design: ImportPlanDesign;
};

type Loaded = {
  plan: ImportPlan;
  groups: ReturnType<typeof groupTranslations>["groups"];
  postGroups: ReturnType<typeof groupTranslations>["groups"];
  prefixes: WpLanguage[];
  menus: { lang: string; items: WpMenuItem[] }[];
  tagline: string | null;
};

const ratio = (a: string | null, b: string) => (a ? Math.round(contrastRatio(a, b) * 100) / 100 : null);

/** Fetch and convert (no writes). `siteLanguages` = the club site's enabled languages. */
export async function loadWordPress(baseInput: string, site: { languages: readonly string[]; defaultLanguage: string; takenPaths?: ReadonlySet<string> }): Promise<Loaded> {
  const base = normalizeBaseUrl(baseInput);
  if (!base) throw new ImportError("unsafe_url");
  let basePath = "/";
  try {
    basePath = new URL(base).pathname || "/";
  } catch {
    /* "/" */
  }
  const homeHtml = await fetchText(`${base}/`);
  const languages: WpLanguage[] = homeHtml ? detectLanguages(homeHtml, base) : [];
  const wpDefault = languages.find((l) => !l.prefix)?.tag ?? site.defaultLanguage;
  const extra = languages.filter((l) => l.prefix);

  // Home pages + REST roots per language (menus, front page ids, tagline).
  const [root, extraHomes, extraRoots, restMenus] = await Promise.all([
    fetchRoot(`${base}/wp-json/`),
    Promise.all(extra.map((l) => fetchText(`${base}/${l.prefix}/`).catch(() => null))),
    Promise.all(extra.map((l) => fetchRoot(`${base}/${l.prefix}/wp-json/`))),
    Promise.all([fetchRestMenu(base), ...extra.map((l) => fetchRestMenu(`${base}/${l.prefix}`))]),
  ]);
  const fronts = new Set([root?.frontPageId, ...extraRoots.map((r) => r?.frontPageId)].filter((x): x is string => !!x));

  const loadAll = async (path: string, extraQuery: Record<string, string>) => {
    const main = await fetchJsonList(base, path, { _fields: PAGE_FIELDS, ...extraQuery });
    const others = await Promise.all(extra.map((l) => fetchJsonList(base, path, { _fields: PAGE_FIELDS, lang: l.prefix!, ...extraQuery }).then((rows) => ({ l, rows })).catch(() => ({ l, rows: [] as unknown[] }))));
    const seen = new Set<string>();
    const items: WpItem[] = [];
    const add = (it: WpItem | null) => {
      if (!it || seen.has(it.sourceId)) return;
      seen.add(it.sourceId);
      // The front page of each language is the home page, whatever its slug / link.
      if (fronts.has(it.sourceId)) it.path = "/";
      items.push(it);
    };
    for (const raw of main) add(mapWpItem(raw, { basePath, langPrefixes: languages }));
    for (const { l, rows } of others) for (const raw of rows) add(mapWpItem(raw, { basePath, langPrefixes: languages, lang: l.tag }));
    return items;
  };

  const [pages, posts] = await Promise.all([loadAll("/wp-json/wp/v2/pages", { orderby: "menu_order", order: "asc" }), loadAll("/wp-json/wp/v2/posts", { orderby: "date", order: "desc" }).catch(() => [] as WpItem[])]);
  const { groups, unmatched } = groupTranslations(pages, wpDefault);
  const { groups: postGroups } = groupTranslations(posts, wpDefault);
  const taken = new Set<string>(site.takenPaths ?? []);
  const langSlugs = site.languages.map(langSlug);
  const planPages: ImportPlanPage[] = groups.map((g) => {
    const skip = skipReasonFor({ slug: g.main.slug, status: g.main.status, html: g.main.html });
    const target = skip ? { path: g.main.path } : sitePathFor(g.main, taken, langSlugs);
    if (!skip) taken.add(target.path);
    return {
      sourceId: g.main.sourceId, title: g.main.title || g.main.slug, oldPath: g.main.path, newPath: target.path,
      translations: Object.keys(g.translations), images: extractImageUrls(g.main.html, g.main.link).length, skip,
      live: skip ? null : suggestLive({ slug: g.main.slug, title: g.main.title, path: target.path }),
    };
  });
  const imageCount = new Set(groups.flatMap((g) => [g.main, ...Object.values(g.translations)]).flatMap((it) => extractImageUrls(it.html, it.link))).size;
  const wpLangs = new Set([wpDefault, ...extra.map((l) => l.tag)].map((l) => l.split("-")[0]));

  // Design: menu (per language), logo, fonts, colours, social, contact.
  const menus = [
    { lang: wpDefault, items: restMenus[0] ?? (homeHtml ? extractHeaderMenu(homeHtml) : []) },
    ...extra.map((l, i) => ({ lang: l.tag, items: restMenus[i + 1] ?? (extraHomes[i] ? extractHeaderMenu(extraHomes[i]!) : []) })),
  ];
  const pathMap = new Map<string, string>();
  for (const g of groups) {
    const planned = planPages.find((p) => p.sourceId === g.main.sourceId);
    if (!planned || planned.skip) continue;
    pathMap.set(g.main.path, planned.newPath);
    for (const it of Object.values(g.translations)) if (!pathMap.has(it.path)) pathMap.set(it.path, planned.newPath);
  }
  for (const g of postGroups) {
    const slug = slugify(decodeURIComponentSafe(g.main.slug), 150);
    if (slug && !pathMap.has(g.main.path)) pathMap.set(g.main.path, postPath(slug));
  }
  const resolve = makeMenuResolver({ baseUrl: base, prefixes: languages, pathMap });
  const fontsFound = homeHtml ? detectFonts(homeHtml) : { display: null, body: null, uppercase: false, families: [] };
  const fonts = fontChoice(fontsFound);
  const colors = homeHtml ? detectColors(homeHtml) : { primary: null, accent: null };
  const design: ImportPlanDesign = {
    menu: mergeMenus(menus.filter((m) => m.items.length), wpDefault, resolve),
    logoUrl: (homeHtml ? extractLogoUrl(homeHtml, `${base}/`, absoluteImageUrl) : null) ?? absoluteImageUrl(root?.siteIconUrl ?? null),
    fonts: { detectedDisplay: fontsFound.display, detectedBody: fontsFound.body, display: fonts.display ?? null, ui: fonts.ui ?? null, uppercase: !!fonts.uppercase },
    colors: { ...colors, primaryContrastOnWhite: ratio(colors.primary, "#FFFFFF"), primaryContrastOnDark: ratio(colors.primary, "#0A0A0A") },
    social: homeHtml ? extractSocialLinks(homeHtml) : {},
    contact: homeHtml ? extractContact(homeHtml) : { email: null, phone: null, address: null },
    tagline: root?.description ?? null,
  };

  return {
    plan: {
      baseUrl: base,
      languages,
      defaultLanguage: wpDefault,
      pages: planPages,
      posts: postGroups.slice(0, 200).map((g) => ({ sourceId: g.main.sourceId, title: g.main.title, slug: g.main.slug, oldPath: g.main.path, translations: Object.keys(g.translations) })),
      unmatched: unmatched.map((u) => ({ sourceId: u.sourceId, title: u.title, lang: u.lang, path: u.path })),
      imageCount,
      missingLanguages: site.languages.filter((l) => !wpLangs.has(l.split("-")[0]!)),
      design,
    },
    groups,
    postGroups,
    prefixes: languages,
    menus,
    tagline: design.tagline,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export type ImportReport = {
  pagesCreated: number;
  pagesUpdated: number;
  pagesKept: number;
  postsCreated: number;
  postsUpdated: number;
  postsKept: number;
  imagesImported: number;
  imagesFailed: number;
  imagesRemaining: number;
  redirects: number;
  liveBlocks: number;
  menuItems: number;
  designApplied: number;
  skipped: number;
};

export type ImportRunOptions = {
  orgId: string;
  actorId: string;
  baseUrl: string;
  languages: readonly string[];
  defaultLanguage: string;
  clearedForPublic: boolean;
  publish: boolean;
  /** Menu, logo, fonts, colours, social links and contact details from the old site. */
  applyDesign?: boolean;
  /** Append the matching live block (camps, schedule, training, shop, news, sponsors). */
  addLiveBlocks?: boolean;
  /** Re-import: also replace pages / posts / settings the admin edited after the last import. */
  overwriteEdits?: boolean;
};

type MapRow = { source: string; source_id: string; target_id: string; content_hash: string | null; last_imported_at: string | null };
const urlKey = (url: string) => createHash("sha256").update(url).digest("hex").slice(0, 64);

async function copyImage(db: WebsiteDb, orgId: string, actorId: string, url: string, alt: string | null, cleared: boolean): Promise<string | null> {
  try {
    const res = await safeFetch(url, { timeoutMs: 15_000, maxBytes: COVER_MAX_BYTES, headers: { Accept: "image/webp,image/jpeg,image/png" } });
    if (!res.ok) return null;
    const type = sniffCoverType(res.bytes);
    if (!type) return null;
    const path = libraryObjectPath(orgId, "gallery", type, randomUUID());
    const up = await db.storage.from(CLUB_MEDIA_BUCKET).upload(path, res.bytes, { contentType: type, upsert: false, cacheControl: "31536000" });
    if (up.error) {
      logError("site.import.upload", up.error);
      return null;
    }
    const now = new Date().toISOString();
    const { data, error } = await db
      .from("media_assets")
      .insert({
        org_id: orgId, path, kind: "gallery", size_bytes: res.bytes.byteLength, mime_type: type, alt_text: alt?.slice(0, 300) || null,
        uploaded_by: actorId, consent_note: null,
        ...(cleared ? { public_use_confirmed_at: now, public_use_confirmed_by: actorId } : {}),
      })
      .select("id")
      .single();
    if (error || !data) {
      await db.storage.from(CLUB_MEDIA_BUCKET).remove([path]);
      logError("site.import.media", error);
      return null;
    }
    await db.from("site_import_map").upsert(
      { org_id: orgId, source: "wp_media", source_id: urlKey(url), source_url: url.slice(0, 1000), target_table: "media_assets", target_id: (data as { id: string }).id, last_imported_at: now },
      { onConflict: "org_id,source,source_id" },
    );
    return path;
  } catch (e) {
    if (!(e instanceof ResponseTooLargeError)) logError("site.import.image", e);
    return null;
  }
}

/** What goes live on publish (same rule as the editor's publish). */
function publishable(content: PageContent): PageContent {
  const out: PageContent = {};
  for (const [lang, v] of Object.entries(content)) if (v.title.trim() && v.state !== "needs_translation") out[lang] = { ...v, state: "ok" };
  return out;
}

/** Map WordPress languages to the club site's languages (exact tag, else same base language). */
function siteLangFor(languages: readonly string[], defaultLanguage: string) {
  return (wpLang: string | null): string | null => {
    if (!wpLang) return defaultLanguage;
    const exact = languages.find((l) => l.toLowerCase() === wpLang.toLowerCase());
    return exact ?? languages.find((l) => l.split("-")[0] === wpLang.split("-")[0]) ?? null;
  };
}

/** Menu labels keyed by the club site's languages. */
function navForSite(menu: SiteNavItem[], siteLang: (l: string | null) => string | null): SiteNavItem[] {
  const conv = (it: SiteNavItem): SiteNavItem => {
    const label: Record<string, string> = {};
    for (const [l, v] of Object.entries(it.label)) {
      const sl = siteLang(l);
      if (sl && !label[sl]) label[sl] = v;
    }
    return { label, href: it.href, ...(it.children?.length ? { children: it.children.map(conv) } : {}) };
  };
  return menu.map(conv).filter((it) => Object.keys(it.label).length);
}

export async function runWordPressImport(db: WebsiteDb, opts: ImportRunOptions): Promise<{ plan: ImportPlan; report: ImportReport }> {
  const { orgId } = opts;
  const { data: mapRows } = await db.from("site_import_map").select("source,source_id,target_id,content_hash,last_imported_at").eq("org_id", orgId).limit(20000);
  const rows = (mapRows ?? []) as MapRow[];
  const map = new Map(rows.map((r) => [`${r.source}:${r.source_id}`, r.target_id]));
  const mapMeta = new Map(rows.map((r) => [`${r.source}:${r.source_id}`, r]));
  const { data: pageRows } = await db.from("site_pages").select("id,path").eq("org_id", orgId);
  const existingPages = new Map(((pageRows ?? []) as { id: string; path: string }[]).map((r) => [r.id, r.path]));
  const mappedPageIds = new Set(Array.from(map.entries()).filter(([k]) => k.startsWith("wp_page:")).map(([, v]) => v));
  const taken = new Set(Array.from(existingPages.entries()).filter(([id]) => !mappedPageIds.has(id)).map(([, p]) => p));

  const loaded = await loadWordPress(opts.baseUrl, { languages: opts.languages, defaultLanguage: opts.defaultLanguage, takenPaths: taken });
  const { plan, groups, postGroups, prefixes } = loaded;
  const report: ImportReport = {
    pagesCreated: 0, pagesUpdated: 0, pagesKept: 0, postsCreated: 0, postsUpdated: 0, postsKept: 0, imagesImported: 0, imagesFailed: 0, imagesRemaining: 0,
    redirects: 0, liveBlocks: 0, menuItems: 0, designApplied: 0, skipped: 0,
  };
  const siteLang = siteLangFor(opts.languages, opts.defaultLanguage);
  const wpDefault = plan.defaultLanguage;
  const overwrite = opts.overwriteEdits === true;

  // Featured images.
  const featuredIds = Array.from(new Set([...groups, ...postGroups].flatMap((g) => [g.main, ...Object.values(g.translations)]).map((i) => i.featuredMedia).filter((x): x is string => !!x)));
  const featured = new Map<string, { url: string; alt: string }>();
  for (let i = 0; i < featuredIds.length; i += 50) {
    try {
      const list = await fetchJsonList(plan.baseUrl, "/wp-json/wp/v2/media", { include: featuredIds.slice(i, i + 50).join(","), _fields: "id,source_url,alt_text,media_type" });
      for (const r of list as { id: number; source_url?: string; alt_text?: string; media_type?: string }[]) {
        if (r.media_type && r.media_type !== "image") continue;
        if (r.source_url) featured.set(String(r.id), { url: r.source_url.replace(/^http:/, "https:"), alt: r.alt_text ?? "" });
      }
    } catch (e) {
      logError("site.import.featured", e);
    }
  }

  // Build page contents (with image placeholders).
  type Draft = { sourceId: string; main: WpItem; path: string; content: PageContent; parentSourceId: string | null; menuOrder: number; translations: Record<string, WpItem> };
  const drafts: Draft[] = [];
  for (const g of groups) {
    const planned = plan.pages.find((p) => p.sourceId === g.main.sourceId);
    if (!planned || planned.skip) {
      report.skipped++;
      continue;
    }
    const isHome = planned.newPath === "/";
    const content: PageContent = {};
    const mainLang = siteLang(g.main.lang ?? wpDefault) ?? opts.defaultLanguage;
    const conv = (it: WpItem) => pageLangFromItem(it, it.featuredMedia ? featured.get(it.featuredMedia)?.url ?? null : null, { isHome, tagline: loaded.tagline });
    content[mainLang] = conv(g.main);
    for (const [l, it] of Object.entries(g.translations)) {
      const sl = siteLang(l);
      if (sl && !content[sl]) content[sl] = conv(it);
    }
    for (const l of opts.languages) if (!content[l]) content[l] = needsTranslation(content[mainLang]!.title);
    if (opts.addLiveBlocks && planned.live) {
      let added = false;
      for (const v of Object.values(content)) {
        if (v.state === "needs_translation" || hasLiveFor(v.blocks, planned.live)) continue;
        v.blocks = [...v.blocks, ...liveBlocksFor(planned.live)].slice(0, 80);
        added = true;
      }
      if (added) report.liveBlocks++;
    }
    drafts.push({ sourceId: g.main.sourceId, main: g.main, path: planned.newPath, content, parentSourceId: g.main.parentSourceId, menuOrder: g.main.menuOrder, translations: g.translations });
  }

  // Images: copy what is referenced and not yet imported (bounded per run).
  const wanted = Array.from(new Set([...drafts.flatMap((d) => imageRefsOf(d.content)), ...postGroups.slice(0, 200).flatMap((g) => {
    const f = g.main.featuredMedia ? featured.get(g.main.featuredMedia)?.url : null;
    return f ? [f] : extractImageUrls(g.main.html, g.main.link).slice(0, 1);
  })]));
  const lib = new Map<string, string>();
  const missingMedia: string[] = [];
  const knownPaths = async (urls: readonly string[]) => {
    const ids = Array.from(new Set(urls.map((u) => map.get(`wp_media:${urlKey(u)}`)).filter((x): x is string => !!x)));
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from("media_assets").select("id,path").eq("org_id", orgId).in("id", ids.slice(i, i + 200));
      const byId = new Map(((data ?? []) as { id: string; path: string }[]).map((r) => [r.id, r.path]));
      for (const u of urls) {
        const id = map.get(`wp_media:${urlKey(u)}`);
        if (id && byId.has(id)) lib.set(u, byId.get(id)!);
      }
    }
  };
  await knownPaths(wanted);
  for (const u of wanted) if (!lib.has(u)) missingMedia.push(u);
  const altOf = new Map<string, string>();
  for (const d of drafts) for (const v of Object.values(d.content)) JSON.stringify(v.blocks, (k, val) => {
    if (val && typeof val === "object" && typeof val.path === "string" && val.path.startsWith("wpimg:") && val.alt) altOf.set(val.path.slice(6), val.alt);
    return val;
  });
  for (const f of featured.values()) if (f.alt) altOf.set(f.url, f.alt);
  const batch = missingMedia.slice(0, MAX_IMAGES_PER_RUN);
  report.imagesRemaining = Math.max(0, missingMedia.length - batch.length);
  for (let i = 0; i < batch.length; i += IMAGE_CONCURRENCY) {
    const chunk = batch.slice(i, i + IMAGE_CONCURRENCY);
    const res = await Promise.all(chunk.map((u) => copyImage(db, orgId, opts.actorId, u, altOf.get(u) ?? null, opts.clearedForPublic)));
    res.forEach((path, k) => {
      if (path) {
        lib.set(chunk[k]!, path);
        report.imagesImported++;
      } else report.imagesFailed++;
    });
  }

  // Pages.
  const idBySource = new Map<string, string>();
  const now = new Date().toISOString();
  for (const d of drafts) {
    const content = parsePageContent(replaceImageRefs(d.content, lib));
    if (!pageContentSchema.safeParse(content).success) {
      report.skipped++;
      continue;
    }
    const key = `wp_page:${d.sourceId}`;
    const existingId = map.get(key);
    const pub = opts.publish ? { status: "published", published_at: now, published_content: publishable(content) } : {};
    const hash = contentHash(content);
    if (existingId && existingPages.has(existingId)) {
      const { data: cur } = await db.from("site_pages").select("content,updated_at").eq("id", existingId).eq("org_id", orgId).maybeSingle();
      const row = cur as { content: unknown; updated_at: string | null } | null;
      idBySource.set(d.sourceId, existingId);
      const meta = mapMeta.get(key);
      const edited = row ? editedSinceImport({ content: row.content, updatedAt: row.updated_at }, { hash: meta?.content_hash ?? null, importedAt: meta?.last_imported_at ?? null }) : false;
      if (rerunAction(edited, overwrite) === "keep") {
        report.pagesKept++;
        continue;
      }
      if (row) await db.from("site_page_versions").insert({ org_id: orgId, page_id: existingId, content: row.content, note: "before import", created_by: opts.actorId });
      const { error } = await db.from("site_pages").update({ content, updated_by: opts.actorId, ...pub }).eq("id", existingId).eq("org_id", orgId);
      if (error) {
        logError("site.import.pageUpdate", error);
        report.skipped++;
        continue;
      }
      await db.from("site_import_map").update({ content_hash: hash, last_imported_at: new Date().toISOString() }).eq("org_id", orgId).eq("source", "wp_page").eq("source_id", d.sourceId);
      report.pagesUpdated++;
    } else {
      if (!isValidSitePath(d.path)) {
        report.skipped++;
        continue;
      }
      const { data, error } = await db
        .from("site_pages")
        .insert({ org_id: orgId, path: d.path, content, position: d.menuOrder * 10 + drafts.indexOf(d), show_in_nav: !d.parentSourceId && d.path !== "/", created_by: opts.actorId, updated_by: opts.actorId, ...pub })
        .select("id")
        .single();
      if (error || !data) {
        logError("site.import.pageInsert", error, { path: d.path });
        report.skipped++;
        continue;
      }
      const id = (data as { id: string }).id;
      idBySource.set(d.sourceId, id);
      await db.from("site_import_map").upsert(
        { org_id: orgId, source: "wp_page", source_id: d.sourceId, source_url: d.main.link.slice(0, 1000), target_table: "site_pages", target_id: id, last_imported_at: new Date().toISOString(), content_hash: hash },
        { onConflict: "org_id,source,source_id" },
      );
      report.pagesCreated++;
    }
  }
  // Parents (second pass; new pages only, so an admin's tree edits are kept).
  for (const d of drafts) {
    const id = idBySource.get(d.sourceId);
    if (!id || map.has(`wp_page:${d.sourceId}`)) continue;
    const parent = d.parentSourceId ? idBySource.get(d.parentSourceId) ?? null : null;
    if (parent) await db.from("site_pages").update({ parent_id: parent, show_in_nav: false }).eq("id", id).eq("org_id", orgId);
  }

  // Redirects: changed paths, translated slugs (/fr/a-propos -> /fr/about-us).
  const redirects: { from: string; to: string }[] = [];
  for (const d of drafts) {
    if (!idBySource.has(d.sourceId)) continue;
    if (normalizeRequestPath(d.main.path) !== d.path) redirects.push({ from: d.main.path, to: d.path });
    for (const [l, it] of Object.entries(d.translations)) {
      const sl = siteLang(l);
      const pre = prefixes.find((p) => p.tag === l)?.prefix;
      if (!sl || !pre) continue;
      const from = `/${pre}${it.path === "/" ? "" : it.path}`;
      const to = localizedPath(d.path, sl, opts.defaultLanguage);
      if (normalizeRequestPath(from) !== normalizeRequestPath(to)) redirects.push({ from, to });
    }
  }

  // Posts.
  for (const g of postGroups.slice(0, 200)) {
    const it = g.main;
    if (it.status !== "publish") continue;
    const slug = slugify(decodeURIComponentSafe(it.slug), 150);
    if (!slug) continue;
    const content: Record<string, { title: string; excerpt?: string; bodyHtml: string; state: "ok" | "needs_translation" }> = {};
    const mainLang = siteLang(it.lang ?? wpDefault) ?? opts.defaultLanguage;
    const one = (x: WpItem) => ({ title: x.title || slug, excerpt: (x.excerpt || visibleText(x.html)).slice(0, 600) || undefined, bodyHtml: postBodyHtml(x.html), state: "ok" as const });
    content[mainLang] = one(it);
    for (const [l, tr] of Object.entries(g.translations)) {
      const sl = siteLang(l);
      if (sl && !content[sl]) content[sl] = one(tr);
    }
    for (const l of opts.languages) if (!content[l]) content[l] = { title: content[mainLang]!.title, bodyHtml: "", state: "needs_translation" };
    const coverUrl = it.featuredMedia ? featured.get(it.featuredMedia)?.url : extractImageUrls(it.html, it.link)[0];
    const coverPath = coverUrl ? lib.get(coverUrl) ?? null : null;
    const row = {
      org_id: orgId, slug, content, cover_path: coverPath, tags: [] as string[],
      ...(opts.publish ? { status: "published", published_at: it.date && !Number.isNaN(Date.parse(it.date)) ? new Date(it.date).toISOString() : now } : {}),
    };
    const key = `wp_post:${it.sourceId}`;
    const existing = map.get(key);
    const hash = contentHash(content);
    if (existing) {
      const { data: cur } = await db.from("site_posts").select("content,updated_at").eq("id", existing).eq("org_id", orgId).maybeSingle();
      const c = cur as { content: unknown; updated_at: string | null } | null;
      const meta = mapMeta.get(key);
      const edited = c ? editedSinceImport({ content: c.content, updatedAt: c.updated_at }, { hash: meta?.content_hash ?? null, importedAt: meta?.last_imported_at ?? null }) : false;
      if (rerunAction(edited, overwrite) === "keep") {
        report.postsKept++;
      } else {
        const { error } = await db.from("site_posts").update(row).eq("id", existing).eq("org_id", orgId);
        if (!error) {
          report.postsUpdated++;
          await db.from("site_import_map").update({ content_hash: hash, last_imported_at: new Date().toISOString() }).eq("org_id", orgId).eq("source", "wp_post").eq("source_id", it.sourceId);
        }
      }
    } else {
      const { data, error } = await db.from("site_posts").insert({ ...row, created_by: opts.actorId }).select("id").single();
      if (error || !data) {
        if (error?.code !== "23505") logError("site.import.post", error);
        continue;
      }
      await db.from("site_import_map").upsert(
        { org_id: orgId, source: "wp_post", source_id: it.sourceId, source_url: it.link.slice(0, 1000), target_table: "site_posts", target_id: (data as { id: string }).id, last_imported_at: new Date().toISOString(), content_hash: hash },
        { onConflict: "org_id,source,source_id" },
      );
      report.postsCreated++;
    }
    const newPath = postPath(slug);
    if (normalizeRequestPath(it.path) !== newPath) redirects.push({ from: it.path, to: newPath });
  }

  for (const r of redirects) {
    const from = normalizeRequestPath(r.from);
    if (!from || from === "/" || isReservedPath(from) || from === normalizeRequestPath(r.to) || from.length > 400) continue;
    const { error } = await db.from("site_redirects").upsert({ org_id: orgId, from_path: from, to_path: r.to, status_code: 301 }, { onConflict: "org_id,from_path" });
    if (!error) report.redirects++;
  }

  if (opts.applyDesign) await applyDesign(db, opts, plan.design, siteLang, report);
  return { plan, report };
}

/**
 * Site settings from the old site's design. Each setting is filled when it is
 * still empty; one the admin already set is replaced only with "overwrite my
 * edits". The logo is copied into the media library (and cleared for public
 * use: it is the club's logo, not a photo of people).
 */
async function applyDesign(db: WebsiteDb, opts: ImportRunOptions, design: ImportPlanDesign, siteLang: (l: string | null) => string | null, report: ImportReport): Promise<void> {
  const { orgId } = opts;
  const overwrite = opts.overwriteEdits === true;
  const { data } = await db.from("site_settings").select("header_nav,logo_path,fonts,palette,social_links,contact_email,contact_phone,contact_address").eq("org_id", orgId).maybeSingle();
  const cur = (data ?? {}) as { header_nav?: unknown[]; logo_path?: string | null; fonts?: Record<string, unknown>; palette?: Record<string, unknown>; social_links?: Record<string, string>; contact_email?: string | null; contact_phone?: string | null; contact_address?: string | null };
  const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length);
  const take = (current: unknown) => overwrite || empty(current);
  const patch: Record<string, unknown> = {};

  const nav = navForSite(design.menu, siteLang).slice(0, 12);
  if (nav.length && take(cur.header_nav)) {
    patch.header_nav = nav;
    report.menuItems = nav.length + nav.reduce((n, it) => n + (it.children?.length ?? 0), 0);
  }
  if (design.logoUrl && take(cur.logo_path)) {
    const { data: m } = await db.from("site_import_map").select("target_id").eq("org_id", orgId).eq("source", "wp_media").eq("source_id", urlKey(design.logoUrl)).maybeSingle();
    let path: string | null = null;
    if (m) {
      const { data: a } = await db.from("media_assets").select("path").eq("org_id", orgId).eq("id", (m as { target_id: string }).target_id).maybeSingle();
      path = (a as { path?: string } | null)?.path ?? null;
      if (path) await db.from("media_assets").update({ public_use_confirmed_at: new Date().toISOString(), public_use_confirmed_by: opts.actorId }).eq("org_id", orgId).eq("path", path).is("public_use_confirmed_at", null);
    }
    path = path ?? (await copyImage(db, orgId, opts.actorId, design.logoUrl, null, true));
    if (path) patch.logo_path = path;
  }
  const fonts = { ...(design.fonts.display ? { display: design.fonts.display } : {}), ...(design.fonts.ui ? { ui: design.fonts.ui } : {}), ...(design.fonts.uppercase ? { uppercase: true } : {}) };
  if (Object.keys(fonts).length && take(cur.fonts)) patch.fonts = fonts;
  const palette = { ...(design.colors.primary ? { primary: design.colors.primary } : {}), ...(design.colors.accent ? { accent: design.colors.accent } : {}) };
  if (Object.keys(palette).length && take(cur.palette)) patch.palette = palette;
  if (Object.keys(design.social).length) {
    const social = overwrite ? { ...(cur.social_links ?? {}), ...design.social } : { ...design.social, ...(cur.social_links ?? {}) };
    patch.social_links = social;
  }
  if (design.contact.email && take(cur.contact_email)) patch.contact_email = design.contact.email;
  if (design.contact.phone && take(cur.contact_phone)) patch.contact_phone = design.contact.phone;
  if (design.contact.address && take(cur.contact_address)) patch.contact_address = design.contact.address;
  if (!Object.keys(patch).length) return;
  const { error } = await db.from("site_settings").update(patch).eq("org_id", orgId);
  if (error) {
    logError("site.import.design", error);
    return;
  }
  report.designApplied = Object.keys(patch).length;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export { codeOf as importErrorCode };
export type { PageLang };
