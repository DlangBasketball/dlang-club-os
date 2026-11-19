import { htmlToText, sanitizeHtml } from "../sanitize";

/**
 * Pure mappers from a club website's public WordPress REST payloads to app
 * rows. Works with any WordPress site (white-label): SportsPress
 * (/wp-json/sportspress/v2/teams|events), WooCommerce Store API
 * (/wp-json/wc/store/v1/products) and core posts (/wp-json/wp/v2/posts).
 *
 * Minors' data is never imported: player lists, player performance and
 * officials in SportsPress payloads are ignored entirely; images of posts are
 * not imported; product images only (club merchandise).
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const rendered = (v: unknown): string | null => (isObj(v) ? str(v.rendered) : str(v));
const idOf = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" && /^\d{1,18}$/.test(v) ? v : null);

/** https link back to the source (http is upgraded, anything else dropped). */
export function httpsLink(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol === "http:") u.protocol = "https:";
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.toString().slice(0, 500);
  } catch {
    return null;
  }
}

function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

/** WordPress "date_gmt" (no zone) -> ISO UTC; falls back to "date" read as UTC. */
export function wpDateToIso(gmt: unknown, local?: unknown): string | null {
  const s = str(gmt) ?? str(local);
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
  const d = new Date(`${s.length === 16 ? `${s}:00` : s}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------------------
// SportsPress
// ---------------------------------------------------------------------------
export type MappedTeam = { sourceId: string; sourceUrl: string | null; name: string; slug: string | null; league: string | null };

export function mapSportsPressTeam(raw: unknown): MappedTeam | null {
  if (!isObj(raw)) return null;
  const sourceId = idOf(raw.id);
  const name = htmlToText(rendered(raw.title), 120);
  if (!sourceId || !name) return null;
  const slug = slugify(str(raw.slug) ?? name) || null;
  return { sourceId, sourceUrl: httpsLink(raw.link), name, slug, league: null };
}

export type MappedEvent = {
  sourceId: string;
  sourceUrl: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  ourTeamSourceId: string;
  opponent: string | null;
  homeAway: "home" | "away";
  scoreFor: number | null;
  scoreAgainst: number | null;
  status: "scheduled" | "completed" | "cancelled";
};

export type SkipReason = "invalid" | "not_our_team" | "no_date" | "draft";

function points(results: unknown, teamId: string): number | null {
  if (!isObj(results)) return null;
  const r = results[teamId];
  if (!isObj(r)) return null;
  for (const k of ["points", "pts", "goals", "score", "runs", "total"]) {
    const v = r[k];
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,4}$/.test(v.trim()) ? Number(v) : NaN;
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/**
 * One SportsPress event. `ourTeams` are the SportsPress team ids the admin
 * marked as the club's own; `teamNames` names every team (opponents too).
 * The first team of a SportsPress event is the home team.
 */
export function mapSportsPressEvent(
  raw: unknown,
  ourTeams: ReadonlySet<string>,
  teamNames: ReadonlyMap<string, string>,
): { ok: true; event: MappedEvent } | { ok: false; reason: SkipReason; sourceId: string | null } {
  if (!isObj(raw)) return { ok: false, reason: "invalid", sourceId: null };
  const sourceId = idOf(raw.id);
  if (!sourceId) return { ok: false, reason: "invalid", sourceId: null };
  const wpStatus = str(raw.status);
  if (wpStatus && !["publish", "future"].includes(wpStatus)) return { ok: false, reason: "draft", sourceId };
  const teams = (Array.isArray(raw.teams) ? raw.teams : []).map(idOf).filter((x): x is string => !!x);
  const ourIdx = teams.findIndex((t) => ourTeams.has(t));
  if (ourIdx < 0) return { ok: false, reason: "not_our_team", sourceId };
  const startsAt = wpDateToIso(raw.date_gmt, raw.date);
  if (!startsAt) return { ok: false, reason: "no_date", sourceId };
  const minutes = typeof raw.minutes === "number" && raw.minutes > 0 && raw.minutes <= 600 ? raw.minutes : 120;
  const endsAt = new Date(Date.parse(startsAt) + minutes * 60_000).toISOString();
  const ours = teams[ourIdx]!;
  const other = teams.find((t, i) => i !== ourIdx) ?? null;
  const scoreFor = points(raw.results, ours);
  const scoreAgainst = other ? points(raw.results, other) : null;
  const hasScore = scoreFor !== null && scoreAgainst !== null;
  const title = htmlToText(rendered(raw.title), 160) || (teamNames.get(ours) ?? "");
  return {
    ok: true,
    event: {
      sourceId,
      sourceUrl: httpsLink(raw.link),
      title,
      startsAt,
      endsAt,
      ourTeamSourceId: ours,
      opponent: other ? (teamNames.get(other) ?? null) : null,
      homeAway: ourIdx === 0 ? "home" : "away",
      scoreFor: hasScore ? scoreFor : null,
      scoreAgainst: hasScore ? scoreAgainst : null,
      status: hasScore && Date.parse(startsAt) < Date.now() ? "completed" : "scheduled",
    },
  };
}

// ---------------------------------------------------------------------------
// WooCommerce Store API
// ---------------------------------------------------------------------------
export type MappedVariant = { sourceId: string | null; size: string | null; color: string | null; price: number | null };
export type MappedProduct = {
  sourceId: string;
  sourceUrl: string | null;
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  currency: string;
  imageUrls: string[];
  inStock: boolean;
  stock: number | null;
  variants: MappedVariant[];
};

const SIZE_RE = /size|taille|gr(?:ö|oe)sse|taglia|talla|grösse/i;
const COLOR_RE = /colou?r|couleur|farbe|colore/i;

function minorToAmount(v: unknown, minor: unknown): number | null {
  const s = typeof v === "number" ? String(v) : str(v);
  if (!s || !/^\d{1,12}$/.test(s)) return null;
  const digits = typeof minor === "number" && minor >= 0 && minor <= 4 ? minor : 2;
  return Number(s) / 10 ** digits;
}

function attrValue(attrs: unknown, re: RegExp): string | null {
  if (!Array.isArray(attrs)) return null;
  for (const a of attrs) {
    if (isObj(a) && re.test(str(a.name) ?? "")) return htmlToText(str(a.value), 40) || null;
  }
  return null;
}

export function mapWooProduct(raw: unknown): MappedProduct | null {
  if (!isObj(raw)) return null;
  const sourceId = idOf(raw.id);
  const name = htmlToText(str(raw.name), 160);
  if (!sourceId || !name) return null;
  const prices = isObj(raw.prices) ? raw.prices : {};
  const price = minorToAmount(prices.price, prices.currency_minor_unit);
  const currency = (str(prices.currency_code) ?? "").toUpperCase();
  if (price === null || !/^[A-Z]{3}$/.test(currency)) return null;
  const description = htmlToText(rendered(raw.short_description) ?? rendered(raw.description), 2000) || null;
  const category = Array.isArray(raw.categories) && isObj(raw.categories[0]) ? htmlToText(str(raw.categories[0].name), 80) || null : null;
  const imageUrls = (Array.isArray(raw.images) ? raw.images : [])
    .map((i) => (isObj(i) ? httpsLink(i.src) : null))
    .filter((x): x is string => !!x)
    .slice(0, 8);
  const inStock = raw.is_in_stock !== false;
  const lowStock = typeof raw.low_stock_remaining === "number" && raw.low_stock_remaining >= 0 ? Math.floor(raw.low_stock_remaining) : null;
  const variants: MappedVariant[] = (Array.isArray(raw.variations) ? raw.variations : [])
    .filter(isObj)
    .map((v) => ({ sourceId: idOf(v.id), size: attrValue(v.attributes, SIZE_RE), color: attrValue(v.attributes, COLOR_RE), price: null }))
    .filter((v) => v.size || v.color)
    .slice(0, 50);
  if (!variants.length) {
    // Simple product with a size / colour attribute list: one variant per term.
    const sizeAttr = (Array.isArray(raw.attributes) ? raw.attributes : []).find((a) => isObj(a) && SIZE_RE.test(str(a.name) ?? "")) as Obj | undefined;
    const terms = sizeAttr && Array.isArray(sizeAttr.terms) ? sizeAttr.terms : [];
    for (const t of terms.slice(0, 50)) {
      const label = isObj(t) ? htmlToText(str(t.name), 40) : "";
      if (label) variants.push({ sourceId: null, size: label, color: null, price: null });
    }
  }
  if (!variants.length) variants.push({ sourceId: null, size: null, color: null, price: null });
  return {
    sourceId,
    sourceUrl: httpsLink(raw.permalink),
    name,
    description,
    category,
    price,
    currency,
    imageUrls,
    inStock,
    stock: inStock ? lowStock : 0,
    variants,
  };
}

// ---------------------------------------------------------------------------
// WordPress posts -> public news
// ---------------------------------------------------------------------------
export type MappedPost = { sourceId: string; title: string; excerpt: string | null; bodyHtml: string | null; linkUrl: string | null; publishedAt: string };

export function mapWpPost(raw: unknown): MappedPost | null {
  if (!isObj(raw)) return null;
  const sourceId = idOf(raw.id);
  const title = htmlToText(rendered(raw.title), 200);
  const status = str(raw.status);
  if (!sourceId || !title || (status && status !== "publish")) return null;
  const publishedAt = wpDateToIso(raw.date_gmt, raw.date) ?? new Date(0).toISOString();
  const excerptSrc = rendered(raw.excerpt) ?? rendered(raw.content);
  const excerpt = htmlToText(excerptSrc, 400) || null;
  const bodyHtml = sanitizeHtml(rendered(raw.content), 20_000) || null;
  return { sourceId, title, excerpt, bodyHtml, linkUrl: httpsLink(raw.link), publishedAt };
}
