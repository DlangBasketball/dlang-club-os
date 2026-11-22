import ExcelJS from "exceljs";
import { moneyFormat } from "./membership-workbook";
import { sumMinor } from "./membership-report";

/**
 * Selection (EYBL…) payments report — pure. One row per enrolment of a
 * selection programme, money as public.selection_roster /
 * selection_invoice_summary compute it (amount due incl. credit notes,
 * received, balance, next due date, overdue). The selection payment schedule
 * is the programme's own (payment period), independent of the club season.
 */

export const SELECTION_PAY_FILTERS = ["paid", "partial", "unpaid", "overdue", "none"] as const;
export type SelectionPayFilter = (typeof SELECTION_PAY_FILTERS)[number];
export const isSelectionPayFilter = (v: unknown): v is SelectionPayFilter =>
  typeof v === "string" && (SELECTION_PAY_FILTERS as readonly string[]).includes(v);

export type SelectionPaymentRow = {
  applicationId: string;
  athleteName: string;
  programId: string;
  programName: string;
  series: string;
  divisionId: string | null;
  divisionName: string | null;
  packageName: string | null;
  /** Covered tournaments (withdrawn ones are left out). */
  tournaments: { id: string; name: string }[];
  enrolmentStatus: string;
  arrangementKind: "full" | "monthly" | null;
  installmentCount: number | null;
  monthlyAmount: number | null;
  currency: string;
  agreedFee: number;
  amountDue: number;
  received: number;
  balance: number;
  nextDueOn: string | null;
  overdueAmount: number;
  paymentStatus: "none" | "unpaid" | "partial" | "paid";
  invoiceId: string | null;
};

export type SelectionFilters = { programId: string | null; divisionId: string | null; tournamentId: string | null; status: SelectionPayFilter | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Query = Record<string, string | string[] | undefined | null>;
const one = (q: Query, k: string) => {
  const v = q[k];
  return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
};

/** Filters from the query string; the programme defaults to the first one given (newest). */
export function resolveSelectionFilters(q: Query, programIds: string[]): SelectionFilters {
  const p = one(q, "program");
  const programId = programIds.includes(p) ? p : (programIds[0] ?? null);
  const d = one(q, "division");
  const t = one(q, "tournament");
  const s = one(q, "status");
  return {
    programId,
    divisionId: UUID_RE.test(d) ? d : null,
    tournamentId: UUID_RE.test(t) ? t : null,
    status: isSelectionPayFilter(s) ? s : null,
  };
}

export function selectionQuery(f: SelectionFilters): string {
  const p = new URLSearchParams();
  if (f.programId) p.set("program", f.programId);
  if (f.divisionId) p.set("division", f.divisionId);
  if (f.tournamentId) p.set("tournament", f.tournamentId);
  if (f.status) p.set("status", f.status);
  return p.toString();
}

export function filterSelectionRows(rows: SelectionPaymentRow[], f: SelectionFilters): SelectionPaymentRow[] {
  return rows.filter((r) =>
    (!f.divisionId || r.divisionId === f.divisionId)
    && (!f.tournamentId || r.tournaments.some((t) => t.id === f.tournamentId))
    && (!f.status || (f.status === "overdue" ? r.overdueAmount > 0 : r.paymentStatus === f.status)));
}

export type SelectionTotals = { currency: string; enrolments: number; agreedFee: number; amountDue: number; received: number; balance: number; overdueAmount: number };

export function selectionTotals(rows: SelectionPaymentRow[]): SelectionTotals[] {
  return Array.from(new Set(rows.map((r) => r.currency))).sort().map((currency) => {
    const l = rows.filter((r) => r.currency === currency);
    return {
      currency, enrolments: l.length,
      agreedFee: sumMinor(l.map((r) => r.agreedFee), currency), amountDue: sumMinor(l.map((r) => r.amountDue), currency),
      received: sumMinor(l.map((r) => r.received), currency), balance: sumMinor(l.map((r) => r.balance), currency),
      overdueAmount: sumMinor(l.map((r) => r.overdueAmount), currency),
    };
  });
}

export const SELECTION_COLUMNS = [
  "player", "programme", "division", "package", "tournaments", "enrolment", "plan", "currency", "agreedFee", "amountDue",
  "received", "balance", "nextDue", "overdue", "status",
] as const;
export type SelectionColumn = (typeof SELECTION_COLUMNS)[number];
const MONEY: Partial<Record<SelectionColumn, keyof SelectionTotals & keyof SelectionPaymentRow>> = {
  agreedFee: "agreedFee", amountDue: "amountDue", received: "received", balance: "balance", overdue: "overdueAmount",
};

export type SelectionLabels = {
  sheet: string;
  title: string;
  columns: Record<SelectionColumn, string>;
  plan: (r: SelectionPaymentRow) => string;
  enrolment: (s: string) => string;
  status: (s: SelectionPaymentRow["paymentStatus"]) => string;
  total: (currency: string) => string;
};

export function buildSelectionWorkbook(rows: SelectionPaymentRow[], L: SelectionLabels): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(L.sheet, { views: [{ state: "frozen", ySplit: 2 }] });
  ws.addRow([L.title]).font = { bold: true, size: 13 };
  ws.addRow(SELECTION_COLUMNS.map((c) => L.columns[c])).font = { bold: true };
  for (const r of rows) {
    const v: Record<SelectionColumn, string | number> = {
      player: r.athleteName, programme: r.programName, division: r.divisionName ?? "", package: r.packageName ?? "",
      tournaments: r.tournaments.map((t) => t.name).join(", "), enrolment: L.enrolment(r.enrolmentStatus), plan: L.plan(r),
      currency: r.currency, agreedFee: r.agreedFee, amountDue: r.amountDue, received: r.received, balance: r.balance,
      nextDue: r.nextDueOn ?? "", overdue: r.overdueAmount, status: L.status(r.paymentStatus),
    };
    const row = ws.addRow(SELECTION_COLUMNS.map((c) => v[c]));
    SELECTION_COLUMNS.forEach((c, i) => { if (MONEY[c]) row.getCell(i + 1).numFmt = moneyFormat(r.currency); });
  }
  for (const t of selectionTotals(rows)) {
    const row = ws.addRow(SELECTION_COLUMNS.map((c) => {
      const k = MONEY[c];
      if (k) return t[k];
      if (c === "player") return L.total(t.currency);
      if (c === "currency") return t.currency;
      return "";
    }));
    row.font = { bold: true };
    SELECTION_COLUMNS.forEach((c, i) => { if (MONEY[c]) row.getCell(i + 1).numFmt = moneyFormat(t.currency); });
  }
  ws.columns.forEach((col, i) => { col.width = i < 5 ? 24 : 15; });
  return wb;
}
