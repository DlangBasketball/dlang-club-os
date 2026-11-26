/**
 * Camp rules — pure helpers shared by the admin pages, the public / parent
 * registration and the server actions (unit-tested in tests/unit).
 */

export type EditionStatus = "draft" | "published" | "archived" | "cancelled";

export type EditionWindow = {
  status: EditionStatus;
  startsOn: string;
  endsOn: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
};

export type ScopedRow = { id: string; editionId: string | null; isActive?: boolean; sort: number };

function parseDay(d: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return Number.NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fmtDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Every calendar day of an edition, "YYYY-MM-DD", inclusive (max 63). */
export function editionDays(startsOn: string, endsOn: string): string[] {
  const a = parseDay(startsOn);
  const b = parseDay(endsOn);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return [];
  const out: string[] = [];
  for (let t = a; t <= b && out.length < 63; t += 864e5) out.push(fmtDay(t));
  return out;
}

/** Age in whole years on a given day (both "YYYY-MM-DD"). */
export function ageOn(dob: string, on: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  const o = /^(\d{4})-(\d{2})-(\d{2})/.exec(on);
  if (!d || !o) return null;
  let age = Number(o[1]) - Number(d[1]);
  if (Number(o[2]) < Number(d[2]) || (Number(o[2]) === Number(d[2]) && Number(o[3]) < Number(d[3]))) age -= 1;
  return age;
}

export function ageFits(age: number | null, min: number | null, max: number | null): boolean {
  if (age === null) return false;
  return (min === null || age >= min) && (max === null || age <= max);
}

/** Mirrors register_camp: published, inside the window; without a close date it closes after the first day. */
export function isRegistrationOpen(e: EditionWindow, now: Date = new Date()): boolean {
  if (e.status !== "published") return false;
  const t = now.getTime();
  if (e.registrationOpensAt && t < Date.parse(e.registrationOpensAt)) return false;
  if (e.registrationClosesAt) return t < Date.parse(e.registrationClosesAt);
  const today = now.toISOString().slice(0, 10);
  return today <= e.startsOn;
}

/**
 * Rows for one edition: the edition's own rows when it has any (override),
 * otherwise the camp-wide rows (edition_id null). Inactive rows are dropped.
 */
export function rowsForEdition<T extends ScopedRow>(rows: T[], editionId: string): T[] {
  const active = rows.filter((r) => r.isActive !== false);
  const own = active.filter((r) => r.editionId === editionId);
  const list = own.length ? own : active.filter((r) => r.editionId === null);
  return [...list].sort((a, b) => a.sort - b.sort);
}

export function spotsLeft(capacity: number | null, taken: number): number | null {
  if (capacity === null) return null;
  return Math.max(0, capacity - taken);
}

/** Validates a day choice: exactly `count` distinct days of the edition. */
export function validDaySelection(days: string[], count: number, startsOn: string, endsOn: string): boolean {
  const all = new Set(editionDays(startsOn, endsOn));
  const uniq = new Set(days);
  return uniq.size === days.length && days.length === count && days.every((d) => all.has(d));
}

/** Pre-selects days when the option covers the whole edition (or nothing to choose). */
export function defaultDays(count: number, startsOn: string, endsOn: string): string[] {
  const all = editionDays(startsOn, endsOn);
  return count >= all.length ? all : [];
}

/** The Friday before a Monday start (or simply 3 days before), end of that day. */
export function fridayBefore(startsOn: string): string {
  const t = parseDay(startsOn);
  if (Number.isNaN(t)) return startsOn;
  const dow = new Date(t).getUTCDay(); // 0 Sun … 6 Sat
  const back = ((dow - 5 + 7) % 7) || 7;
  return fmtDay(t - back * 864e5);
}

/** CSV cell, RFC 4180 quoting; neutralises spreadsheet formulas. */
export function csvCell(v: string | number | boolean | null | undefined): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
