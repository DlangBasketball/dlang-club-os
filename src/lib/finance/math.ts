/**
 * Finance report math — pure and client-safe (unit-tested in
 * tests/unit/finance-math.test.ts). All sums are done in integer minor units
 * of the report currency (toMinorUnits), so there are no float errors, and
 * every report works on ONE currency at a time: rows in another currency are
 * left out (the caller picks the currency, by default the org's).
 *
 * Definitions (cash basis for revenue, document date for expenses):
 *   payments recorded  = positive payment rows (status succeeded or pending) by payment date
 *   reconciled earnings = net settled money: succeeded rows (incl. negative reversal
 *                         rows) + negative refund rows        (= public.invoice_net_paid)
 *   expenses            = live expenses (paid and unpaid) by expense date
 *   profit              = reconciled earnings − expenses
 *   projected earnings  = open invoice balances by due date (past due = "overdue")
 *                         + upcoming, not yet invoiced training bookings and camp places
 */
import { fromMinorUnits, toMinorUnits } from "@/lib/payments/currency";
import { netPaid } from "@/lib/payments/adjustments";

export type Range = { from: string; to: string }; // YYYY-MM-DD inclusive

export const inRange = (day: string | null | undefined, r: Range) => !!day && day >= r.from && day <= r.to;
export const monthKey = (day: string) => day.slice(0, 7); // "2026-11"

/** Every month key from r.from to r.to (inclusive). */
export function monthsBetween(r: Range): string[] {
  const out: string[] = [];
  let y = Number(r.from.slice(0, 4));
  let m = Number(r.from.slice(5, 7));
  const endY = Number(r.to.slice(0, 4));
  const endM = Number(r.to.slice(5, 7));
  while ((y < endY || (y === endY && m <= endM)) && out.length < 240) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** First and last day of the month containing `day`. */
export function monthBounds(day: string): Range {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

/** Money accumulator in minor units for one currency. */
export class Sum {
  private minor = 0;
  constructor(readonly currency: string) {}
  add(amount: number) { this.minor += toMinorUnits(amount, this.currency); return this; }
  get value() { return fromMinorUnits(this.minor, this.currency); }
}
export const sumMoney = (values: number[], currency: string) => values.reduce((s, v) => s.add(v), new Sum(currency)).value;

// ---------------------------------------------------------------------------
// Facts (normalised rows the data layer loads)
// ---------------------------------------------------------------------------
export type PaymentFact = {
  id: string; date: string; amount: number; currency: string; status: string; method: string;
  invoiceId: string | null; isReversal?: boolean;
};
export type InvoiceFact = {
  id: string; number: string; familyId: string; currency: string; status: string;
  total: number; adjustmentsTotal: number; issuedDate: string; dueDate: string | null;
  programId: string | null; campEditionId: string | null; location: string | null;
};
export type ExpenseFact = {
  id: string; date: string; amount: number; currency: string; status: "paid" | "unpaid";
  categoryId: string | null; programId: string | null; campEditionId: string | null; location: string | null;
};
export type UpcomingFact = { date: string; amount: number; currency: string; source: "training" | "camp" };

/** Rows that count towards settled money (mirrors public.invoice_net_paid). */
export function isSettled(p: Pick<PaymentFact, "status" | "amount">): boolean {
  return p.status === "succeeded" || ((p.status === "refunded" || p.status === "partially_refunded") && p.amount < 0);
}

const ISSUED_EXCLUDED = new Set(["draft", "void", "cancelled"]);
const OPEN_STATUSES = new Set(["pending", "sent", "partially_paid", "overdue"]);
export const isIssued = (status: string) => !ISSUED_EXCLUDED.has(status);
export const isOpen = (status: string) => OPEN_STATUSES.has(status);

// ---------------------------------------------------------------------------
// Payments recorded / reconciled earnings
// ---------------------------------------------------------------------------
export type MethodRow = { method: string; count: number; amount: number };
export type PaymentsRecorded = { count: number; amount: number; pendingCount: number; pendingAmount: number; byMethod: MethodRow[] };

export function paymentsRecorded(payments: PaymentFact[], r: Range, currency: string): PaymentsRecorded {
  const rows = payments.filter((p) => p.currency === currency && inRange(p.date, r) && p.amount > 0 && !p.isReversal
    && (p.status === "succeeded" || p.status === "pending" || p.status === "refunded" || p.status === "partially_refunded"));
  const by = new Map<string, { count: number; sum: Sum }>();
  const total = new Sum(currency);
  const pending = new Sum(currency);
  let pendingCount = 0;
  for (const p of rows) {
    total.add(p.amount);
    if (p.status === "pending") { pending.add(p.amount); pendingCount += 1; }
    const b = by.get(p.method) ?? { count: 0, sum: new Sum(currency) };
    b.count += 1; b.sum.add(p.amount); by.set(p.method, b);
  }
  return {
    count: rows.length, amount: total.value, pendingCount, pendingAmount: pending.value,
    byMethod: Array.from(by.entries()).map(([method, b]) => ({ method, count: b.count, amount: b.sum.value })).sort((a, b) => b.amount - a.amount),
  };
}

export type Reconciled = { amount: number; received: number; refunded: number; reversed: number };

export function reconciledEarnings(payments: PaymentFact[], r: Range, currency: string): Reconciled {
  const rows = payments.filter((p) => p.currency === currency && inRange(p.date, r) && isSettled(p));
  const received = new Sum(currency);
  const refunded = new Sum(currency);
  const reversed = new Sum(currency);
  for (const p of rows) {
    if (p.amount >= 0) received.add(p.amount);
    else if (p.status === "succeeded") reversed.add(-p.amount);
    else refunded.add(-p.amount);
  }
  return {
    amount: netPaid(rows.map((p) => ({ amount: p.amount, status: p.status })), currency),
    received: received.value, refunded: refunded.value, reversed: reversed.value,
  };
}

// ---------------------------------------------------------------------------
// Expenses by category
// ---------------------------------------------------------------------------
export type CategoryRow = { categoryId: string | null; count: number; amount: number; unpaid: number; share: number };

export function expensesByCategory(expenses: ExpenseFact[], r: Range, currency: string): CategoryRow[] {
  const rows = expenses.filter((e) => e.currency === currency && inRange(e.date, r));
  const total = sumMoney(rows.map((e) => e.amount), currency);
  const by = new Map<string, { id: string | null; count: number; sum: Sum; unpaid: Sum }>();
  for (const e of rows) {
    const k = e.categoryId ?? "";
    const b = by.get(k) ?? { id: e.categoryId, count: 0, sum: new Sum(currency), unpaid: new Sum(currency) };
    b.count += 1; b.sum.add(e.amount);
    if (e.status === "unpaid") b.unpaid.add(e.amount);
    by.set(k, b);
  }
  return Array.from(by.values())
    .map((b) => ({ categoryId: b.id, count: b.count, amount: b.sum.value, unpaid: b.unpaid.value, share: total > 0 ? b.sum.value / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------------------
// Profit (revenue − expenses) by month / programme / camp edition / location
// ---------------------------------------------------------------------------
export type ProfitDimension = "month" | "program" | "camp" | "location";
export type ProfitRow = { key: string | null; revenue: number; expenses: number; profit: number; margin: number | null };

export function profitBy(
  dim: ProfitDimension,
  input: { payments: PaymentFact[]; invoices: InvoiceFact[]; expenses: ExpenseFact[] },
  r: Range,
  currency: string,
): ProfitRow[] {
  const inv = new Map(input.invoices.map((i) => [i.id, i]));
  const keyOfInvoice = (i: InvoiceFact | undefined): string | null =>
    !i ? null : dim === "program" ? i.programId : dim === "camp" ? i.campEditionId : i.location;
  const keyOfExpense = (e: ExpenseFact): string | null =>
    dim === "program" ? e.programId : dim === "camp" ? e.campEditionId : e.location;

  const rows = new Map<string, { key: string | null; rev: Sum; exp: Sum }>();
  const row = (k: string | null) => {
    const id = k ?? "";
    let x = rows.get(id);
    if (!x) { x = { key: k, rev: new Sum(currency), exp: new Sum(currency) }; rows.set(id, x); }
    return x;
  };
  if (dim === "month") for (const m of monthsBetween(r)) row(m);

  for (const p of input.payments) {
    if (p.currency !== currency || !inRange(p.date, r) || !isSettled(p)) continue;
    const k = dim === "month" ? monthKey(p.date) : keyOfInvoice(p.invoiceId ? inv.get(p.invoiceId) : undefined);
    row(k).rev.add(p.amount);
  }
  for (const e of input.expenses) {
    if (e.currency !== currency || !inRange(e.date, r)) continue;
    row(dim === "month" ? monthKey(e.date) : keyOfExpense(e)).exp.add(e.amount);
  }
  const out = Array.from(rows.values()).map((x) => {
    const revenue = x.rev.value;
    const expenses = x.exp.value;
    const profit = fromMinorUnits(toMinorUnits(revenue, currency) - toMinorUnits(expenses, currency), currency);
    return { key: x.key, revenue, expenses, profit, margin: revenue > 0 ? profit / revenue : null };
  });
  if (dim === "month") return out.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  return out.filter((x) => x.revenue !== 0 || x.expenses !== 0).sort((a, b) => b.profit - a.profit);
}

/** Totals of a profit table (same currency). */
export function profitTotals(rows: ProfitRow[], currency: string): ProfitRow {
  const revenue = sumMoney(rows.map((r) => r.revenue), currency);
  const expenses = sumMoney(rows.map((r) => r.expenses), currency);
  const profit = fromMinorUnits(toMinorUnits(revenue, currency) - toMinorUnits(expenses, currency), currency);
  return { key: null, revenue, expenses, profit, margin: revenue > 0 ? profit / revenue : null };
}

// ---------------------------------------------------------------------------
// Invoice balances and projected earnings
// ---------------------------------------------------------------------------
/** Open amount of one invoice: total + adjustments − net paid, never negative. */
export function invoiceOutstanding(i: Pick<InvoiceFact, "total" | "adjustmentsTotal" | "currency" | "status">, paid: number): number {
  if (!isOpen(i.status)) return 0;
  const due = toMinorUnits(i.total, i.currency) + toMinorUnits(i.adjustmentsTotal, i.currency);
  return fromMinorUnits(Math.max(due - toMinorUnits(paid, i.currency), 0), i.currency);
}

/** Net paid per invoice (all dates), from payment facts. */
export function paidByInvoice(payments: PaymentFact[]): Map<string, number> {
  const groups = new Map<string, PaymentFact[]>();
  for (const p of payments) if (p.invoiceId) groups.set(p.invoiceId, [...(groups.get(p.invoiceId) ?? []), p]);
  const out = new Map<string, number>();
  for (const [id, rows] of groups) out.set(id, netPaid(rows.map((p) => ({ amount: p.amount, status: p.status })), rows[0].currency));
  return out;
}

export type ProjectionRow = { month: string; invoices: number; training: number; camps: number; total: number };
export type Projection = { overdue: number; rows: ProjectionRow[]; total: number; openInvoices: number };

/**
 * Money expected in [today .. r.to]: open invoice balances by due date (no due
 * date = due today; past due = "overdue", reported separately and included in
 * the total), plus upcoming not-yet-invoiced bookings / camp places by date.
 */
export function projectedEarnings(
  input: { invoices: InvoiceFact[]; payments: PaymentFact[]; upcoming: UpcomingFact[] },
  today: string,
  until: string,
  currency: string,
): Projection {
  const paid = paidByInvoice(input.payments);
  const months = new Map<string, { inv: Sum; tr: Sum; camp: Sum }>();
  for (const m of monthsBetween({ from: today, to: until < today ? today : until })) {
    months.set(m, { inv: new Sum(currency), tr: new Sum(currency), camp: new Sum(currency) });
  }
  const overdue = new Sum(currency);
  let openInvoices = 0;
  for (const i of input.invoices) {
    if (i.currency !== currency) continue;
    const open = invoiceOutstanding(i, paid.get(i.id) ?? 0);
    if (open <= 0) continue;
    const due = i.dueDate ?? today;
    if (due < today) { overdue.add(open); openInvoices += 1; continue; }
    const b = months.get(monthKey(due));
    if (!b) continue; // due after the horizon
    b.inv.add(open); openInvoices += 1;
  }
  for (const u of input.upcoming) {
    if (u.currency !== currency || u.date < today) continue;
    const b = months.get(monthKey(u.date));
    if (!b) continue;
    (u.source === "training" ? b.tr : b.camp).add(u.amount);
  }
  const rows = Array.from(months.entries()).map(([month, b]) => ({
    month, invoices: b.inv.value, training: b.tr.value, camps: b.camp.value,
    total: sumMoney([b.inv.value, b.tr.value, b.camp.value], currency),
  }));
  const total = sumMoney([overdue.value, ...rows.map((x) => x.total)], currency);
  return { overdue: overdue.value, rows, total, openInvoices };
}

// ---------------------------------------------------------------------------
// Family balances
// ---------------------------------------------------------------------------
export type CreditFact = { familyId: string; amount: number; currency: string };
export type FamilyBalance = {
  familyId: string; currency: string; invoices: number;
  invoiced: number; paid: number; credits: number; outstanding: number;
};

/**
 * Per family and currency: invoiced = amount due of issued invoices
 * (total + adjustments), paid = net paid on them, credits = family money
 * credit balance, outstanding = open balances still to collect.
 */
export function familyBalances(invoices: InvoiceFact[], payments: PaymentFact[], credits: CreditFact[]): FamilyBalance[] {
  const paid = paidByInvoice(payments);
  const rows = new Map<string, { familyId: string; currency: string; n: number; inv: Sum; paid: Sum; cr: Sum; out: Sum }>();
  const get = (familyId: string, currency: string) => {
    const k = `${familyId}|${currency}`;
    let r = rows.get(k);
    if (!r) { r = { familyId, currency, n: 0, inv: new Sum(currency), paid: new Sum(currency), cr: new Sum(currency), out: new Sum(currency) }; rows.set(k, r); }
    return r;
  };
  for (const i of invoices) {
    if (!isIssued(i.status)) continue;
    const r = get(i.familyId, i.currency);
    const p = paid.get(i.id) ?? 0;
    r.n += 1;
    r.inv.add(fromMinorUnits(toMinorUnits(i.total, i.currency) + toMinorUnits(i.adjustmentsTotal, i.currency), i.currency));
    r.paid.add(p);
    r.out.add(invoiceOutstanding(i, p));
  }
  for (const c of credits) get(c.familyId, c.currency).cr.add(c.amount);
  return Array.from(rows.values())
    .map((r) => ({ familyId: r.familyId, currency: r.currency, invoices: r.n, invoiced: r.inv.value, paid: r.paid.value, credits: r.cr.value, outstanding: r.out.value }))
    .sort((a, b) => b.outstanding - a.outstanding || a.familyId.localeCompare(b.familyId));
}

// ---------------------------------------------------------------------------
// Coach payouts (payroll-lite)
// ---------------------------------------------------------------------------
export type RateType = "hourly" | "per_session";
export type CoachRate = { rateType: RateType; amount: number; currency: string };
/** What a coach did in the month: sessions they led, completed 1:1 bookings and their minutes. */
export type CoachActivity = { sessions: number; sessionMinutes: number; bookings: number; bookingMinutes: number };
export type PayoutBasis = "sessions" | "minutes" | "clock";
export type PayoutCalc = { units: number; minutes: number; basis: PayoutBasis; amount: number };

/**
 * per_session: rate × (sessions + bookings).
 * hourly:      rate × hours, where hours come from clock-in minutes when the
 *              staff module supplies them (clockMinutes > 0), else from the
 *              scheduled length of the sessions and bookings.
 * Rounded once, in the rate currency's minor unit.
 */
export function computeCoachPayout(rate: CoachRate, a: CoachActivity, clockMinutes?: number | null): PayoutCalc {
  const scheduled = Math.max(0, a.sessionMinutes) + Math.max(0, a.bookingMinutes);
  const units = Math.max(0, a.sessions) + Math.max(0, a.bookings);
  if (rate.rateType === "per_session") {
    const minor = toMinorUnits(rate.amount, rate.currency) * units;
    return { units, minutes: scheduled, basis: "sessions", amount: fromMinorUnits(minor, rate.currency) };
  }
  const useClock = typeof clockMinutes === "number" && clockMinutes > 0;
  const minutes = useClock ? clockMinutes : scheduled;
  const minor = Math.round((toMinorUnits(rate.amount, rate.currency) * minutes) / 60);
  return { units, minutes, basis: useClock ? "clock" : "minutes", amount: fromMinorUnits(minor, rate.currency) };
}

// ---------------------------------------------------------------------------
// Student trend (dashboard)
// ---------------------------------------------------------------------------
/** Athletes on the books at the end of each month (created before month end; archived ones excluded). */
export function studentTrend(athletes: { createdDate: string; status: string }[], months: string[]): { month: string; total: number; active: number }[] {
  return months.map((m) => {
    const end = monthBounds(`${m}-01`).to;
    const on = athletes.filter((a) => a.createdDate <= end && a.status !== "archived");
    return { month: m, total: on.length, active: on.filter((a) => a.status === "active").length };
  });
}
