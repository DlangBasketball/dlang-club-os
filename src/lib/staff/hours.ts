/**
 * Pure staff-time maths (no I/O): worked minutes with breaks, planned shifts
 * from weekly templates (overnight, DST-correct in the club's time zone),
 * missed clock-outs, periods, geofence distance and CSV.
 *
 * The database computes the same numbers in public.staff_hours(); these
 * helpers drive the UI (running clock, per-entry rows) and are unit tested.
 */
import { zonedWallTimeToUtc } from "@/lib/format";

export type DateLike = string | Date;
export type BreakSpan = { startedAt: DateLike; endedAt: DateLike | null };
export type TimeEntryLike = {
  clockInAt: DateLike;
  clockOutAt: DateLike | null;
  breaks?: BreakSpan[];
};
export type Window = { from: Date; to: Date };

/** Longest a shift may stay open before it counts as a missed clock-out (mirrors staff_max_shift()). */
export const MAX_SHIFT_HOURS = 16;

const ms = (d: DateLike) => (typeof d === "string" ? Date.parse(d) : d.getTime());

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * Gross, break and worked minutes of one entry. An open entry runs until
 * `now`; `window` clips everything (e.g. a week or one club-local day).
 * Breaks are clipped to the shift and merged, so overlapping breaks never
 * count twice. Real elapsed time: DST changes are handled by the instants.
 */
export function entryMinutes(entry: TimeEntryLike, opts: { now?: Date; window?: Window } = {}) {
  const now = (opts.now ?? new Date()).getTime();
  let start = ms(entry.clockInAt);
  let end = entry.clockOutAt ? ms(entry.clockOutAt) : now;
  if (opts.window) {
    start = Math.max(start, opts.window.from.getTime());
    end = Math.min(end, opts.window.to.getTime());
  }
  if (!(end > start)) return { grossMinutes: 0, breakMinutes: 0, workedMinutes: 0 };

  const spans = (entry.breaks ?? [])
    .map((b) => [Math.max(ms(b.startedAt), start), Math.min(b.endedAt ? ms(b.endedAt) : now, end)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let breakMs = 0;
  let curS = -1;
  let curE = -1;
  for (const [s, e] of spans) {
    if (s > curE) {
      if (curE > curS) breakMs += curE - curS;
      curS = s;
      curE = e;
    } else curE = Math.max(curE, e);
  }
  if (curE > curS) breakMs += curE - curS;

  const grossMs = end - start;
  const round = (x: number) => Math.round(x / 60000);
  return { grossMinutes: round(grossMs), breakMinutes: round(breakMs), workedMinutes: Math.max(0, round(grossMs - breakMs)) };
}

/** Sum of worked minutes over entries (closed ones only unless `includeOpen`). */
export function totalWorkedMinutes(entries: TimeEntryLike[], opts: { now?: Date; window?: Window; includeOpen?: boolean } = {}) {
  return entries
    .filter((e) => opts.includeOpen || e.clockOutAt)
    .reduce((sum, e) => sum + entryMinutes(e, opts).workedMinutes, 0);
}

/** Is this open entry older than the maximum shift length? */
export function isMissedClockOut(entry: { clockInAt: DateLike; clockOutAt: DateLike | null }, now: Date = new Date(), maxHours = MAX_SHIFT_HOURS) {
  return !entry.clockOutAt && now.getTime() - ms(entry.clockInAt) > maxHours * 3600_000;
}

// ---------------------------------------------------------------------------
// Club-local days
// ---------------------------------------------------------------------------

export function addDayKey(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a "YYYY-MM-DD" key. */
export function isoWeekday(key: string): number {
  const dow = new Date(`${key}T00:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function dayKeysBetween(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  for (let k = fromKey; k <= toKey && out.length < 400; k = addDayKey(k, 1)) out.push(k);
  return out;
}

/** Localised name of an ISO weekday (1 = Monday ... 7 = Sunday). */
export function isoWeekdayName(locale: string, iso: number, width: "long" | "short" = "long"): string {
  // 2026-11-01 is a Sunday, so 1 + iso lands on the right weekday.
  return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 1 + iso)));
}

/** "YYYY-MM-DD" of an instant in a time zone. */
export function zonedDayKey(d: DateLike, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    typeof d === "string" ? new Date(d) : d,
  );
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Club-local "YYYY-MM-DD" and "HH:MM" of an instant (prefills date / time inputs). */
export function zonedParts(d: DateLike, timeZone: string): { date: string; time: string } {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    typeof d === "string" ? new Date(d) : d,
  );
  return { date: zonedDayKey(d, timeZone), time };
}

/** UTC bounds of club-local days [fromKey, toKey]. */
export function windowFor(fromKey: string, toKey: string, timeZone: string): Window {
  return {
    from: zonedWallTimeToUtc(fromKey, "00:00", timeZone) ?? new Date(`${fromKey}T00:00:00Z`),
    to: zonedWallTimeToUtc(addDayKey(toKey, 1), "00:00", timeZone) ?? new Date(`${addDayKey(toKey, 1)}T00:00:00Z`),
  };
}

export type PeriodKind = "week" | "month";

/** The week (Monday-Sunday) or calendar month containing `anchorKey`. */
export function periodRange(kind: PeriodKind, anchorKey: string): { from: string; to: string } {
  if (kind === "month") {
    const [y, m] = anchorKey.split("-").map(Number);
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    return { from, to: addDayKey(next, -1) };
  }
  const from = addDayKey(anchorKey, -(isoWeekday(anchorKey) - 1));
  return { from, to: addDayKey(from, 6) };
}

export function shiftPeriod(kind: PeriodKind, fromKey: string, step: number): { from: string; to: string } {
  if (kind === "week") return periodRange("week", addDayKey(fromKey, 7 * step));
  const [y, m] = fromKey.split("-").map(Number);
  const idx = y * 12 + (m - 1) + step;
  return periodRange("month", `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`);
}

// ---------------------------------------------------------------------------
// Planned shifts (weekly templates)
// ---------------------------------------------------------------------------

export type ShiftTemplate = {
  id: string;
  profileId: string;
  venueId: string | null;
  weekday: number; // ISO 1..7
  startTime: string; // "HH:MM[:SS]"
  endTime: string; // <= startTime: ends the next day
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
};

export type PlannedShift = { templateId: string; profileId: string; venueId: string | null; dayKey: string; start: Date; end: Date };

const hhmm = (t: string) => t.slice(0, 5);

/** Is the template's end on the following day? */
export function isOvernight(startTime: string, endTime: string): boolean {
  return hhmm(endTime) <= hhmm(startTime);
}

/** Concrete shifts of the templates on club-local days [fromKey, toKey]. */
export function expandShiftTemplates(templates: ShiftTemplate[], fromKey: string, toKey: string, timeZone: string): PlannedShift[] {
  const out: PlannedShift[] = [];
  for (const day of dayKeysBetween(fromKey, toKey)) {
    const dow = isoWeekday(day);
    for (const t of templates) {
      if (!t.isActive || t.weekday !== dow) continue;
      if (t.validFrom && day < t.validFrom) continue;
      if (t.validUntil && day > t.validUntil) continue;
      const start = zonedWallTimeToUtc(day, hhmm(t.startTime), timeZone);
      const end = zonedWallTimeToUtc(isOvernight(t.startTime, t.endTime) ? addDayKey(day, 1) : day, hhmm(t.endTime), timeZone);
      if (!start || !end || end <= start) continue;
      out.push({ templateId: t.id, profileId: t.profileId, venueId: t.venueId, dayKey: day, start, end });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Planned minutes per profile (overnight shifts count on their start day). */
export function plannedMinutesByProfile(templates: ShiftTemplate[], fromKey: string, toKey: string, timeZone: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of expandShiftTemplates(templates, fromKey, toKey, timeZone)) {
    out.set(s.profileId, (out.get(s.profileId) ?? 0) + Math.round((s.end.getTime() - s.start.getTime()) / 60000));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Display + export helpers
// ---------------------------------------------------------------------------

/** 450 -> "7:30", -15 -> "-0:15" (hours:minutes, locale-neutral). */
export function formatMinutes(min: number): string {
  const sign = min < 0 ? "-" : "";
  const abs = Math.abs(Math.round(min));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

/** Decimal hours rounded to 2 places (for payroll exports). */
export function minutesToHours(min: number): number {
  return Math.round((min / 60) * 100) / 100;
}

/** RFC 4180 CSV; cells starting with = + - @ are prefixed to stop formula injection. */
export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  const cell = (v: string | number | boolean | null | undefined) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Geofence (the position is used in memory only; never stored)
// ---------------------------------------------------------------------------

export type GeoStatus = "not_checked" | "ok" | "too_far" | "unavailable";

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distance flag for a clock-in. `position` is null when the employee did not
 * consent / the device gave none. Accuracy is added to the radius so a weak
 * GPS fix inside the hall is not reported as too far.
 */
export function geoStatusFor(
  position: { lat: number; lng: number; accuracy?: number | null } | null,
  venue: { latitude: number | null; longitude: number | null; radiusM: number } | null,
): GeoStatus {
  if (!position) return "not_checked";
  if (!venue || venue.latitude === null || venue.longitude === null) return "unavailable";
  if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return "unavailable";
  const slack = Math.min(Math.max(position.accuracy ?? 0, 0), 500);
  return haversineMeters(position, { lat: venue.latitude, lng: venue.longitude }) <= venue.radiusM + slack ? "ok" : "too_far";
}
