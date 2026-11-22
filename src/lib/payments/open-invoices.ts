/**
 * Open (unpaid) invoice money — pure and client-safe (unit-tested in
 * tests/unit/open-invoices.test.ts).
 *
 * "Open" follows the finance module (src/lib/finance/math.ts isOpen): issued
 * invoices that still expect money, i.e. sent, partially_paid, overdue and the
 * legacy "pending". Drafts are not owed yet; paid / cancelled / written-off /
 * void / refunded invoices are closed. The amount still owed is the invoice
 * balance (total + credit/debit notes - net paid), never the issued total, and
 * money is summed per currency (a club can bill in more than one).
 */
import { isOpen } from "@/lib/finance/math";
import { fromMinorUnits, toMinorUnits } from "./currency";
import { invoiceMoney, netPaid, type PaymentLike } from "./adjustments";

export const OPEN_INVOICE_STATUSES = ["pending", "sent", "partially_paid", "overdue"] as const;
export type OpenInvoiceStatus = (typeof OPEN_INVOICE_STATUSES)[number];
export const isOpenInvoiceStatus = (status: string): status is OpenInvoiceStatus => isOpen(status);

export type InvoiceRow = {
  id: string;
  familyId: string | null;
  status: string;
  dueDate: string | null;
  currency: string | null;
  total: number | string | null;
  adjustmentsTotal: number | string | null;
};

export type OpenInvoice = {
  id: string;
  familyId: string | null;
  status: string;
  dueDate: string | null;
  currency: string;
  amountDue: number;
  paid: number;
  /** What is still owed (never negative). */
  balance: number;
};

/** Money per currency, e.g. { CHF: 120.5, EUR: 40 }. */
export type CurrencyTotals = Record<string, number>;
export type OpenBucket = { count: number; totals: CurrencyTotals };
export type OpenSummary = { open: OpenBucket; overdue: OpenBucket };

/** Past its due date (YYYY-MM-DD, compared with today's key) or flagged overdue. */
export function isOverdueInvoice(inv: { status: string; dueDate: string | null }, todayKey: string): boolean {
  return inv.status === "overdue" || (inv.dueDate != null && inv.dueDate.slice(0, 10) < todayKey);
}

/** Balance of each open invoice from its row and its payment rows. */
export function openInvoices(rows: InvoiceRow[], paymentsByInvoice: Map<string, PaymentLike[]>): OpenInvoice[] {
  const out: OpenInvoice[] = [];
  for (const r of rows) {
    if (!isOpenInvoiceStatus(r.status)) continue;
    const currency = (r.currency ?? "CHF").toUpperCase();
    const m = invoiceMoney({
      total: Number(r.total ?? 0),
      adjustmentsTotal: Number(r.adjustmentsTotal ?? 0),
      paid: netPaid(paymentsByInvoice.get(r.id) ?? [], currency),
      currency,
    });
    out.push({ id: r.id, familyId: r.familyId, status: r.status, dueDate: r.dueDate, currency, amountDue: m.amountDue, paid: m.paid, balance: Math.max(0, m.balance) });
  }
  return out;
}

function addTo(totals: CurrencyTotals, currency: string, amount: number) {
  totals[currency] = fromMinorUnits(toMinorUnits(totals[currency] ?? 0, currency) + toMinorUnits(amount, currency), currency);
}

/** Open vs overdue counts and balances (per currency). */
export function summarizeOpenInvoices(invoices: OpenInvoice[], todayKey: string): OpenSummary {
  const s: OpenSummary = { open: { count: 0, totals: {} }, overdue: { count: 0, totals: {} } };
  for (const inv of invoices) {
    const b = isOverdueInvoice(inv, todayKey) ? s.overdue : s.open;
    b.count += 1;
    addTo(b.totals, inv.currency, inv.balance);
  }
  return s;
}

/** Open invoice count and balance per family (per currency). */
export function openByFamily(invoices: OpenInvoice[]): Map<string, OpenBucket> {
  const m = new Map<string, OpenBucket>();
  for (const inv of invoices) {
    if (!inv.familyId) continue;
    const b = m.get(inv.familyId) ?? { count: 0, totals: {} };
    b.count += 1;
    addTo(b.totals, inv.currency, inv.balance);
    m.set(inv.familyId, b);
  }
  return m;
}

/**
 * Totals as display entries, the preferred (org) currency first, then the
 * others alphabetically; an empty total yields the preferred currency at 0.
 */
export function totalsList(totals: CurrencyTotals, preferred: string): { currency: string; amount: number }[] {
  const pref = preferred.toUpperCase();
  const keys = Object.keys(totals).filter((c) => totals[c] !== 0 || c === pref);
  if (!keys.includes(pref) && keys.length === 0) keys.push(pref);
  return keys
    .sort((a, b) => (a === pref ? -1 : b === pref ? 1 : a.localeCompare(b)))
    .map((currency) => ({ currency, amount: totals[currency] ?? 0 }));
}
