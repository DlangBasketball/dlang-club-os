/**
 * Club membership payments report — pure, client-safe types and helpers.
 *
 * Every number comes from public.club_membership_month_report() /
 * club_membership_season_overview() (migration
 * 20250420103700_finance_reports.sql); the screen and the Excel workbook both
 * read those rows, so they always agree. This module only maps rows, sums
 * totals per currency (in minor units, no float drift) and parses filters.
 * Calculation rules: docs/finance-reports.md.
 */

export const MEMBERSHIP_REPORT_STATUSES = ["paid", "partially_paid", "unpaid", "no_installment", "overdue", "sponsored"] as const;
export type MembershipReportStatus = (typeof MEMBERSHIP_REPORT_STATUSES)[number];
export const isMembershipReportStatus = (v: unknown): v is MembershipReportStatus =>
  typeof v === "string" && (MEMBERSHIP_REPORT_STATUSES as readonly string[]).includes(v);

export type MembershipReportRow = {
  membershipId: string;
  athleteId: string;
  athleteName: string;
  familyId: string;
  familyName: string | null;
  teamNames: string | null;
  payerNames: string | null;
  invoiceNumbers: string | null;
  currency: string;
  agreedFee: number;
  sponsored: boolean;
  /** Scheduled instalments (after credit notes) with a due date in the month. */
  dueInMonth: number;
  /** Cash received in the month (payments by paid_at, any instalment; net of reversals / refunds). */
  receivedInMonth: number;
  /** Payments allocated FIFO (by instalment order) to the month's charges, as of month end. */
  appliedToMonth: number;
  /** dueInMonth - appliedToMonth. */
  openForMonth: number;
  /** Open charges past due at month end (today for the current month). */
  overdueAmount: number;
  /** Open charges due before the month (arrears). */
  arrearsBeforeMonth: number;
  paidToDate: number;
  seasonInvoiced: number;
  seasonBalance: number;
  carryForwardDue: number;
  carryForwardReceivedInMonth: number;
  carryForwardPaid: number;
  carryForwardOpen: number;
  status: MembershipReportStatus;
};

/** Raw row of club_membership_month_report (numeric columns arrive as numbers or strings). */
export type MembershipReportDbRow = {
  membership_id: string; athlete_id: string; athlete_name: string; family_id: string; family_name: string | null;
  team_names: string | null; payer_names: string | null; invoice_numbers: string | null; currency: string;
  agreed_fee: number | string; sponsored: boolean; due_in_month: number | string; received_in_month: number | string;
  applied_to_month: number | string; open_for_month: number | string; overdue_amount: number | string;
  arrears_before_month: number | string; paid_to_date: number | string; season_invoiced: number | string;
  season_balance: number | string; carry_forward_due: number | string; carry_forward_received_in_month: number | string;
  carry_forward_paid: number | string; carry_forward_open: number | string; report_status: string;
};

export type SeasonOverviewDbRow = {
  membership_id: string; month: string; due_in_month: number | string; received_in_month: number | string;
  applied_to_month: number | string; open_for_month: number | string; overdue_amount: number | string;
  paid_to_date: number | string; season_balance: number | string; report_status: string;
};

export type SeasonOverviewCell = {
  /** YYYY-MM */
  month: string;
  due: number;
  received: number;
  applied: number;
  open: number;
  status: MembershipReportStatus;
};
export type SeasonOverviewRow = {
  membershipId: string;
  months: SeasonOverviewCell[];
  /** As of the last month of the season (or today while it runs). */
  paidToDate: number;
  seasonBalance: number;
};

const n = (v: number | string | null | undefined) => (v == null ? 0 : Number(v));

export function toMembershipReportRow(r: MembershipReportDbRow): MembershipReportRow {
  return {
    membershipId: r.membership_id, athleteId: r.athlete_id, athleteName: r.athlete_name, familyId: r.family_id,
    familyName: r.family_name, teamNames: r.team_names, payerNames: r.payer_names, invoiceNumbers: r.invoice_numbers,
    currency: (r.currency ?? "").toUpperCase(), agreedFee: n(r.agreed_fee), sponsored: Boolean(r.sponsored),
    dueInMonth: n(r.due_in_month), receivedInMonth: n(r.received_in_month), appliedToMonth: n(r.applied_to_month),
    openForMonth: n(r.open_for_month), overdueAmount: n(r.overdue_amount), arrearsBeforeMonth: n(r.arrears_before_month),
    paidToDate: n(r.paid_to_date), seasonInvoiced: n(r.season_invoiced), seasonBalance: n(r.season_balance),
    carryForwardDue: n(r.carry_forward_due), carryForwardReceivedInMonth: n(r.carry_forward_received_in_month),
    carryForwardPaid: n(r.carry_forward_paid), carryForwardOpen: n(r.carry_forward_open),
    status: isMembershipReportStatus(r.report_status) ? r.report_status : "unpaid",
  };
}

/** Group the overview rows (one per member and month) by member, months in order. */
export function toSeasonOverview(rows: SeasonOverviewDbRow[]): SeasonOverviewRow[] {
  const by = new Map<string, SeasonOverviewDbRow[]>();
  for (const r of rows) {
    const list = by.get(r.membership_id) ?? [];
    list.push(r);
    by.set(r.membership_id, list);
  }
  return Array.from(by.entries()).map(([membershipId, list]) => {
    const sorted = [...list].sort((a, b) => a.month.localeCompare(b.month));
    const last = sorted[sorted.length - 1];
    return {
      membershipId,
      months: sorted.map((r) => ({
        month: r.month.slice(0, 7), due: n(r.due_in_month), received: n(r.received_in_month), applied: n(r.applied_to_month),
        open: n(r.open_for_month), status: isMembershipReportStatus(r.report_status) ? r.report_status : "unpaid",
      })),
      paidToDate: n(last?.paid_to_date), seasonBalance: n(last?.season_balance),
    };
  });
}

/** Numeric columns summed in the totals row. */
export const MEMBERSHIP_TOTAL_KEYS = [
  "agreedFee", "dueInMonth", "receivedInMonth", "appliedToMonth", "openForMonth", "overdueAmount", "paidToDate",
  "seasonBalance", "carryForwardDue", "carryForwardReceivedInMonth", "carryForwardOpen",
] as const;
export type MembershipTotalKey = (typeof MEMBERSHIP_TOTAL_KEYS)[number];
export type MembershipTotals = { currency: string; members: number } & Record<MembershipTotalKey, number>;

/** Minor units of a currency (CHF/EUR/USD 2, JPY 0, …). */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Exact sum of money values in a currency (rounded through minor units). */
export function sumMinor(values: number[], currency: string): number {
  const scale = 10 ** currencyDigits(currency);
  return values.reduce((acc, v) => acc + Math.round(v * scale), 0) / scale;
}

/**
 * One totals row per currency. A member counts once (one row per membership,
 * even when the player is on several teams).
 */
export function membershipTotals(rows: MembershipReportRow[]): MembershipTotals[] {
  const currencies = Array.from(new Set(rows.map((r) => r.currency))).sort();
  return currencies.map((currency) => {
    const list = rows.filter((r) => r.currency === currency);
    const out = { currency, members: list.length } as MembershipTotals;
    for (const k of MEMBERSHIP_TOTAL_KEYS) out[k] = sumMinor(list.map((r) => r[k]), currency);
    return out;
  });
}

export type StatusCounts = Record<MembershipReportStatus, number>;
export function statusCounts(rows: MembershipReportRow[]): StatusCounts {
  const out = Object.fromEntries(MEMBERSHIP_REPORT_STATUSES.map((s) => [s, 0])) as StatusCounts;
  for (const r of rows) out[r.status] += 1;
  return out;
}

// ---------------------------------------------------------------------------
// Season months and filters
// ---------------------------------------------------------------------------
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Months (YYYY-MM) from the season's first month to the month of its end date, e.g. Aug..Jul. */
export function seasonMonths(startsOn: string, endsOn: string): string[] {
  const out: string[] = [];
  let y = Number(startsOn.slice(0, 4));
  let m = Number(startsOn.slice(5, 7));
  const end = endsOn.slice(0, 7);
  for (let i = 0; i < 36; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > end) break;
    out.push(key);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export type SeasonLite = { id: string; name: string; startsOn: string; endsOn: string; isCurrent: boolean };
export type MembershipReportFilters = { seasonId: string | null; month: string | null; teamId: string | null; status: MembershipReportStatus | null };

type Query = Record<string, string | string[] | undefined | null>;
const one = (q: Query, k: string) => {
  const v = q[k];
  return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
};

/**
 * Filters from the query string: season (default the current one, else the
 * latest), month inside the season (default the current month when inside the
 * season, else the season's first month), team, status. Pure.
 */
export function resolveMembershipFilters(q: Query, seasons: SeasonLite[], todayMonth: string): MembershipReportFilters {
  const wanted = one(q, "season");
  const season = seasons.find((s) => s.id === wanted) ?? seasons.find((s) => s.isCurrent)
    ?? [...seasons].sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0] ?? null;
  if (!season) return { seasonId: null, month: null, teamId: null, status: null };
  const months = seasonMonths(season.startsOn, season.endsOn);
  const m = one(q, "month");
  const month = MONTH_RE.test(m) && months.includes(m) ? m : months.includes(todayMonth) ? todayMonth : (months[0] ?? null);
  const team = one(q, "team");
  const status = one(q, "status");
  return { seasonId: season.id, month, teamId: UUID_RE.test(team) ? team : null, status: isMembershipReportStatus(status) ? status : null };
}

export function membershipReportQuery(f: MembershipReportFilters): string {
  const p = new URLSearchParams();
  if (f.seasonId) p.set("season", f.seasonId);
  if (f.month) p.set("month", f.month);
  if (f.teamId) p.set("team", f.teamId);
  if (f.status) p.set("status", f.status);
  return p.toString();
}

/** Safe file-name fragment ("Saison 2026-27" -> "Saison-2026-27"). */
export function fileSlug(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "report";
}
