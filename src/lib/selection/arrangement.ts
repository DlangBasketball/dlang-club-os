import { monthDay, parseDate } from "../payments/plans";
import { fromMinorUnits, toMinorUnits } from "../payments/currency";

/**
 * Selection roster: fee arrangements, payment status and roster filters
 * (pure; shared by pages, client forms, server actions and tests).
 *
 * Mirrors migration 20250420102900_selection_roster.sql:
 *   arrangementSchedule  <-> public.selection_arrangement_schedule
 *   moneySummary         <-> public.selection_invoice_summary
 *   divisionFits         <-> public.selection_division_fits
 * Relative imports only (the payments test runner loads files directly).
 */

export const ARRANGEMENT_KINDS = ["full", "monthly"] as const;
export type ArrangementKind = (typeof ARRANGEMENT_KINDS)[number];
export const MAX_ARRANGEMENT_INSTALMENTS = 24;

export type ScheduleRow = { seq: number; dueOn: string; amount: number };

/**
 * Pay in full: one amount on the first due date. Monthly: instalments of
 * `monthly` from `firstDueOn` (same day each month, clamped to month ends),
 * the last one smaller when the total is not a multiple.
 * Throws an error code (INVALID_AMOUNT, INVALID_MONTHLY_AMOUNT,
 * TOO_MANY_INSTALLMENTS, INVALID_DATE) like the SQL function.
 */
export function arrangementSchedule(total: number, kind: ArrangementKind, monthly: number | null, firstDueOn: string, currency = "CHF"): ScheduleRow[] {
  let first: { y: number; m: number; d: number };
  try { first = parseDate(firstDueOn); } catch { throw new Error("INVALID_DATE"); }
  if (!Number.isFinite(total) || total <= 0) throw new Error("INVALID_AMOUNT");
  const totalMinor = toMinorUnits(total, currency);
  if (kind === "full") return [{ seq: 1, dueOn: firstDueOn, amount: fromMinorUnits(totalMinor, currency) }];
  if (monthly == null || !Number.isFinite(monthly) || monthly <= 0) throw new Error("INVALID_MONTHLY_AMOUNT");
  const m = toMinorUnits(monthly, currency);
  if (m <= 0) throw new Error("INVALID_MONTHLY_AMOUNT");
  const n = Math.ceil(totalMinor / m);
  if (n > MAX_ARRANGEMENT_INSTALMENTS) throw new Error("TOO_MANY_INSTALLMENTS");
  return Array.from({ length: n }, (_, k) => ({
    seq: k + 1,
    dueOn: monthDay(first.y, first.m, k, first.d),
    amount: fromMinorUnits(k < n - 1 ? m : totalMinor - m * (n - 1), currency),
  }));
}

/** Schedule or the error code (for live previews). */
export function tryArrangementSchedule(total: number, kind: ArrangementKind, monthly: number | null, firstDueOn: string, currency = "CHF"):
  { ok: true; rows: ScheduleRow[] } | { ok: false; code: string } {
  try {
    return { ok: true, rows: arrangementSchedule(total, kind, monthly, firstDueOn, currency) };
  } catch (e) {
    return { ok: false, code: e instanceof Error ? e.message : "INVALID_AMOUNT" };
  }
}

export const PAYMENT_STATUSES = ["none", "unpaid", "partial", "paid"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type MoneySummary = {
  amountDue: number; received: number; balance: number; nextDueOn: string | null; overdueAmount: number; status: PaymentStatus;
};

/**
 * Money of one agreement, derived from saved charges and payments (never a
 * stored balance). `installments` are the active plan's rows (empty = no
 * plan: the invoice due date applies). Received money settles instalments
 * in order.
 */
export function moneySummary(input: {
  amountDue: number; received: number; installments: { dueOn: string; amount: number }[]; invoiceDueOn: string | null; today: string; cancelled?: boolean;
}): MoneySummary {
  if (input.cancelled) return { amountDue: 0, received: 0, balance: 0, nextDueOn: null, overdueAmount: 0, status: "none" };
  const cents = (n: number) => Math.round(n * 100);
  const due = cents(input.amountDue);
  const rcv = Math.max(cents(input.received), 0);
  const bal = Math.max(due - rcv, 0);
  let next: string | null = null;
  let overdue = 0;
  if (input.installments.length) {
    let cum = 0;
    let past = 0;
    for (const i of [...input.installments]) {
      cum += cents(i.amount);
      if (next === null && cum > rcv) next = i.dueOn;
      if (i.dueOn < input.today) past += cents(i.amount);
    }
    if (bal <= 0) next = null;
    overdue = Math.min(bal, Math.max(past - rcv, 0));
  } else {
    next = bal > 0 ? input.invoiceDueOn : null;
    overdue = bal > 0 && input.invoiceDueOn && input.invoiceDueOn < input.today ? bal : 0;
  }
  const status: PaymentStatus = bal <= 0 ? "paid" : rcv > 0 ? "partial" : "unpaid";
  return { amountDue: due / 100, received: rcv / 100, balance: bal / 100, nextDueOn: next, overdueAmount: overdue / 100, status };
}

// ---------------------------------------------------------------------------
// Divisions, labels, age groups
// ---------------------------------------------------------------------------
export type DivisionAgeRule = { minBirthYear: number | null; maxBirthYear: number | null; ageUnder: number | null; ageCutoff: string | null };

/** true / false; null = no age rule or no date of birth (staff confirm anything but true). */
export function divisionFits(d: DivisionAgeRule, dob: string | null | undefined, today: string): boolean | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  if (d.minBirthYear == null && d.maxBirthYear == null && d.ageUnder == null) return null;
  const y = Number(dob.slice(0, 4));
  if (d.minBirthYear != null && y < d.minBirthYear) return false;
  if (d.maxBirthYear != null && y > d.maxBirthYear) return false;
  if (d.ageUnder != null) {
    const ref = d.ageCutoff ?? today;
    const age = ageOn(dob, ref);
    if (age >= d.ageUnder) return false;
  }
  return true;
}

export function ageOn(dob: string, ref: string): number {
  const [by, bm, bd] = dob.split("-").map(Number);
  const [ry, rm, rd] = ref.split("-").map(Number);
  return ry - by - (rm < bm || (rm === bm && rd < bd) ? 1 : 0);
}

/**
 * The athlete's age group label: the licence category when it looks like
 * one ("U6", "U14"), else "U<n>" from the birth year and the season year
 * (age reached in the season's calendar year + 1, the usual U-category).
 */
export function athleteAgeGroup(dob: string | null | undefined, seasonYear: number | null | undefined, licenceCategory?: string | null): string | null {
  const cat = (licenceCategory ?? "").trim().toUpperCase();
  if (/^U\d{1,2}$/.test(cat)) return cat;
  if (!dob || !/^\d{4}/.test(dob) || !seasonYear) return null;
  const n = seasonYear - Number(dob.slice(0, 4)) + 1;
  return n > 0 && n < 40 ? `U${n}` : null;
}

/** Programme short name: the name without its season ("EYBL 2026-27" -> "EYBL"). */
export function programShortName(name: string): string {
  const s = name
    .replace(/\s*[(\[]?\b(19|20)\d{2}(\s*[-/–]\s*(19|20)?\d{2})?\b[)\]]?\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return s || name.trim();
}

/** "EYBL U14": programme short name + division name (division name alone when it already starts with it). */
export function programDivisionLabel(programName: string, divisionName: string | null | undefined): string {
  const short = programShortName(programName);
  if (!divisionName) return short;
  return divisionName.toLowerCase().startsWith(short.toLowerCase()) ? divisionName : `${short} ${divisionName}`;
}

/** Series key of a programme: explicit series, else the slug / name without its season. */
export function seriesKey(p: { series?: string | null; slug?: string | null; name: string }): string {
  if (p.series && p.series.trim()) return p.series.trim().toLowerCase();
  const base = (p.slug && p.slug.trim()) || p.name;
  return programShortName(base.replace(/[-_]+/g, " ")).toLowerCase().replace(/\s+/g, "-");
}

/** Default package for a number of selected tournaments (same tournament count), else null. */
export function packageForTournamentCount<T extends { tournamentCount: number | null; isActive?: boolean }>(packages: readonly T[], count: number): T | null {
  return packages.find((p) => p.isActive !== false && p.tournamentCount === count) ?? null;
}

// ---------------------------------------------------------------------------
// Roster filters (URL-driven)
// ---------------------------------------------------------------------------
export const ROSTER_STATUS_FILTERS = ["active", "all", "accepted", "enrolled", "waitlisted", "withdrawn"] as const;
export type RosterStatusFilter = (typeof ROSTER_STATUS_FILTERS)[number];
export const ROSTER_PAYMENT_FILTERS = ["all", "open", "unpaid", "partial", "paid", "sponsored", "none"] as const;
export type RosterPaymentFilter = (typeof ROSTER_PAYMENT_FILTERS)[number];

export type RosterFilters = {
  division: string; tournament: string; status: RosterStatusFilter; payment: RosterPaymentFilter; overdue: boolean; q: string;
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseRosterFilters(sp: Params): RosterFilters {
  const status = one(sp.status) as RosterStatusFilter;
  const payment = one(sp.payment) as RosterPaymentFilter;
  const uuidOr = (v: string) => (/^[0-9a-f-]{36}$/i.test(v) || v === "none" ? v : "");
  return {
    division: uuidOr(one(sp.division)),
    tournament: uuidOr(one(sp.tournament)),
    status: (ROSTER_STATUS_FILTERS as readonly string[]).includes(status) ? status : "active",
    payment: (ROSTER_PAYMENT_FILTERS as readonly string[]).includes(payment) ? payment : "all",
    overdue: one(sp.overdue) === "1",
    q: one(sp.q).trim().slice(0, 80),
  };
}

export function rosterFiltersActive(f: RosterFilters): boolean {
  return !!(f.division || f.tournament || f.status !== "active" || f.payment !== "all" || f.overdue || f.q);
}

export type RosterFilterable = {
  name: string; divisionId: string | null; status: string; paymentStatus: PaymentStatus | null; overdue: boolean | null;
  tournaments: { id: string; status: string }[]; sponsored?: number | null;
};

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function filterRoster<T extends RosterFilterable>(rows: readonly T[], f: RosterFilters): T[] {
  const q = fold(f.q);
  return rows.filter((r) => {
    if (f.status === "active" && !(r.status === "accepted" || r.status === "enrolled")) return false;
    if (f.status !== "active" && f.status !== "all" && r.status !== f.status) return false;
    if (f.division === "none" ? r.divisionId !== null : f.division && r.divisionId !== f.division) return false;
    if (f.tournament === "none" ? r.tournaments.some((t) => t.status === "covered") : f.tournament && !r.tournaments.some((t) => t.id === f.tournament)) return false;
    if (f.payment === "open") { if (r.paymentStatus !== "unpaid" && r.paymentStatus !== "partial") return false; }
    else if (f.payment === "sponsored") { if (!(r.sponsored && r.sponsored > 0)) return false; }
    else if (f.payment !== "all" && r.paymentStatus !== f.payment) return false;
    if (f.overdue && !r.overdue) return false;
    if (q && !fold(r.name).includes(q)) return false;
    return true;
  });
}
