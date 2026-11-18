/**
 * Camp seasons — pure helpers shared by the admin, the parent app, the public
 * pages and the unit tests. Mirrors public.camp_season_of() /
 * camp_season_year_of() and the split rule of camp_split_by_season_core()
 * (migration 20250420101200_camp_seasons_basket.sql).
 */

export const CAMP_SEASONS = ["spring", "summer", "fall", "winter", "other"] as const;
export type CampSeason = (typeof CAMP_SEASONS)[number];
export type SeasonOfYear = { season: CampSeason; year: number };

/** Order of the seasons inside one year (a winter starts in its December, so it comes last). */
const SEASON_ORDER: Record<CampSeason, number> = { spring: 1, summer: 2, fall: 3, winter: 4, other: 5 };

function parts(day: string | null | undefined): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? "");
  return m ? { y: Number(m[1]), m: Number(m[2]) } : null;
}

/** Season of a day (YYYY-MM-DD): Mar–May spring, Jun–Aug summer, Sep–Nov fall, Dec–Feb winter (year of its December). */
export function seasonOf(day: string | null | undefined): SeasonOfYear | null {
  const p = parts(day);
  if (!p) return null;
  if (p.m >= 3 && p.m <= 5) return { season: "spring", year: p.y };
  if (p.m >= 6 && p.m <= 8) return { season: "summer", year: p.y };
  if (p.m >= 9 && p.m <= 11) return { season: "fall", year: p.y };
  return { season: "winter", year: p.m <= 2 ? p.y - 1 : p.y };
}

export function isCampSeason(v: unknown): v is CampSeason {
  return typeof v === "string" && (CAMP_SEASONS as readonly string[]).includes(v);
}

export function seasonKey(s: SeasonOfYear): string {
  return `${s.season}-${s.year}`;
}

/**
 * The season of a camp: the one set on the programme wins; otherwise it is
 * derived from its first week. A season set without a year takes the year of
 * the first week.
 */
export function campSeason(c: { season?: string | null; seasonYear?: number | null; firstStart?: string | null }): SeasonOfYear | null {
  const derived = seasonOf(c.firstStart);
  if (isCampSeason(c.season)) {
    const year = c.seasonYear ?? derived?.year ?? null;
    return year === null ? null : { season: c.season, year };
  }
  return derived;
}

export type SeasonGroup<T> = { key: string; season: CampSeason | null; year: number | null; items: T[] };

/** Groups items by season, chronologically (2027 spring, summer, fall, winter, then 2028 …); unknown season last. */
export function groupBySeason<T>(items: T[], get: (item: T) => SeasonOfYear | null): SeasonGroup<T>[] {
  const map = new Map<string, SeasonGroup<T>>();
  for (const it of items) {
    const s = get(it);
    const key = s ? seasonKey(s) : "none";
    let g = map.get(key);
    if (!g) {
      g = { key, season: s?.season ?? null, year: s?.year ?? null, items: [] };
      map.set(key, g);
    }
    g.items.push(it);
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return a.year - b.year || SEASON_ORDER[a.season!] - SEASON_ORDER[b.season!];
  });
}

export type SplitPlan = {
  keep: SeasonOfYear & { editionIds: string[] };
  create: (SeasonOfYear & { editionIds: string[]; firstDay: string })[];
};

/**
 * What "Split by season" will do (mirrors camp_split_by_season_core): one
 * group per season; the original camp keeps the season with the most
 * editions (tie: the earliest), every other season becomes a new camp.
 * null when there is nothing to split (fewer than two seasons).
 */
export function planSeasonSplit(editions: { id: string; startsOn: string; endsOn?: string }[]): SplitPlan | null {
  const groups = new Map<string, SeasonOfYear & { editionIds: string[]; firstDay: string }>();
  for (const e of editions) {
    const s = seasonOf(e.startsOn);
    if (!s) continue;
    const k = seasonKey(s);
    const g = groups.get(k) ?? { ...s, editionIds: [], firstDay: e.startsOn };
    g.editionIds.push(e.id);
    if (e.startsOn < g.firstDay) g.firstDay = e.startsOn;
    groups.set(k, g);
  }
  if (groups.size < 2) return null;
  const list = Array.from(groups.values());
  const keep = [...list].sort((a, b) => b.editionIds.length - a.editionIds.length || (a.firstDay < b.firstDay ? -1 : a.firstDay > b.firstDay ? 1 : 0))[0];
  const create = list.filter((g) => g !== keep).sort((a, b) => (a.firstDay < b.firstDay ? -1 : 1));
  return { keep: { season: keep.season, year: keep.year, editionIds: keep.editionIds }, create };
}

/** "Summer Camp 2027" -> "Summer Camp 2028"; a name without a year gets none added. */
export function nextYearName(name: string, years = 1): string {
  return name.replace(/\b(19|20)(\d{2})\b/g, (y) => String(Number(y) + years));
}

/** "dlang-summer-camp-2027" -> "dlang-summer-camp-2028"; no year -> "<slug>-<next year>". */
export function nextYearSlug(slug: string | null, fallbackYear: number): string {
  const base = (slug ?? "camp").toLowerCase();
  if (/(19|20)\d{2}/.test(base)) return base.replace(/(19|20)(\d{2})/g, (y) => String(Number(y) + 1));
  return `${base}-${fallbackYear}`;
}
