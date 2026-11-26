/**
 * Training plan helpers — pure: which plan week is current, grouping items
 * by week and day, completion progress, and safe embeds for video links.
 */

const DAY_MS = 864e5;
const toUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** 1-based plan week for `today` (clamped to 1..weeks); null before the start or after the last week. */
export function currentWeek(startsOn: string, today: string, weeks: number): number | null {
  const diff = Math.floor((toUtc(today) - toUtc(startsOn)) / DAY_MS);
  if (!Number.isFinite(diff) || diff < 0) return null;
  const w = Math.floor(diff / 7) + 1;
  return w > weeks ? null : w;
}

/** Calendar date (yyyy-mm-dd) of plan week `week`, weekday `day` (1 = first day of the plan week). */
export function dateFor(startsOn: string, week: number, day: number): string {
  const d = new Date(toUtc(startsOn) + ((week - 1) * 7 + (day - 1)) * DAY_MS);
  return d.toISOString().slice(0, 10);
}

export type PlanItemLike = { id: string; week: number; day: number; sortOrder: number };

/** week -> day -> items, ordered. */
export function groupPlan<T extends PlanItemLike>(items: T[]): { week: number; days: { day: number; items: T[] }[] }[] {
  const weeks = new Map<number, Map<number, T[]>>();
  for (const it of items) {
    const w = weeks.get(it.week) ?? new Map<number, T[]>();
    const d = w.get(it.day) ?? [];
    d.push(it);
    w.set(it.day, d);
    weeks.set(it.week, w);
  }
  return Array.from(weeks.entries())
    .sort(([a], [b]) => a - b)
    .map(([week, days]) => ({
      week,
      days: Array.from(days.entries())
        .sort(([a], [b]) => a - b)
        .map(([day, list]) => ({ day, items: list.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)) })),
    }));
}

/** Share (0..100) of the plan items checked off. */
export function completionRate(itemIds: string[], completedIds: Iterable<string>): number {
  if (itemIds.length === 0) return 0;
  const done = new Set(completedIds);
  return Math.round((itemIds.filter((id) => done.has(id)).length / itemIds.length) * 100);
}

/**
 * Embed URL for a YouTube or Vimeo link (privacy-enhanced YouTube domain);
 * null for anything else, which is then shown as a plain external link.
 */
export function videoEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const idOk = (s: string | null | undefined) => (s && /^[A-Za-z0-9_-]{6,20}$/.test(s) ? s : null);
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const id = idOk(u.pathname === "/watch" ? u.searchParams.get("v") : u.pathname.match(/^\/(?:embed|shorts)\/([^/?#]+)/)?.[1]);
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }
  if (host === "youtu.be") {
    const id = idOk(u.pathname.slice(1).split("/")[0]);
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = u.pathname.match(/(\d{5,12})/)?.[1];
    return id ? `https://player.vimeo.com/video/${id}?dnt=1` : null;
  }
  return null;
}
