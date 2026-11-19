/**
 * Pure facility maths (no I/O): weekly court allocations expanded into
 * concrete slots (DST-correct in the club's time zone), court conflict
 * detection for recurring and one-off bookings, and the impact of closing a
 * venue for a date range. Unit tested in tests/unit/operations.test.ts.
 */
import { zonedWallTimeToUtc } from "@/lib/format";
import { addDayKey, dayKeysBetween, isoWeekday, windowFor, zonedDayKey } from "@/lib/staff/hours";

export type Allocation = {
  id: string;
  venueId: string;
  spaceId: string | null;
  teamId: string | null;
  label: string;
  weekday: number; // ISO 1 = Monday … 7 = Sunday
  startTime: string; // "HH:MM[:SS]"
  endTime: string;
  validFrom: string; // "YYYY-MM-DD"
  validUntil: string | null;
  isActive: boolean;
};

/** A concrete booking of a court: team event, rental, training booking … */
export type OneOff = {
  id: string;
  kind: "event" | "rental" | "booking" | "allocation";
  venueId: string;
  spaceId: string | null;
  label: string;
  start: string; // ISO instant
  end: string;
};

export type Conflict = { kind: OneOff["kind"]; id: string; label: string; start: string | null; end: string | null };

const hhmm = (t: string) => t.slice(0, 5);
const ms = (iso: string) => Date.parse(iso);

/** Same court? A booking of the whole venue (no space) blocks every space. */
export function sameCourt(a: { venueId: string; spaceId: string | null }, b: { venueId: string; spaceId: string | null }): boolean {
  if (a.venueId !== b.venueId) return false;
  return !a.spaceId || !b.spaceId || a.spaceId === b.spaceId;
}

/** Half-open [start, end) overlap of two instants ranges. */
export function overlapsIso(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);
}

/** "HH:MM" wall-clock overlap (same day). */
export function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return hhmm(aStart) < hhmm(bEnd) && hhmm(bStart) < hhmm(aEnd);
}

/** Do two validity ranges (open-ended = null) share at least one day? */
export function datesOverlap(aFrom: string, aUntil: string | null, bFrom: string, bUntil: string | null): boolean {
  return (bUntil === null || aFrom <= bUntil) && (aUntil === null || bFrom <= aUntil);
}

/** Concrete slots of the allocations on club-local days [fromKey, toKey]. */
export function expandAllocations(allocations: Allocation[], fromKey: string, toKey: string, timeZone: string): OneOff[] {
  const out: OneOff[] = [];
  for (const day of dayKeysBetween(fromKey, toKey)) {
    const dow = isoWeekday(day);
    for (const a of allocations) {
      if (!a.isActive || a.weekday !== dow || day < a.validFrom || (a.validUntil && day > a.validUntil)) continue;
      const start = zonedWallTimeToUtc(day, hhmm(a.startTime), timeZone);
      const end = zonedWallTimeToUtc(day, hhmm(a.endTime), timeZone);
      if (!start || !end || end <= start) continue;
      out.push({ id: a.id, kind: "allocation", venueId: a.venueId, spaceId: a.spaceId, label: a.label, start: start.toISOString(), end: end.toISOString() });
    }
  }
  return out.sort((x, y) => ms(x.start) - ms(y.start));
}

/** Two weekly allocations that would hold the same court at the same time. */
export function allocationsClash(a: Allocation, b: Allocation): boolean {
  if (a.id === b.id || !a.isActive || !b.isActive) return false;
  if (!sameCourt(a, b) || a.weekday !== b.weekday) return false;
  return timesOverlap(a.startTime, a.endTime, b.startTime, b.endTime) && datesOverlap(a.validFrom, a.validUntil, b.validFrom, b.validUntil);
}

/**
 * Conflicts of a candidate (a weekly allocation or a one-off booking) with
 * the club's existing allocations and one-off bookings. One-offs are compared
 * against the candidate's weekly slots expanded over the one-off's days, so
 * daylight-saving changes never hide or invent a clash.
 */
export function findCourtConflicts(
  candidate: { allocation: Allocation } | { oneOff: OneOff },
  existing: { allocations: Allocation[]; oneOffs: OneOff[] },
  timeZone: string,
): Conflict[] {
  const out: Conflict[] = [];
  const seen = new Set<string>();
  const push = (c: Conflict) => {
    const key = `${c.kind}:${c.id}:${c.start ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  };
  if ("allocation" in candidate) {
    const a = candidate.allocation;
    for (const b of existing.allocations) {
      if (allocationsClash(a, b)) push({ kind: "allocation", id: b.id, label: b.label, start: null, end: null });
    }
    for (const o of existing.oneOffs) {
      if (o.id === a.id || !sameCourt(a, o)) continue;
      const fromKey = addDayKey(zonedDayKey(o.start, timeZone), -1);
      const toKey = addDayKey(zonedDayKey(o.end, timeZone), 1);
      if (expandAllocations([a], fromKey, toKey, timeZone).some((slot) => overlapsIso(slot, o))) {
        push({ kind: o.kind, id: o.id, label: o.label, start: o.start, end: o.end });
      }
    }
    return out;
  }
  const o = candidate.oneOff;
  const fromKey = addDayKey(zonedDayKey(o.start, timeZone), -1);
  const toKey = addDayKey(zonedDayKey(o.end, timeZone), 1);
  for (const slot of expandAllocations(existing.allocations.filter((b) => sameCourt(b, o)), fromKey, toKey, timeZone)) {
    if (slot.id !== o.id && overlapsIso(slot, o)) push({ kind: "allocation", id: slot.id, label: slot.label, start: slot.start, end: slot.end });
  }
  for (const b of existing.oneOffs) {
    if (b.id === o.id || !sameCourt(o, b)) continue;
    if (overlapsIso(o, b)) push({ kind: b.kind, id: b.id, label: b.label, start: b.start, end: b.end });
  }
  return out;
}

/** Pairs of clashing allocations within a list (for the weekly grid). */
export function allocationClashes(allocations: Allocation[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < allocations.length; i++) {
    for (let j = i + 1; j < allocations.length; j++) {
      const a = allocations[i];
      const b = allocations[j];
      if (!allocationsClash(a, b)) continue;
      out.set(a.id, [...(out.get(a.id) ?? []), b.id]);
      out.set(b.id, [...(out.get(b.id) ?? []), a.id]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Venue closures
// ---------------------------------------------------------------------------

export type Closure = { venueId: string; spaceId: string | null; startsOn: string; endsOn: string };

export const IMPACT_KINDS = ["event", "session", "camp", "booking", "rental", "allocation"] as const;
export type ImpactKind = (typeof IMPACT_KINDS)[number];

/** Something scheduled at a venue. Camps are all-day date ranges. */
export type ScheduledItem = {
  kind: ImpactKind;
  id: string;
  venueId: string | null;
  spaceId: string | null;
  label: string;
  start: string; // ISO instant, or "YYYY-MM-DD" when allDay
  end: string;
  allDay: boolean;
  status: string | null;
  teamId?: string | null;
  programId?: string | null;
  campEditionId?: string | null;
  coachIds?: string[];
  athleteId?: string | null;
};

const DEAD = new Set(["cancelled", "completed", "archived", "no_show"]);

/** Is an item touched by the closure (same venue / space, overlapping days, still live)? */
export function isAffected(closure: Closure, item: ScheduledItem, timeZone: string): boolean {
  if (!item.venueId || item.venueId !== closure.venueId) return false;
  if (item.status && DEAD.has(item.status)) return false;
  if (closure.spaceId && item.spaceId && item.spaceId !== closure.spaceId) return false;
  if (item.allDay) return item.start.slice(0, 10) <= closure.endsOn && item.end.slice(0, 10) >= closure.startsOn;
  const win = windowFor(closure.startsOn, closure.endsOn, timeZone);
  return ms(item.start) < win.to.getTime() && win.from.getTime() < ms(item.end);
}

export type ClosureImpact = {
  items: ScheduledItem[];
  counts: Record<ImpactKind, number>;
  teamIds: string[];
  programIds: string[];
  campEditionIds: string[];
  coachIds: string[];
  athleteIds: string[];
};

/**
 * Everything a closure touches. Weekly allocations are expanded over the
 * closure's days, so a team training twice a week during a two-week closure
 * shows four slots.
 */
export function computeClosureImpact(closure: Closure, items: ScheduledItem[], allocations: Allocation[], timeZone: string): ClosureImpact {
  const slots: ScheduledItem[] = expandAllocations(
    allocations.filter((a) => a.venueId === closure.venueId),
    closure.startsOn,
    closure.endsOn,
    timeZone,
  ).map((s) => {
    const a = allocations.find((x) => x.id === s.id);
    return { kind: "allocation", id: `${s.id}:${s.start}`, venueId: s.venueId, spaceId: s.spaceId, label: s.label, start: s.start, end: s.end, allDay: false, status: null, teamId: a?.teamId ?? null };
  });
  const affected = [...items, ...slots]
    .filter((i) => isAffected(closure, i, timeZone))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.kind.localeCompare(b.kind)));
  const counts = Object.fromEntries(IMPACT_KINDS.map((k) => [k, 0])) as Record<ImpactKind, number>;
  const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => !!x))).sort();
  for (const i of affected) counts[i.kind] += 1;
  return {
    items: affected,
    counts,
    teamIds: uniq(affected.map((i) => i.teamId)),
    programIds: uniq(affected.map((i) => i.programId)),
    campEditionIds: uniq(affected.map((i) => i.campEditionId)),
    coachIds: uniq(affected.flatMap((i) => i.coachIds ?? [])),
    athleteIds: uniq(affected.map((i) => i.athleteId)),
  };
}

/** Move an instant (or a "YYYY-MM-DD" day) by whole club-local days. */
export function shiftByDays(value: string, days: number, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return addDayKey(value, days);
  const day = zonedDayKey(value, timeZone);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(value));
  return (zonedWallTimeToUtc(addDayKey(day, days), time, timeZone) ?? new Date(ms(value) + days * 864e5)).toISOString();
}

/** Does a venue's free-text location name refer to the venue (case / spacing insensitive)? */
export function locationMatchesVenue(location: string | null | undefined, venueName: string): boolean {
  const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!location) return false;
  const l = norm(location);
  const v = norm(venueName);
  return v.length > 0 && (l === v || l.startsWith(`${v},`) || l.startsWith(`${v} -`) || l.startsWith(`${v} ·`));
}
