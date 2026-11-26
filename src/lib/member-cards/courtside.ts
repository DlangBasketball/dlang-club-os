/**
 * "Courtside" member card: pure helpers shared by the card component, the
 * server loader and the unit tests (no I/O, no React).
 *
 *   - cardLayout():     WITH photo vs WITHOUT photo layout
 *   - fitName():        up to two balanced lines + a size step for long names
 *   - resolveCardBrands(): TypeScript mirror of the SQL brand resolution
 *     (public.member_card_brand_sources / member_card_brands_json in
 *     migration 20250420105200_member_card_courtside.sql)
 *
 * Brands are data (billing entity + member_card_brands row); nothing here
 * names a club.
 */

export type CardBrandSource = "club_membership" | "selection" | "training";
export const CARD_BRAND_SOURCES: readonly CardBrandSource[] = ["club_membership", "selection", "training"];

/** One brand as the card renders it (URLs already signed server-side). */
export type CourtsideBrand = {
  entityId: string | null;
  displayName: string;
  subtitle: string | null;
  logoUrl: string | null;
  watermarkUrl: string | null;
  sources: CardBrandSource[];
  isFallback: boolean;
};

export type CourtsideCardData = {
  athleteId: string;
  name: string;
  /** SVG markup of the QR code (server-generated from the opaque token), null when the card is inactive. */
  qrSvg: string | null;
  cardActive: boolean;
  /** Club decision: QR check-in on (the card shows its QR) or off (no QR on the card). */
  checkIn: boolean;
  photoUrl: string | null;
  brands: CourtsideBrand[];
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
export type CardLayout = "photo" | "noPhoto";

export function cardLayout(photoUrl: string | null | undefined): CardLayout {
  return typeof photoUrl === "string" && photoUrl.trim() !== "" ? "photo" : "noPhoto";
}

// ---------------------------------------------------------------------------
// Name fitting
// ---------------------------------------------------------------------------
export type NameSize = "xl" | "lg" | "md" | "sm" | "xs";
export type FittedName = { lines: string[]; size: NameSize };

/**
 * Characters per line that still fit at each size step in the name banner
 * (same banner width in both layouts). The
 * card scales with its width (container units), so these hold from 320 px
 * phones to desktop.
 */
const CAPACITY: Record<CardLayout, Record<NameSize, number>> = {
  photo:   { xl: 11, lg: 14, md: 17, sm: 21, xs: 26 },
  noPhoto: { xl: 11, lg: 14, md: 17, sm: 21, xs: 26 },
};
const SIZES: NameSize[] = ["xl", "lg", "md", "sm", "xs"];

/** Split words into two lines with the most even lengths (longest line minimal). */
function balance(words: string[]): string[] {
  if (words.length < 2) return [words.join(" ")];
  let best: string[] = [words.join(" ")];
  let bestLen = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const len = Math.max(a.length, b.length);
    if (len < bestLen) { bestLen = len; best = [a, b]; }
  }
  return best;
}

/** Shorten a line to `max` characters with an ellipsis (last resort). */
function clip(line: string, max: number): string {
  return line.length <= max ? line : `${line.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/**
 * Fit a full name on the card: one line when it fits at a large size, else
 * two balanced lines, stepping the size down; never more than two lines.
 */
export function fitName(rawName: string, layout: CardLayout): FittedName {
  const name = rawName.replace(/\s+/g, " ").trim();
  if (!name) return { lines: [""], size: "xl" };
  const cap = CAPACITY[layout];
  const words = name.split(" ");

  // One line at xl / lg.
  for (const size of ["xl", "lg"] as const) if (name.length <= cap[size]) return { lines: [name], size };

  // Two lines: pick the largest size where the longest balanced line fits.
  const two = balance(words);
  const longest = Math.max(...two.map((l) => l.length));
  for (const size of SIZES) if (longest <= cap[size]) return { lines: two, size };

  // Still too long (one very long word or many words): smallest size, clipped.
  return { lines: two.map((l) => clip(l, cap.xs)), size: "xs" };
}

// ---------------------------------------------------------------------------
// Brand resolution (mirror of the SQL)
// ---------------------------------------------------------------------------
export type BrandInputs = {
  /** ISO date (club time zone) for validity checks. */
  today: string;
  /** Epoch ms for package expiry. */
  now: number;
  defaultEntityId: string | null;
  /** activity -> routed entity id. */
  routes: Partial<Record<CardBrandSource, string>>;
  /** entity id -> active? (unknown entity = inactive). */
  entities: Record<string, { name: string; isActive: boolean }>;
  memberships: {
    status: string;
    validFrom: string;
    validUntil: string;
    /** Entity of the membership's invoice and how it was set. */
    invoiceEntityId?: string | null;
    invoiceEntitySource?: string | null;
    invoiceStatus?: string | null;
  }[];
  selections: { status: string; programActive: boolean; programEndsOn: string | null }[];
  packages: { status: string; expiresAt: string | null; sessions: number; sessionsUsed: number }[];
};

export type ResolvedBrand = { entityId: string; sources: CardBrandSource[]; isFallback: boolean };

const ORDER: Record<CardBrandSource, number> = { club_membership: 1, selection: 2, training: 3 };

function routed(inp: BrandInputs, activity: CardBrandSource): string | null {
  const r = inp.routes[activity];
  if (r && inp.entities[r]?.isActive) return r;
  const d = inp.defaultEntityId;
  return d && inp.entities[d]?.isActive ? d : null;
}

export function resolveCardBrands(inp: BrandInputs): ResolvedBrand[] {
  const found: { entity: string | null; source: CardBrandSource }[] = [];

  for (const m of inp.memberships) {
    if (m.status !== "active" || inp.today < m.validFrom || inp.today > m.validUntil) continue;
    const invoiceOk = !!m.invoiceEntityId && m.invoiceEntitySource !== "migration_default"
      && !["void", "cancelled", "refunded"].includes(m.invoiceStatus ?? "");
    found.push({ entity: invoiceOk ? m.invoiceEntityId! : routed(inp, "club_membership"), source: "club_membership" });
  }
  for (const s of inp.selections) {
    if (s.status !== "enrolled" || !s.programActive) continue;
    if (s.programEndsOn !== null && s.programEndsOn < inp.today) continue;
    found.push({ entity: routed(inp, "selection"), source: "selection" });
  }
  for (const p of inp.packages) {
    if (p.status !== "active" || p.sessionsUsed >= p.sessions) continue;
    if (p.expiresAt !== null && Date.parse(p.expiresAt) <= inp.now) continue;
    found.push({ entity: routed(inp, "training"), source: "training" });
  }

  const byEntity = new Map<string, Set<CardBrandSource>>();
  for (const f of found) {
    if (!f.entity || !inp.entities[f.entity]?.isActive) continue;
    const set = byEntity.get(f.entity) ?? new Set<CardBrandSource>();
    set.add(f.source);
    byEntity.set(f.entity, set);
  }

  const out: ResolvedBrand[] = Array.from(byEntity.entries()).map(([entityId, set]) => ({
    entityId,
    sources: Array.from(set).sort((a, b) => ORDER[a] - ORDER[b]),
    isFallback: false,
  }));
  out.sort((a, b) => ORDER[a.sources[0]] - ORDER[b.sources[0]]
    || (inp.entities[a.entityId]?.name ?? "").localeCompare(inp.entities[b.entityId]?.name ?? ""));
  if (out.length > 0) return out;

  const fallback = routed(inp, "club_membership");
  return fallback ? [{ entityId: fallback, sources: [], isFallback: true }] : [];
}

/** Synthetic names for the card preview (short, hyphenated, very long). Never real people. */
export const PREVIEW_NAMES: readonly string[] = [
  "Alex Martin",
  "Noa Keller-Dubois",
  "Maximilian Alexander von Hohenberg-Castellanos",
];

/** Initials for a text-only lockup when a brand has no logo ("DLang Sports Club" -> "DSC"). */
export function brandInitials(name: string, max = 3): string {
  return name
    .split(/[\s\-·]+/)
    .filter((w) => /\p{L}/u.test(w))
    .map((w) => w.match(/\p{L}/u)?.[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, max);
}
