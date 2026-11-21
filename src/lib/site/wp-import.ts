import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { logError } from "@/lib/log";
import { CLUB_MEDIA_BUCKET, libraryObjectPath, sniffCoverType, COVER_MAX_BYTES } from "@/lib/media/cover";
import { ResponseTooLargeError, UnsafeUrlError, safeFetch } from "@/lib/website/ssrf";
import type { WebsiteDb } from "@/lib/website/server";
import { pageContentSchema, parsePageContent, type PageContent, type PageLang } from "./blocks";
import { langSlug } from "./languages";
import { isReservedPath, isValidSitePath, localizedPath, normalizeRequestPath, postPath, slugify } from "./paths";
import {
  detectLanguages, extractImageUrls, groupTranslations, imageRefsOf, mapWpItem, needsTranslation, pageLangFromItem, postBodyHtml,
  replaceImageRefs, sitePathFor, skipReasonFor, visibleText, type SkipReason, type WpItem, type WpLanguage,
} from "./wp-convert";

/**
 * "Import my current website": pages, posts and their images from a club's
 * WordPress site through its PUBLIC REST API (no credentials). Works for any
 * WordPress site (white-label). Network: server-side only, through the
 * SSRF-guarded fetcher (https only, private / internal IPs refused, 10 s
 * timeout, size caps per response).
 *
 *   preview  fetch + convert, write nothing
 *   run      write: images -> club media library (dedupe by source URL; alt
 *            text kept; cleared for public use ONLY if the admin ticked it),
 *            pages / posts (original paths kept; reserved paths renamed),
 *            translations (WPML / Polylang when the REST API exposes them),
 *            redirects for every changed URL. Idempotent: site_import_map
 *            (source, source id) -> row; a re-run updates and continues with
 *            images not yet copied.
 */

const PER_PAGE = 50;
const MAX_PAGES_PER_LIST = 4;
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
  for (let page = 1; page <= MAX_PAGES_PER_LIST; page++) {
    const u = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries({ ...query, per_page: String(PER_PAGE), page: String(page) })) u.searchParams.set(k, v);
    const res = await safeFetch(u.toString(), { timeoutMs: 15_000, maxBytes: LIST_MAX_BYTES, headers: { Accept: "application/json" } });
    if (res.status === 400 && page > 1) break;
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
    const total = Number(res.headers.get("x-wp-totalpages") ?? "0");
    if (data.length < PER_PAGE || (total && page >= total)) break;
  }
  return out;
}

export type ImportPlanPage = {
  sourceId: string;
  title: string;
  oldPath: string;
  newPath: string;
  translations: string[];
  images: number;
  skip: SkipReason | null;
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
};

type Loaded = { plan: ImportPlan; groups: ReturnType<typeof groupTranslations>["groups"]; postGroups: ReturnType<typeof groupTranslations>["groups"]; prefixes: WpLanguage[] };

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
  let languages: WpLanguage[] = [];
  try {
    const home = await safeFetch(`${base}/`, { timeoutMs: 15_000, maxBytes: 4_000_000, headers: { Accept: "text/html" } });
    if (home.ok) languages = detectLanguages(home.text(), base);
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw new ImportError("unsafe_url");
  }
  const wpDefault = languages.find((l) => !l.prefix)?.tag ?? site.defaultLanguage;
  const extra = languages.filter((l) => l.prefix);

  const loadAll = async (path: string, extraQuery: Record<string, string>) => {
    const main = await fetchJsonList(base, path, { _fields: PAGE_FIELDS, ...extraQuery });
    const others = await Promise.all(extra.map((l) => fetchJsonList(base, path, { _fields: PAGE_FIELDS, lang: l.prefix!, ...extraQuery }).then((rows) => ({ l, rows })).catch(() => ({ l, rows: [] as unknown[] }))));
    const seen = new Set<string>();
    const items: WpItem[] = [];
    for (const raw of main) {
      const it = mapWpItem(raw, { basePath, langPrefixes: languages });
      if (it && !seen.has(it.sourceId)) {
        seen.add(it.sourceId);
        items.push(it);
      }
    }
    for (const { l, rows } of others) {
      for (const raw of rows) {
        const it = mapWpItem(raw, { basePath, langPrefixes: languages, lang: l.tag });
        if (it && !seen.has(it.sourceId)) {
          seen.add(it.sourceId);
          items.push(it);
        }
      }
    }
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
    };
  });
  const imageCount = new Set(groups.flatMap((g) => [g.main, ...Object.values(g.translations)]).flatMap((it) => extractImageUrls(it.html, it.link))).size;
  const wpLangs = new Set([wpDefault, ...extra.map((l) => l.tag)].map((l) => l.split("-")[0]));
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
    },
    groups,
    postGroups,
    prefixes: languages,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export type ImportReport = {
  pagesCreated: number;
  pagesUpdated: number;
  postsCreated: number;
  postsUpdated: number;
  imagesImported: number;
  imagesFailed: number;
  imagesRemaining: number;
  redirects: number;
  skipped: number;
};

type MapRow = { source: string; source_id: string; target_id: string };
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

export async function runWordPressImport(
  db: WebsiteDb,
  opts: { orgId: string; actorId: string; baseUrl: string; languages: readonly string[]; defaultLanguage: string; clearedForPublic: boolean; publish: boolean },
): Promise<{ plan: ImportPlan; report: ImportReport }> {
  const { orgId } = opts;
  const { data: mapRows } = await db.from("site_import_map").select("source,source_id,target_id").eq("org_id", orgId).limit(20000);
  const map = new Map(((mapRows ?? []) as MapRow[]).map((r) => [`${r.source}:${r.source_id}`, r.target_id]));
  const { data: pageRows } = await db.from("site_pages").select("id,path").eq("org_id", orgId);
  const existingPages = new Map(((pageRows ?? []) as { id: string; path: string }[]).map((r) => [r.id, r.path]));
  const mappedPageIds = new Set(Array.from(map.entries()).filter(([k]) => k.startsWith("wp_page:")).map(([, v]) => v));
  const taken = new Set(Array.from(existingPages.entries()).filter(([id]) => !mappedPageIds.has(id)).map(([, p]) => p));

  const loaded = await loadWordPress(opts.baseUrl, { languages: opts.languages, defaultLanguage: opts.defaultLanguage, takenPaths: taken });
  const { plan, groups, postGroups, prefixes } = loaded;
  const report: ImportReport = { pagesCreated: 0, pagesUpdated: 0, postsCreated: 0, postsUpdated: 0, imagesImported: 0, imagesFailed: 0, imagesRemaining: 0, redirects: 0, skipped: 0 };
  const siteLang = (wpLang: string | null): string | null => {
    if (!wpLang) return opts.defaultLanguage;
    const exact = opts.languages.find((l) => l.toLowerCase() === wpLang.toLowerCase());
    return exact ?? opts.languages.find((l) => l.split("-")[0] === wpLang.split("-")[0]) ?? null;
  };
  const wpDefault = plan.defaultLanguage;

  // Featured images.
  const featuredIds = Array.from(new Set([...groups, ...postGroups].flatMap((g) => [g.main, ...Object.values(g.translations)]).map((i) => i.featuredMedia).filter((x): x is string => !!x)));
  const featured = new Map<string, { url: string; alt: string }>();
  for (let i = 0; i < featuredIds.length; i += 50) {
    try {
      const rows = await fetchJsonList(plan.baseUrl, "/wp-json/wp/v2/media", { include: featuredIds.slice(i, i + 50).join(","), _fields: "id,source_url,alt_text,media_type" });
      for (const r of rows as { id: number; source_url?: string; alt_text?: string; media_type?: string }[]) {
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
    const content: PageContent = {};
    const mainLang = siteLang(g.main.lang ?? wpDefault) ?? opts.defaultLanguage;
    content[mainLang] = pageLangFromItem(g.main, g.main.featuredMedia ? featured.get(g.main.featuredMedia)?.url ?? null : null);
    for (const [l, it] of Object.entries(g.translations)) {
      const sl = siteLang(l);
      if (sl && !content[sl]) content[sl] = pageLangFromItem(it, it.featuredMedia ? featured.get(it.featuredMedia)?.url ?? null : null);
    }
    for (const l of opts.languages) if (!content[l]) content[l] = needsTranslation(content[mainLang]!.title);
    drafts.push({ sourceId: g.main.sourceId, main: g.main, path: planned.newPath, content, parentSourceId: g.main.parentSourceId, menuOrder: g.main.menuOrder, translations: g.translations });
  }

  // Images: copy what is referenced and not yet imported (bounded per run).
  const wanted = Array.from(new Set([...drafts.flatMap((d) => imageRefsOf(d.content)), ...postGroups.slice(0, 200).flatMap((g) => {
    const f = g.main.featuredMedia ? featured.get(g.main.featuredMedia)?.url : null;
    return f ? [f] : extractImageUrls(g.main.html, g.main.link).slice(0, 1);
  })]));
  const lib = new Map<string, string>();
  const missingMedia: string[] = [];
  const mediaIds = Array.from(new Set(wanted.map((u) => map.get(`wp_media:${urlKey(u)}`)).filter((x): x is string => !!x)));
  if (mediaIds.length) {
    for (let i = 0; i < mediaIds.length; i += 200) {
      const { data } = await db.from("media_assets").select("id,path").eq("org_id", orgId).in("id", mediaIds.slice(i, i + 200));
      const byId = new Map(((data ?? []) as { id: string; path: string }[]).map((r) => [r.id, r.path]));
      for (const u of wanted) {
        const id = map.get(`wp_media:${urlKey(u)}`);
        if (id && byId.has(id)) lib.set(u, byId.get(id)!);
      }
    }
  }
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
    const existingId = map.get(`wp_page:${d.sourceId}`);
    const pub = opts.publish ? { status: "published", published_at: now, published_content: publishable(content) } : {};
    if (existingId && existingPages.has(existingId)) {
      const { data: cur } = await db.from("site_pages").select("content").eq("id", existingId).eq("org_id", orgId).maybeSingle();
      if (cur) await db.from("site_page_versions").insert({ org_id: orgId, page_id: existingId, content: (cur as { content: unknown }).content, note: "before import", created_by: opts.actorId });
      const { error } = await db.from("site_pages").update({ content, updated_by: opts.actorId, ...pub }).eq("id", existingId).eq("org_id", orgId);
      if (error) {
        logError("site.import.pageUpdate", error);
        report.skipped++;
        continue;
      }
      idBySource.set(d.sourceId, existingId);
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
        { org_id: orgId, source: "wp_page", source_id: d.sourceId, source_url: d.main.link.slice(0, 1000), target_table: "site_pages", target_id: id, last_imported_at: now },
        { onConflict: "org_id,source,source_id" },
      );
      report.pagesCreated++;
    }
  }
  // Parents (second pass).
  for (const d of drafts) {
    const id = idBySource.get(d.sourceId);
    const parent = d.parentSourceId ? idBySource.get(d.parentSourceId) ?? null : null;
    if (id && parent) await db.from("site_pages").update({ parent_id: parent, show_in_nav: false }).eq("id", id).eq("org_id", orgId);
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
    const existing = map.get(`wp_post:${it.sourceId}`);
    if (existing) {
      const { error } = await db.from("site_posts").update(row).eq("id", existing).eq("org_id", orgId);
      if (!error) report.postsUpdated++;
    } else {
      const { data, error } = await db.from("site_posts").insert({ ...row, created_by: opts.actorId }).select("id").single();
      if (error || !data) {
        if (error?.code !== "23505") logError("site.import.post", error);
        continue;
      }
      await db.from("site_import_map").upsert(
        { org_id: orgId, source: "wp_post", source_id: it.sourceId, source_url: it.link.slice(0, 1000), target_table: "site_posts", target_id: (data as { id: string }).id, last_imported_at: now },
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
  return { plan, report };
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
