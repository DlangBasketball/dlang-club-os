import {
  expensesByCategory, paymentsRecorded, profitBy, profitTotals, projectedEarnings, reconciledEarnings, sumMoney,
  type CategoryRow, type PaymentsRecorded, type ProfitDimension, type ProfitRow, type Projection, type Range, type Reconciled,
} from "./math";
import type { FinanceFacts } from "./data";

/** One currency's financial report, with labels resolved (null label = unassigned). */
export type LabeledProfit = ProfitRow & { label: string | null };
export type FinancialReport = {
  currency: string; range: Range;
  recorded: PaymentsRecorded; reconciled: Reconciled; expensesTotal: number; expensesUnpaid: number;
  profit: ProfitRow; projection: Projection; projectionUntil: string;
  categories: (CategoryRow & { label: string | null })[];
  byMonth: LabeledProfit[]; byProgram: LabeledProfit[]; byCamp: LabeledProfit[]; byLocation: LabeledProfit[];
};

export const PROJECTION_DAYS = 180;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export function buildFinancialReport(facts: FinanceFacts, range: Range, currency: string, today: string): FinancialReport {
  const prog = new Map(facts.refs.programs.map((p) => [p.id, p.name]));
  const camp = new Map(facts.refs.camps.map((c) => [c.id, c.name]));
  const cat = new Map(facts.refs.categories.map((c) => [c.id, c.name]));
  const input = { payments: facts.payments, invoices: facts.invoices, expenses: facts.expenses };
  const by = (dim: ProfitDimension, label: (k: string) => string | null) =>
    profitBy(dim, input, range, currency).map((r) => ({ ...r, label: r.key == null ? null : label(r.key) }));
  const byMonth = by("month", (k) => k);
  const rangeExpenses = facts.expenses.filter((e) => e.currency === currency && e.date >= range.from && e.date <= range.to);
  const projectionUntil = addDays(today, PROJECTION_DAYS);
  return {
    currency, range,
    recorded: paymentsRecorded(facts.payments, range, currency),
    reconciled: reconciledEarnings(facts.payments, range, currency),
    expensesTotal: sumMoney(rangeExpenses.map((e) => e.amount), currency),
    expensesUnpaid: sumMoney(rangeExpenses.filter((e) => e.status === "unpaid").map((e) => e.amount), currency),
    profit: profitTotals(byMonth, currency),
    projection: projectedEarnings({ invoices: facts.invoices, payments: facts.payments, upcoming: facts.upcoming }, today, projectionUntil, currency),
    projectionUntil,
    categories: expensesByCategory(facts.expenses, range, currency).map((c) => ({ ...c, label: c.categoryId ? cat.get(c.categoryId) ?? null : null })),
    byMonth,
    byProgram: by("program", (k) => prog.get(k) ?? null),
    byCamp: by("camp", (k) => camp.get(k) ?? null),
    byLocation: by("location", (k) => k),
  };
}
