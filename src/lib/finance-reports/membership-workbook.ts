import ExcelJS from "exceljs";
import {
  currencyDigits, membershipTotals, type MembershipReportRow, type MembershipReportStatus, type MembershipTotalKey,
  type SeasonOverviewRow, sumMinor,
} from "./membership-report";

/**
 * Excel workbook of the club membership payments report (pure: rows in,
 * workbook out). Sheet 1 "Monthly Report" = the month report rows + totals
 * per currency; sheet 2 "Season Overview" = one row per member with expected
 * and received per month of the season. Every number is copied from the rows
 * of public.club_membership_month_report / club_membership_season_overview,
 * so the file matches the screen. All labels are passed in (translated by the
 * caller); amounts are numbers with the currency's decimals.
 */

export const MONTHLY_COLUMNS = [
  "player", "teams", "payers", "invoices", "currency", "agreedFee", "dueInMonth", "receivedInMonth", "appliedToMonth",
  "openForMonth", "overdueAmount", "paidToDate", "seasonBalance", "carryForwardDue", "carryForwardReceivedInMonth",
  "carryForwardOpen", "status",
] as const;
export type MonthlyColumn = (typeof MONTHLY_COLUMNS)[number];

const MONEY_COLUMNS: Partial<Record<MonthlyColumn, MembershipTotalKey>> = {
  agreedFee: "agreedFee", dueInMonth: "dueInMonth", receivedInMonth: "receivedInMonth", appliedToMonth: "appliedToMonth",
  openForMonth: "openForMonth", overdueAmount: "overdueAmount", paidToDate: "paidToDate", seasonBalance: "seasonBalance",
  carryForwardDue: "carryForwardDue", carryForwardReceivedInMonth: "carryForwardReceivedInMonth", carryForwardOpen: "carryForwardOpen",
};

export type MembershipWorkbookLabels = {
  monthlySheet: string;
  overviewSheet: string;
  /** First line of each sheet (club, season, month). */
  title: string;
  columns: Record<MonthlyColumn, string>;
  status: Record<MembershipReportStatus, string>;
  /** "Total CHF" */
  total: (currency: string) => string;
  /** "Aug 2026" */
  monthLabel: (month: string) => string;
  expected: string;
  received: string;
  totalPaid: string;
  remainingBalance: string;
  /** Marker of a month without a scheduled instalment (e.g. "—"). */
  noInstallmentMark: string;
  legendNoInstallment: string;
  legendMissed: string;
};

export type MembershipWorkbookInput = {
  labels: MembershipWorkbookLabels;
  rows: MembershipReportRow[];
  overview: SeasonOverviewRow[];
  /** Season months, YYYY-MM, in order (Aug..Jul). */
  months: string[];
  /** Today (YYYY-MM-DD, club time zone): an open instalment of a month that has ended is "missed". */
  today: string;
};

/** Excel fills (ARGB). Spreadsheet styling only; the app UI uses theme tokens. */
export const FILL_NO_INSTALLMENT = "FFE5E5E5";
export const FILL_MISSED = "FFF4C7C3";
const FILL_HEADER = "FFF2F2F2";

const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

export function moneyFormat(currency: string): string {
  const d = currencyDigits(currency);
  return d > 0 ? `#,##0.${"0".repeat(d)}` : "#,##0";
}

/** Last day of a YYYY-MM month. */
function monthEnd(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export type OverviewCellState = "no_installment" | "paid" | "open" | "missed";

/** How a month cell of the season overview is shown. */
export function overviewCellState(cell: { month: string; due: number; open: number }, today: string): OverviewCellState {
  if (cell.due <= 0) return "no_installment";
  if (cell.open <= 0) return "paid";
  return monthEnd(cell.month) < today ? "missed" : "open";
}

export function buildMembershipWorkbook(input: MembershipWorkbookInput): ExcelJS.Workbook {
  const { labels: L, rows, overview, months, today } = input;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date(`${today}T00:00:00Z`);

  // ---- Sheet 1: Monthly Report ------------------------------------------------
  const ws = wb.addWorksheet(L.monthlySheet, { views: [{ state: "frozen", ySplit: 2 }] });
  ws.addRow([L.title]).font = { bold: true, size: 13 };
  const header = ws.addRow(MONTHLY_COLUMNS.map((c) => L.columns[c]));
  header.font = { bold: true };
  header.eachCell((c) => { c.fill = fill(FILL_HEADER); });
  for (const r of rows) {
    const values = MONTHLY_COLUMNS.map((c): string | number => {
      const k = MONEY_COLUMNS[c];
      if (k) return r[k];
      switch (c) {
        case "player": return r.athleteName;
        case "teams": return r.teamNames ?? "";
        case "payers": return r.payerNames ?? "";
        case "invoices": return r.invoiceNumbers ?? "";
        case "currency": return r.currency;
        case "status": return L.status[r.status];
        default: return "";
      }
    });
    const row = ws.addRow(values);
    MONTHLY_COLUMNS.forEach((c, i) => { if (MONEY_COLUMNS[c]) row.getCell(i + 1).numFmt = moneyFormat(r.currency); });
  }
  for (const tot of membershipTotals(rows)) {
    const values = MONTHLY_COLUMNS.map((c): string | number => {
      const k = MONEY_COLUMNS[c];
      if (k) return tot[k];
      if (c === "player") return L.total(tot.currency);
      if (c === "currency") return tot.currency;
      return "";
    });
    const row = ws.addRow(values);
    row.font = { bold: true };
    MONTHLY_COLUMNS.forEach((c, i) => { if (MONEY_COLUMNS[c]) row.getCell(i + 1).numFmt = moneyFormat(tot.currency); });
  }
  ws.columns.forEach((col, i) => { col.width = i < 4 ? 26 : 16; });

  // ---- Sheet 2: Season Overview --------------------------------------------------
  const ov = wb.addWorksheet(L.overviewSheet, { views: [{ state: "frozen", xSplit: 1, ySplit: 2 }] });
  ov.addRow([L.title]).font = { bold: true, size: 13 };
  const head = [L.columns.player, L.columns.teams, L.columns.payers, L.columns.currency, L.columns.agreedFee];
  for (const m of months) head.push(`${L.monthLabel(m)} · ${L.expected}`, `${L.monthLabel(m)} · ${L.received}`);
  head.push(L.totalPaid, L.remainingBalance, L.columns.status);
  const h2 = ov.addRow(head);
  h2.font = { bold: true };
  h2.eachCell((c) => { c.fill = fill(FILL_HEADER); });

  const byMember = new Map(overview.map((o) => [o.membershipId, o]));
  const fixed = 5;
  const sums = new Map<string, { agreed: number[]; due: number[][]; received: number[][]; paid: number[]; balance: number[] }>();
  for (const r of rows) {
    const o = byMember.get(r.membershipId);
    const cells = months.map((m) => o?.months.find((x) => x.month === m) ?? { month: m, due: 0, received: 0, applied: 0, open: 0, status: "no_installment" as const });
    const values: (string | number)[] = [r.athleteName, r.teamNames ?? "", r.payerNames ?? "", r.currency, r.agreedFee];
    for (const c of cells) values.push(c.due > 0 ? c.due : L.noInstallmentMark, c.received);
    values.push(o?.paidToDate ?? r.paidToDate, o?.seasonBalance ?? r.seasonBalance, L.status[r.status]);
    const row = ov.addRow(values);
    const fmt = moneyFormat(r.currency);
    row.getCell(5).numFmt = fmt;
    cells.forEach((c, i) => {
      const exp = row.getCell(fixed + 1 + i * 2);
      const rec = row.getCell(fixed + 2 + i * 2);
      rec.numFmt = fmt;
      const state = overviewCellState(c, today);
      if (state === "no_installment") {
        exp.fill = fill(FILL_NO_INSTALLMENT);
        exp.alignment = { horizontal: "center" };
      } else {
        exp.numFmt = fmt;
        if (state === "missed") { exp.fill = fill(FILL_MISSED); rec.fill = fill(FILL_MISSED); }
      }
    });
    row.getCell(fixed + months.length * 2 + 1).numFmt = fmt;
    row.getCell(fixed + months.length * 2 + 2).numFmt = fmt;

    const s = sums.get(r.currency) ?? { agreed: [], due: months.map(() => []), received: months.map(() => []), paid: [], balance: [] };
    s.agreed.push(r.agreedFee);
    cells.forEach((c, i) => { s.due[i].push(c.due); s.received[i].push(c.received); });
    s.paid.push(o?.paidToDate ?? r.paidToDate);
    s.balance.push(o?.seasonBalance ?? r.seasonBalance);
    sums.set(r.currency, s);
  }
  for (const [currency, s] of Array.from(sums.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const values: (string | number)[] = [L.total(currency), "", "", currency, sumMinor(s.agreed, currency)];
    months.forEach((_, i) => values.push(sumMinor(s.due[i], currency), sumMinor(s.received[i], currency)));
    values.push(sumMinor(s.paid, currency), sumMinor(s.balance, currency), "");
    const row = ov.addRow(values);
    row.font = { bold: true };
    const fmt = moneyFormat(currency);
    for (let i = 5; i <= fixed + months.length * 2 + 2; i++) row.getCell(i).numFmt = fmt;
  }
  ov.addRow([]);
  const l1 = ov.addRow([L.noInstallmentMark, L.legendNoInstallment]);
  l1.getCell(1).fill = fill(FILL_NO_INSTALLMENT);
  l1.getCell(1).alignment = { horizontal: "center" };
  const l2 = ov.addRow(["", L.legendMissed]);
  l2.getCell(1).fill = fill(FILL_MISSED);
  ov.columns.forEach((col, i) => { col.width = i < 3 ? 24 : i < fixed ? 12 : 14; });
  return wb;
}
