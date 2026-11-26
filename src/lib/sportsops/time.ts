/**
 * Timezone-aware date helpers for the schedule.
 *
 * Events are stored as timestamptz; the club calendar is shown in the club's
 * timezone. Until the tenancy module exposes a per-org timezone, it comes from
 * NEXT_PUBLIC_DEFAULT_TIMEZONE (falls back to Europe/Zurich, the founding club).
 * TODO(tenancy): read the organization's timezone instead.
 */
export const CLUB_TZ = process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || "Europe/Zurich";
const LOCALE = "de-CH";

/** "YYYY-MM-DD" of an instant, in the club timezone. */
export function dayKey(d: string | Date, tz = CLUB_TZ): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isDayKey(s: string | undefined | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** Add days to a "YYYY-MM-DD" key (pure calendar arithmetic). */
export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `key`. */
export function weekStart(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(key, -dow);
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Generous UTC bounds for querying a range of club-local days (±1 day pad). */
export function rangeBounds(fromKey: string, toKeyInclusive: string) {
  return {
    from: new Date(`${addDays(fromKey, -1)}T00:00:00Z`).toISOString(),
    to: new Date(`${addDays(toKeyInclusive, 2)}T00:00:00Z`).toISOString(),
  };
}

export function fmtTime(d: string | Date, tz = CLUB_TZ) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(typeof d === "string" ? new Date(d) : d);
}

export function fmtDay(d: string | Date, tz = CLUB_TZ) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(typeof d === "string" ? new Date(d) : d);
}

/** Label a "YYYY-MM-DD" key without timezone drift. */
export function fmtDayKey(key: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${key}T12:00:00Z`));
}

/** Club-local "YYYY-MM-DD" and "HH:MM" for prefilling date/time inputs. */
export function localParts(iso: string, tz = CLUB_TZ) {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  return { date: dayKey(iso, tz), time };
}

export function fmtRange(start: string, end: string, tz = CLUB_TZ) {
  return `${fmtDay(start, tz)} · ${fmtTime(start, tz)}–${fmtTime(end, tz)}`;
}
