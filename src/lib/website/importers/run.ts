import "server-only";
import { randomUUID } from "node:crypto";
import { sniffImageType } from "@/lib/people/validation";
import { CLUB_MEDIA_BUCKET } from "@/lib/shop/db";
import { logError } from "@/lib/log";
import { ResponseTooLargeError, UnsafeUrlError, safeFetch } from "../ssrf";
import type { WebsiteDb } from "../server";
import {
  mapSportsPressEvent, mapSportsPressTeam, mapWooProduct, mapWpPost,
  type MappedEvent, type MappedPost, type MappedProduct, type MappedTeam,
} from "./mappers";

/**
 * Importer from a club's existing WordPress website, through its PUBLIC REST
 * API (no credentials): SportsPress teams + events/results, WooCommerce
 * Store API products, WordPress posts. Any WordPress URL works (white-label).
 *
 * Network: server-side only, https only, SSRF-guarded (ssrf.ts), 10 s timeout,
 * 5 MB per page, at most MAX_PAGES pages per source.
 * Idempotent: every imported row is recorded in website_import_map
 * (org_id, source, source_id) -> target id; a re-run updates, never duplicates.
 * Players, player lists and performance data are never read into the app.
 */

export const IMPORT_KINDS = ["sportspress", "woo", "posts"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

const PER_PAGE = 100;
const MAX_PAGES = 5;
const PAGE_MAX_BYTES = 5_000_000;
const IMAGE_MAX_BYTES = 5_000_000;

export type FetchErrorCode = "not_found" | "unsafe_url" | "network" | "too_large" | "invalid_json" | "http_error";

async function fetchPages(base: string, path: string, query: Record<string, string>, maxPages = MAX_PAGES): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const u = new URL(`${base.replace(/\/+$/, "")}${path}`);
    for (const [k, v] of Object.entries({ ...query, per_page: String(PER_PAGE), page: String(page) })) u.searchParams.set(k, v);
    const res = await safeFetch(u.toString(), { timeoutMs: 10_000, maxBytes: PAGE_MAX_BYTES, headers: { Accept: "application/json" } });
    if (res.status === 404) throw Object.assign(new Error("not_found"), { code: "not_found" as FetchErrorCode });
    if (res.status === 400 && page > 1) break; // WordPress: page past the end
    if (!res.ok) throw Object.assign(new Error("http_error"), { code: "http_error" as FetchErrorCode });
    let data: unknown;
    try {
      data = JSON.parse(res.text());
    } catch {
      throw Object.assign(new Error("invalid_json"), { code: "invalid_json" as FetchErrorCode });
    }
    if (!Array.isArray(data)) throw Object.assign(new Error("invalid_json"), { code: "invalid_json" as FetchErrorCode });
    out.push(...data);
    const totalPages = Number(res.headers.get("x-wp-totalpages") ?? "0");
    if (data.length < PER_PAGE || (totalPages && page >= totalPages)) break;
  }
  return out;
}

function codeOf(e: unknown): FetchErrorCode {
  if (e instanceof UnsafeUrlError) return "unsafe_url";
  if (e instanceof ResponseTooLargeError) return "too_large";
  const c = (e as { code?: string })?.code;
  return c === "not_found" || c === "invalid_json" || c === "http_error" ? c : "network";
}

export type Sources = {
  teams: unknown[] | null;
  events: unknown[] | null;
  products: unknown[] | null;
  posts: unknown[] | null;
  errors: Partial<Record<ImportKind, FetchErrorCode>>;
};

export async function loadSources(websiteUrl: string, kinds: ImportKind[]): Promise<Sources> {
  const s: Sources = { teams: null, events: null, products: null, posts: null, errors: {} };
  await Promise.all([
    kinds.includes("sportspress")
      ? Promise.all([
          fetchPages(websiteUrl, "/wp-json/sportspress/v2/teams", {}),
          fetchPages(websiteUrl, "/wp-json/sportspress/v2/events", { orderby: "date", order: "desc" }),
        ]).then(([t, e]) => { s.teams = t; s.events = e; }).catch((e) => { s.errors.sportspress = codeOf(e); })
      : null,
    kinds.includes("woo")
      ? fetchPages(websiteUrl, "/wp-json/wc/store/v1/products", {}).then((p) => { s.products = p; }).catch((e) => { s.errors.woo = codeOf(e); })
      : null,
    kinds.includes("posts")
      ? fetchPages(websiteUrl, "/wp-json/wp/v2/posts", { status: "publish" }, 2).then((p) => { s.posts = p; }).catch((e) => { s.errors.posts = codeOf(e); })
      : null,
  ]);
  return s;
}

type MapRow = { source: string; source_id: string; target_id: string };

async function existingMap(db: WebsiteDb, orgId: string): Promise<Map<string, string>> {
  const { data } = await db.from("website_import_map").select("source,source_id,target_id").eq("org_id", orgId).limit(10000);
  return new Map(((data ?? []) as MapRow[]).map((r) => [`${r.source}:${r.source_id}`, r.target_id]));
}

export type ImportPreview = {
  teams: (MappedTeam & { existing: boolean })[];
  events: (MappedEvent & { existing: boolean })[];
  products: (MappedProduct & { existing: boolean })[];
  posts: (Omit<MappedPost, "bodyHtml"> & { existing: boolean })[];
  skipped: { events: number; products: number; posts: number };
  errors: Sources["errors"];
};

export function mapSources(s: Sources, ourTeams: ReadonlySet<string>) {
  const teams = (s.teams ?? []).map(mapSportsPressTeam).filter((t): t is MappedTeam => !!t);
  const names = new Map(teams.map((t) => [t.sourceId, t.name]));
  const evMapped = (s.events ?? []).map((e) => mapSportsPressEvent(e, ourTeams, names));
  const events = evMapped.filter((r): r is { ok: true; event: MappedEvent } => r.ok).map((r) => r.event);
  const products = (s.products ?? []).map(mapWooProduct).filter((p): p is MappedProduct => !!p);
  const posts = (s.posts ?? []).map(mapWpPost).filter((p): p is MappedPost => !!p);
  return {
    teams, events, products, posts,
    skipped: {
      events: evMapped.length - events.length,
      products: (s.products?.length ?? 0) - products.length,
      posts: (s.posts?.length ?? 0) - posts.length,
    },
  };
}

export async function previewImport(db: WebsiteDb, orgId: string, s: Sources, ourTeams: ReadonlySet<string>): Promise<ImportPreview> {
  const m = mapSources(s, ourTeams);
  const known = await existingMap(db, orgId);
  return {
    teams: m.teams.map((t) => ({ ...t, existing: known.has(`sportspress_team:${t.sourceId}`) })),
    events: m.events.slice(0, 500).map((e) => ({ ...e, existing: known.has(`sportspress_event:${e.sourceId}`) })),
    products: m.products.map((p) => ({ ...p, existing: known.has(`woo_product:${p.sourceId}`) })),
    posts: m.posts.map(({ bodyHtml: _b, ...p }) => ({ ...p, existing: known.has(`wp_post:${p.sourceId}`) })),
    skipped: m.skipped,
    errors: s.errors,
  };
}

export type ImportCounts = { created: number; updated: number; failed: number };
export type ImportResult = { teams: ImportCounts; events: ImportCounts; products: ImportCounts; posts: ImportCounts; images: number };

const zero = (): ImportCounts => ({ created: 0, updated: 0, failed: 0 });

async function remember(db: WebsiteDb, orgId: string, source: string, sourceId: string, sourceUrl: string | null, table: string, targetId: string) {
  await db.from("website_import_map").upsert(
    { org_id: orgId, source, source_id: sourceId, source_url: sourceUrl, target_table: table, target_id: targetId, last_imported_at: new Date().toISOString() },
    { onConflict: "org_id,source,source_id" },
  );
}

async function importImage(db: WebsiteDb, orgId: string, productId: string, url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, { timeoutMs: 10_000, maxBytes: IMAGE_MAX_BYTES });
    if (!res.ok) return null;
    const type = sniffImageType(res.bytes);
    if (!type) return null;
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    const path = `${orgId}/products/${productId}-${randomUUID()}.${ext}`;
    const up = await db.storage.from(CLUB_MEDIA_BUCKET).upload(path, res.bytes, { contentType: type, upsert: false, cacheControl: "3600" });
    return up.error ? null : path;
  } catch (e) {
    logError("website.import.image", e);
    return null;
  }
}

/**
 * Write the import. `db` is the signed-in admin's RLS client (inserts are
 * re-checked by the database: admin of the same org). `dryRun` counts only.
 */
export async function applyImport(
  db: WebsiteDb,
  me: { id: string; orgId: string },
  s: Sources,
  opts: { ourTeams: ReadonlySet<string>; dryRun: boolean; defaultStock: number },
): Promise<ImportResult> {
  const orgId = me.orgId;
  const m = mapSources(s, opts.ourTeams);
  const known = await existingMap(db, orgId);
  const r: ImportResult = { teams: zero(), events: zero(), products: zero(), posts: zero(), images: 0 };

  // Teams: only the club's own (selected) teams; opponents stay names on events.
  const teamTarget = new Map<string, string>();
  for (const t of m.teams.filter((x) => opts.ourTeams.has(x.sourceId))) {
    const key = `sportspress_team:${t.sourceId}`;
    const existing = known.get(key);
    if (opts.dryRun) { (existing ? r.teams.updated++ : r.teams.created++); continue; }
    if (existing) {
      const { error } = await db.from("teams").update({ name: t.name }).eq("id", existing).eq("org_id", orgId);
      if (error) { r.teams.failed++; continue; }
      teamTarget.set(t.sourceId, existing);
      r.teams.updated++;
      continue;
    }
    let ins = await db.from("teams").insert({ org_id: orgId, name: t.name, slug: t.slug, is_public: true }).select("id").single();
    if (ins.error && ins.error.code === "23505") ins = await db.from("teams").insert({ org_id: orgId, name: t.name, is_public: true }).select("id").single();
    if (ins.error || !ins.data) { r.teams.failed++; continue; }
    const id = (ins.data as { id: string }).id;
    teamTarget.set(t.sourceId, id);
    await remember(db, orgId, "sportspress_team", t.sourceId, t.sourceUrl, "teams", id);
    r.teams.created++;
  }

  // Events + results.
  for (const e of m.events) {
    const key = `sportspress_event:${e.sourceId}`;
    const existing = known.get(key);
    const teamId = teamTarget.get(e.ourTeamSourceId) ?? known.get(`sportspress_team:${e.ourTeamSourceId}`) ?? null;
    if (opts.dryRun) { (existing ? r.events.updated++ : r.events.created++); continue; }
    if (!teamId) { r.events.failed++; continue; }
    const row = {
      team_id: teamId, type: "game", title: e.title.slice(0, 160), starts_at: e.startsAt, ends_at: e.endsAt,
      opponent: e.opponent, home_away: e.homeAway,
    };
    let eventId = existing ?? null;
    if (existing) {
      const { error } = await db.from("events").update(row).eq("id", existing).eq("org_id", orgId);
      if (error) { r.events.failed++; continue; }
      r.events.updated++;
    } else {
      const ins = await db.from("events").insert({ ...row, org_id: orgId, status: "scheduled", created_by: me.id }).select("id").single();
      if (ins.error || !ins.data) { r.events.failed++; continue; }
      eventId = (ins.data as { id: string }).id;
      await remember(db, orgId, "sportspress_event", e.sourceId, e.sourceUrl, "events", eventId);
      r.events.created++;
    }
    if (eventId && e.scoreFor !== null && e.scoreAgainst !== null) {
      const { error } = await db.rpc("record_game_result", { p_event: eventId, p_score_for: e.scoreFor, p_score_against: e.scoreAgainst, p_notes: null });
      if (error) logError("website.import.result", error);
    }
  }

  // Shop products (+ variants, images by URL into club storage).
  for (const p of m.products) {
    const key = `woo_product:${p.sourceId}`;
    const existing = known.get(key);
    if (opts.dryRun) { (existing ? r.products.updated++ : r.products.created++); continue; }
    const row = { name: p.name, description: p.description, category: p.category, price: p.price, currency: p.currency };
    if (existing) {
      const { error } = await db.from("shop_products").update(row).eq("id", existing).eq("org_id", orgId);
      (error ? r.products.failed++ : r.products.updated++);
      continue;
    }
    const ins = await db.from("shop_products").insert({ ...row, org_id: orgId, visibility: "public", is_active: true, created_by: me.id }).select("id").single();
    if (ins.error || !ins.data) { r.products.failed++; continue; }
    const productId = (ins.data as { id: string }).id;
    const stock = p.stock ?? (p.inStock ? Math.max(0, Math.min(9999, Math.floor(opts.defaultStock))) : 0);
    const variants = p.variants.map((v, i) => ({ org_id: orgId, product_id: productId, size: v.size, color: v.color, price: v.price, stock, sort_order: i }));
    const vIns = await db.from("shop_product_variants").insert(variants);
    if (vIns.error) logError("website.import.variants", vIns.error);
    const images: string[] = [];
    for (const url of p.imageUrls.slice(0, 4)) {
      const path = await importImage(db, orgId, productId, url);
      if (path) images.push(path);
    }
    if (images.length) {
      await db.from("shop_products").update({ images }).eq("id", productId).eq("org_id", orgId);
      r.images += images.length;
    }
    await remember(db, orgId, "woo_product", p.sourceId, p.sourceUrl, "shop_products", productId);
    r.products.created++;
  }

  // Posts -> public news linking back to the website.
  for (const p of m.posts) {
    const key = `wp_post:${p.sourceId}`;
    const existing = known.get(key);
    if (opts.dryRun) { (existing ? r.posts.updated++ : r.posts.created++); continue; }
    const row = { title: p.title, excerpt: p.excerpt, body_html: p.bodyHtml, link_url: p.linkUrl, published_at: p.publishedAt, source: "wordpress" };
    if (existing) {
      const { error } = await db.from("website_news").update(row).eq("id", existing).eq("org_id", orgId);
      (error ? r.posts.failed++ : r.posts.updated++);
      continue;
    }
    const ins = await db.from("website_news").insert({ ...row, org_id: orgId, is_public: true, created_by: me.id }).select("id").single();
    if (ins.error || !ins.data) { r.posts.failed++; continue; }
    await remember(db, orgId, "wp_post", p.sourceId, p.linkUrl, "website_news", (ins.data as { id: string }).id);
    r.posts.created++;
  }
  return r;
}
