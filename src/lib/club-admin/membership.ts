/**
 * Club membership — pure date and price rules, shared by the server actions,
 * the pages and the unit tests. Mirrors public.membership_period() and
 * membership_create() in migration 20250420101500_club_admin.sql.
 *
 * Dates are ISO calendar days ("YYYY-MM-DD", the club's local day); no time
 * zone maths happens here.
 */
export type MembershipPeriodKind = "season" | "calendar_year";
export type MembershipStatus = "pending_payment" | "active" | "expired" | "cancelled";
export const MEMBERSHIP_KINDS = ["player", "family", "supporter", "honorary", "other"] as const;
export const MEMBERSHIP_SCOPES = ["person", "family"] as const;
export const MEMBERSHIP_STATUSES: MembershipStatus[] = ["pending_payment", "active", "expired", "cancelled"];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function parts(day: string): [number, number, number] {
  if (!ISO.test(day)) throw new Error(`invalid day: ${day}`);
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
}

/** Calendar-day arithmetic in UTC (no DST effects). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = parts(day);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/**
 * The membership period that contains `day`.
 *   calendar_year: 1 Jan – 31 Dec
 *   season:        day 1 of `startMonth` – the day before the next one
 */
export function membershipPeriod(kind: MembershipPeriodKind, startMonth: number, day: string): { start: string; end: string } {
  const [y, m] = parts(day);
  let start: string;
  if (kind === "calendar_year") start = iso(y, 1, 1);
  else {
    const sm = Math.min(12, Math.max(1, Math.trunc(startMonth || 8)));
    start = iso(m < sm ? y - 1 : y, sm, 1);
  }
  const [sy, smo] = parts(start);
  return { start, end: addDays(iso(sy + 1, smo, 1), -1) };
}

/** Validity of a new membership joined on `joinDay`: from the join day to the end of its period. */
export function joinValidity(kind: MembershipPeriodKind, startMonth: number, joinDay: string): { from: string; until: string } {
  return { from: joinDay, until: membershipPeriod(kind, startMonth, joinDay).end };
}

/**
 * Validity of a renewal: starts the day after the previous membership ends
 * (or at the start of the current period when it lapsed long ago).
 */
export function renewalValidity(
  kind: MembershipPeriodKind,
  startMonth: number,
  previousUntil: string,
  today: string,
): { from: string; until: string } {
  const next = addDays(previousUntil, 1);
  const current = membershipPeriod(kind, startMonth, today).start;
  const from = next > current ? next : current;
  return { from, until: membershipPeriod(kind, startMonth, from).end };
}

/** Effective status on a day (the stored status may lag until the daily job runs). */
export function effectiveStatus(m: { status: MembershipStatus; valid_from: string; valid_until: string }, today: string): MembershipStatus {
  if (m.status === "active" && m.valid_until < today) return "expired";
  return m.status;
}

/** Member on `day`: an active membership covering the day. */
export function coversDay(m: { status: MembershipStatus; valid_from: string; valid_until: string }, day: string): boolean {
  return m.status === "active" && m.valid_from <= day && day <= m.valid_until;
}

export function isMemberOn(memberships: { status: MembershipStatus; valid_from: string; valid_until: string }[], day: string): boolean {
  return memberships.some((m) => coversDay(m, day));
}

/** Active memberships ending within `windowDays` of today that were not renewed yet. */
export function isExpiringSoon(
  m: { status: MembershipStatus; valid_until: string; renewed?: boolean },
  today: string,
  windowDays: number,
): boolean {
  if (m.renewed || (m.status !== "active" && m.status !== "expired")) return false;
  const left = daysBetween(today, m.valid_until);
  return left >= -windowDays && left <= windowDays;
}

/** Age in whole years on a day. */
export function ageOn(dob: string, day: string): number {
  const [by, bm, bd] = parts(dob);
  const [y, m, d] = parts(day);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export function fitsAgeRule(dob: string | null, day: string, min: number | null, max: number | null): boolean {
  if (!dob) return min == null && max == null;
  const a = ageOn(dob, day);
  return (min == null || a >= min) && (max == null || a <= max);
}

/**
 * Member vs non-member price hook: the price a family pays for an item that
 * has an optional member price.
 */
export function memberUnitPrice(listPrice: number, memberPrice: number | null | undefined, isMember: boolean): number {
  if (!isMember || memberPrice == null || !(memberPrice >= 0) || memberPrice >= listPrice) return listPrice;
  return memberPrice;
}
