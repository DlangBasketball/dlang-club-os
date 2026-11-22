/**
 * Club season instalments and payer shares — pure and client-safe.
 *
 * Mirrors the SQL in supabase/migrations/20250420103500_billing_foundation.sql:
 *   club_installment_schedule(total, count, first_due_month, due_day, season_end, currency)
 *   club_season_months_without_installment(first_due_month, count, season_start, season_end)
 *   membership_plan_internal (payer shares)
 *   club_season_bounds(on, start_month)
 * tests/unit/membership-schedule.test.ts runs the SAME fixtures as
 * tests/db/billing_foundation.sql (tests/unit/fixtures/club-installment-schedule.json).
 *
 * Amounts are computed in minor units (centimes): an even split, then the
 * remainder is given one minor unit at a time to the FIRST instalments
 * (1000.00 / 11 -> 10 x 90.91 + 1 x 90.90). Dates are calendar dates
 * (YYYY-MM-DD strings), never Date objects, so time zones cannot shift them.
 */
import { currencyExponent, fromMinorUnits, toMinorUnits } from "@/lib/payments/currency";

export type ScheduleErrorCode =
  | "INVALID_INSTALLMENT_COUNT"
  | "INVALID_AMOUNT"
  | "INVALID_DUE_DAY"
  | "INVALID_FIRST_DUE_MONTH"
  | "SCHEDULE_AFTER_SEASON_END";

export type Installment = { seq: number; dueOn: string; amount: number };
export type ScheduleResult = { ok: true; installments: Installment[] } | { ok: false; code: ScheduleErrorCode };

export const MAX_INSTALLMENTS = 24;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIso(d: string): { y: number; m: number; day: number } | null {
  const match = ISO_DATE.exec(d ?? "");
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const day = Number(match[3]);
  if (m < 1 || m > 12 || day < 1 || day > daysInMonth(y, m)) return null;
  return { y, m, day };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const iso = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** Days in a month (m = 1..12). */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Month index arithmetic: (y, m) + n months. */
function addMonths(y: number, m: number, n: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + n;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** The due date in a month: due_day clamped to the month's last day. */
export function monthDueDate(y: number, m: number, dueDay: number): string {
  return iso(y, m, Math.min(dueDay, daysInMonth(y, m)));
}

/** First day of the month of an ISO date ("2026-08-15" -> "2026-08-01"). */
export function monthStart(date: string): string | null {
  const p = parseIso(date);
  return p ? iso(p.y, p.m, 1) : null;
}

/** Exact instalment schedule (see module comment). */
export function clubInstallmentSchedule(input: {
  total: number;
  count: number;
  firstDueMonth: string;
  dueDay: number;
  seasonEnd?: string | null;
  currency?: string;
}): ScheduleResult {
  const currency = input.currency ?? "CHF";
  const { count, dueDay } = input;
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) return { ok: false, code: "INVALID_INSTALLMENT_COUNT" };
  if (!Number.isFinite(input.total) || input.total < 0) return { ok: false, code: "INVALID_AMOUNT" };
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return { ok: false, code: "INVALID_DUE_DAY" };
  const first = parseIso(input.firstDueMonth);
  if (!first) return { ok: false, code: "INVALID_FIRST_DUE_MONTH" };

  const minor = toMinorUnits(input.total, currency);
  const base = Math.floor(minor / count);
  const rem = minor - base * count;

  const last = addMonths(first.y, first.m, count - 1);
  if (input.seasonEnd && monthDueDate(last.y, last.m, dueDay) > input.seasonEnd) {
    return { ok: false, code: "SCHEDULE_AFTER_SEASON_END" };
  }
  const installments: Installment[] = [];
  for (let k = 1; k <= count; k += 1) {
    const mm = addMonths(first.y, first.m, k - 1);
    installments.push({ seq: k, dueOn: monthDueDate(mm.y, mm.m, dueDay), amount: fromMinorUnits(base + (k <= rem ? 1 : 0), currency) });
  }
  return { ok: true, installments };
}

/** Season months (first day, YYYY-MM-01) that get no instalment. */
export function seasonMonthsWithoutInstallment(
  firstDueMonth: string,
  count: number,
  seasonStart: string | null | undefined,
  seasonEnd: string | null | undefined,
): string[] {
  const s = seasonStart ? parseIso(seasonStart) : null;
  const e = seasonEnd ? parseIso(seasonEnd) : null;
  const f = parseIso(firstDueMonth);
  if (!s || !e || !f || seasonEnd! < seasonStart!) return [];
  const fromIdx = f.y * 12 + (f.m - 1);
  const toIdx = fromIdx + Math.max(0, count);
  const out: string[] = [];
  for (let idx = s.y * 12 + (s.m - 1); idx <= e.y * 12 + (e.m - 1); idx += 1) {
    if (idx >= fromIdx && idx < toIdx) continue;
    out.push(iso(Math.floor(idx / 12), (idx % 12) + 1, 1));
  }
  return out;
}

/** Season containing a date for a club whose season starts in `startMonth` (8 = August). */
export function clubSeasonBounds(on: string, startMonth = 8): { startsOn: string; endsOn: string } | null {
  const p = parseIso(on);
  if (!p || !Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) return null;
  const y = p.m < startMonth ? p.y - 1 : p.y;
  const end = addMonths(y, startMonth, 11);
  return { startsOn: iso(y, startMonth, 1), endsOn: iso(end.y, end.m, daysInMonth(end.y, end.m)) };
}

/** Default first instalment month of a season: the configured month on or after the season start. */
export function defaultFirstDueMonth(seasonStartsOn: string, firstInstallmentMonth: number): string | null {
  const s = parseIso(seasonStartsOn);
  if (!s || firstInstallmentMonth < 1 || firstInstallmentMonth > 12) return null;
  const y = firstInstallmentMonth < s.m ? s.y + 1 : s.y;
  return iso(y, firstInstallmentMonth, 1);
}

// ---------------------------------------------------------------------------
// Payer shares
// ---------------------------------------------------------------------------
export type ShareKind = "fixed" | "percent";
export type ShareInput = { shareKind: ShareKind; shareValue: number };
export type SharesErrorCode = "INVALID_AMOUNT" | "INVALID_SHARE" | "SHARES_MISMATCH" | "PAYERS_REQUIRED" | "ZERO_SHARE" | "TOO_MANY_PAYERS";
export type SharesResult = { ok: true; amounts: number[] } | { ok: false; code: SharesErrorCode };
export const MAX_PAYERS = 10;

/**
 * Splits an agreed fee over payers: fixed amounts first; percent shares split
 * the rest and must total exactly 100; the LAST percent payer absorbs the
 * rounding. Without percent payers the fixed amounts must equal the fee. A
 * fee of 0 takes no payer (fully sponsored).
 */
export function membershipShares(fee: number, payers: ShareInput[], currency = "CHF"): SharesResult {
  if (!Number.isFinite(fee) || fee < 0 || fee > 1_000_000) return { ok: false, code: "INVALID_AMOUNT" };
  const exp = currencyExponent(currency);
  const feeMinor = toMinorUnits(Number(fee.toFixed(exp)), currency);
  if (feeMinor === 0 && payers.length > 0) return { ok: false, code: "SHARES_MISMATCH" };
  if (feeMinor > 0 && payers.length === 0) return { ok: false, code: "PAYERS_REQUIRED" };
  if (payers.length > MAX_PAYERS) return { ok: false, code: "TOO_MANY_PAYERS" };

  let fixed = 0;
  let pct = 0;
  let nPct = 0;
  for (const p of payers) {
    const v = p.shareValue;
    if ((p.shareKind !== "fixed" && p.shareKind !== "percent") || !Number.isFinite(v) || v <= 0 || (p.shareKind === "percent" && v > 100)) {
      return { ok: false, code: "INVALID_SHARE" };
    }
    if (p.shareKind === "fixed") fixed += toMinorUnits(v, currency);
    else {
      pct = Math.round((pct + v) * 1e6) / 1e6;
      nPct += 1;
    }
  }
  if (nPct === 0 && fixed !== feeMinor) return { ok: false, code: "SHARES_MISMATCH" };
  if (nPct > 0 && (pct !== 100 || fixed > feeMinor)) return { ok: false, code: "SHARES_MISMATCH" };
  const rest = feeMinor - fixed;

  const out: number[] = [];
  let acc = 0;
  let seen = 0;
  for (const p of payers) {
    let amt: number;
    if (p.shareKind === "fixed") amt = toMinorUnits(p.shareValue, currency);
    else {
      seen += 1;
      if (seen === nPct) amt = rest - acc;
      else {
        // SQL: round(rest * pct / 100) on numerics (half away from zero).
        amt = Math.round(Math.round(((rest * p.shareValue) / 100) * 1e6) / 1e6);
        acc += amt;
      }
    }
    if (amt <= 0) return { ok: false, code: "ZERO_SHARE" };
    out.push(fromMinorUnits(amt, currency));
  }
  return { ok: true, amounts: out };
}
