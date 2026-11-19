/**
 * Club calendar aggregation (pure): one item shape for team events,
 * programme sessions, camp editions, training bookings, staff shifts and
 * club events, plus filtering, day grouping and month / week / day ranges.
 * Loading (and scoping per role) lives in ./data.ts.
 */
import { addDayKey, dayKeysBetween, isoWeekday, zonedDayKey } from "@/lib/staff/hours";

export const CALENDAR_KINDS = ["team_event", "session", "camp", "booking", "shift", "club_event"] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];
export const CALENDAR_VIEWS = ["month", "week", "day", "list"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export type CalendarItem = {
  /** Unique across kinds: `${kind}:${sourceId}` (shifts add the day). */
  id: string;
  kind: CalendarKind;
  sourceId: string;
  title: string;
  /** Finer type: team event type, club event type, programme kind ... */
  subtype: string | null;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  venueId: string | null;
  teamId: string | null;
  coachIds: string[];
  /** Staff shift: the employee. */
  profileId: string | null;
  status: string | null;
  href: string | null;
  color: string | null;
  description: string | null;
  /** Programme session linked from a team event (used for de-duplication). */
  linkedSessionId?: string | null;
};

export type CalendarFilters = {
  kinds?: CalendarKind[];
  teamId?: string | null;
  coachId?: string | null;
  venueId?: string | null;
};

export function isCalendarKind(v: unknown): v is CalendarKind {
  return typeof v === "string" && (CALENDAR_KINDS as readonly string[]).includes(v);
}
export function isCalendarView(v: unknown): v is CalendarView {
  return typeof v === "string" && (CALENDAR_VIEWS as readonly string[]).includes(v);
}

export function applyFilters(items: CalendarItem[], f: CalendarFilters): CalendarItem[] {
  return items.filter(
    (i) =>
      (!f.kinds || f.kinds.length === 0 || f.kinds.includes(i.kind)) &&
      (!f.teamId || i.teamId === f.teamId) &&
      (!f.coachId || i.coachIds.includes(f.coachId)) &&
      (!f.venueId || i.venueId === f.venueId),
  );
}

/** A team event linked to a programme session replaces that session. */
export function dedupeLinked(items: CalendarItem[]): CalendarItem[] {
  const linked = new Set(items.filter((i) => i.kind === "team_event" && i.linkedSessionId).map((i) => i.linkedSessionId as string));
  const seen = new Set<string>();
  return items.filter((i) => {
    if (i.kind === "session" && linked.has(i.sourceId)) return false;
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

export function sortItems(items: CalendarItem[]): CalendarItem[] {
  return [...items].sort(
    (a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title),
  );
}

/** Club-local day keys an item covers (all-day items: inclusive end date). */
export function itemDayKeys(item: CalendarItem, timeZone: string): string[] {
  if (item.allDay) {
    const from = item.start.slice(0, 10);
    const to = item.end.slice(0, 10);
    return dayKeysBetween(from, to < from ? from : to).slice(0, 62);
  }
  const from = zonedDayKey(item.start, timeZone);
  // An event ending exactly at midnight does not spill into the next day.
  const endMs = Math.max(Date.parse(item.end) - 1, Date.parse(item.start));
  const to = zonedDayKey(new Date(endMs), timeZone);
  return dayKeysBetween(from, to).slice(0, 62);
}

/** Items per club-local day for [fromKey, toKey] (every key present). */
export function groupByDay(items: CalendarItem[], fromKey: string, toKey: string, timeZone: string): Map<string, CalendarItem[]> {
  const out = new Map<string, CalendarItem[]>(dayKeysBetween(fromKey, toKey).map((k) => [k, []]));
  for (const item of sortItems(items)) {
    for (const k of itemDayKeys(item, timeZone)) out.get(k)?.push(item);
  }
  return out;
}

/** Does the item touch club-local days [fromKey, toKey]? */
export function inRange(item: CalendarItem, fromKey: string, toKey: string, timeZone: string): boolean {
  const keys = itemDayKeys(item, timeZone);
  return keys.length > 0 && keys[0] <= toKey && keys[keys.length - 1] >= fromKey;
}

/** First day of the week containing `key` (firstDow: 0 = Sunday, 1 = Monday). */
export function startOfWeek(key: string, firstDow: 0 | 1 = 1): string {
  const iso = isoWeekday(key); // 1..7
  const offset = firstDow === 1 ? iso - 1 : iso % 7;
  return addDayKey(key, -offset);
}

/** The days a view shows around `anchorKey`. */
export function viewRange(view: CalendarView, anchorKey: string, firstDow: 0 | 1 = 1): { from: string; to: string } {
  if (view === "day") return { from: anchorKey, to: anchorKey };
  if (view === "week") {
    const from = startOfWeek(anchorKey, firstDow);
    return { from, to: addDayKey(from, 6) };
  }
  if (view === "list") return { from: anchorKey, to: addDayKey(anchorKey, 27) };
  const grid = monthGrid(anchorKey, firstDow);
  return { from: grid[0][0], to: grid[grid.length - 1][6] };
}

/** Anchor for the previous / next page of a view. */
export function stepAnchor(view: CalendarView, anchorKey: string, step: number): string {
  if (view === "day") return addDayKey(anchorKey, step);
  if (view === "week") return addDayKey(anchorKey, 7 * step);
  if (view === "list") return addDayKey(anchorKey, 28 * step);
  const [y, m] = anchorKey.split("-").map(Number);
  const idx = y * 12 + (m - 1) + step;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`;
}

/** Weeks (rows of 7 day keys) covering the month of `anchorKey`. */
export function monthGrid(anchorKey: string, firstDow: 0 | 1 = 1): string[][] {
  const first = `${anchorKey.slice(0, 7)}-01`;
  const [y, m] = first.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const last = addDayKey(nextMonth, -1);
  const weeks: string[][] = [];
  for (let start = startOfWeek(first, firstDow); start <= last; start = addDayKey(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDayKey(start, i)));
  }
  return weeks;
}

/** Merge item lists from every source into one sorted, de-duplicated list. */
export function mergeSources(...lists: CalendarItem[][]): CalendarItem[] {
  return sortItems(dedupeLinked(lists.flat()));
}
