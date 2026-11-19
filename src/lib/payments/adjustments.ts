/**
 * Invoice / payment editing math — pure and client-safe. Everything is done
 * in integer minor units of the invoice currency (toMinorUnits), so there are
 * no float errors (0.1 + 0.2), and mirrors the SQL in
 * supabase/migrations/20250420095900_money_editing.sql:
 *
 *   amount due  = original total + debit notes − credit notes − write-offs − cancellations
 *   net paid    = succeeded rows (incl. negative reversal / credit-transfer rows)
 *                 + negative refund rows                      (public.invoice_net_paid)
 *   balance     = amount due − net paid   (negative = overpaid)
 */
import { fromMinorUnits, toMinorUnits } from "./currency";

export type AdjustmentKind = "credit_note" | "debit_note" | "write_off" | "cancellation";
export const ADJUSTMENT_KINDS: readonly AdjustmentKind[] = ["credit_note", "debit_note", "write_off", "cancellation"];

export type AdjustmentLike = { kind: string; amount: number; voided?: boolean };
export type PaymentLike = { amount: number; status: string };

/** Line amount = round(quantity × unit price) in the currency's minor unit. */
export function lineAmount(quantity: number, unitPrice: number, currency: string): number {
  const unit = toMinorUnits(unitPrice, currency);
  // quantity may be fractional (e.g. 1.5 hours): round the product once.
  return fromMinorUnits(Math.round(unit * quantity), currency);
}

export type DraftLine = { quantity: number; unitPrice: number };

/** Totals of a draft invoice as entered in the editor (lines + optional discount). */
export function draftTotals(lines: DraftLine[], discount: number, currency: string) {
  const subtotalMinor = lines.reduce((s, l) => s + toMinorUnits(lineAmount(l.quantity || 0, l.unitPrice || 0, currency), currency), 0);
  const discountMinor = Math.max(0, toMinorUnits(discount || 0, currency));
  const totalMinor = subtotalMinor - discountMinor;
  return {
    subtotal: fromMinorUnits(subtotalMinor, currency),
    discount: fromMinorUnits(discountMinor, currency),
    total: fromMinorUnits(totalMinor, currency),
    valid: totalMinor >= 0 && lines.length > 0 && lines.every((l) => l.quantity > 0),
  };
}

/** Signed effect of one adjustment on the amount due (debit +, others −). */
export function adjustmentEffect(kind: string, amount: number): number {
  return kind === "debit_note" ? Math.abs(amount) : -Math.abs(amount);
}

/** Sum of active adjustments (== invoices.adjustments_total). */
export function adjustmentsTotal(adjustments: AdjustmentLike[], currency: string): number {
  const minor = adjustments
    .filter((a) => !a.voided)
    .reduce((s, a) => s + toMinorUnits(adjustmentEffect(a.kind, a.amount), currency), 0);
  return fromMinorUnits(minor, currency);
}

/** Net paid, as public.invoice_net_paid(): succeeded rows plus negative refund rows. */
export function netPaid(payments: PaymentLike[], currency: string): number {
  const minor = payments
    .filter((p) => p.status === "succeeded" || ((p.status === "refunded" || p.status === "partially_refunded") && p.amount < 0))
    .reduce((s, p) => s + toMinorUnits(p.amount, currency), 0);
  return fromMinorUnits(minor, currency);
}

export type InvoiceMoney = {
  total: number;
  adjustments: number;
  amountDue: number;
  paid: number;
  /** amountDue − paid; negative when overpaid. */
  balance: number;
  /** What is still to collect (never negative). */
  outstanding: number;
  /** Paid above the amount due (never negative). */
  overpaid: number;
};

export function invoiceMoney(input: { total: number; adjustmentsTotal: number; paid: number; currency: string }): InvoiceMoney {
  const c = input.currency;
  const totalM = toMinorUnits(input.total, c);
  const adjM = toMinorUnits(input.adjustmentsTotal, c);
  const paidM = toMinorUnits(input.paid, c);
  const dueM = totalM + adjM;
  const balM = dueM - paidM;
  return {
    total: fromMinorUnits(totalM, c),
    adjustments: fromMinorUnits(adjM, c),
    amountDue: fromMinorUnits(dueM, c),
    paid: fromMinorUnits(paidM, c),
    balance: fromMinorUnits(balM, c),
    outstanding: fromMinorUnits(Math.max(0, balM), c),
    overpaid: fromMinorUnits(Math.max(0, -balM), c),
  };
}

export type AdjustmentCheck =
  | { ok: true; amount: number }
  | { ok: false; code: "INVALID_AMOUNT" | "CREDIT_EXCEEDS_AMOUNT_DUE" | "USE_CANCEL" | "NOTHING_TO_WRITE_OFF" };

/** Client-side mirror of issue_invoice_adjustment's amount rules. */
export function checkAdjustment(kind: "credit_note" | "debit_note" | "write_off", amount: number, money: InvoiceMoney, currency: string): AdjustmentCheck {
  if (kind === "write_off") {
    return money.outstanding > 0 ? { ok: true, amount: money.outstanding } : { ok: false, code: "NOTHING_TO_WRITE_OFF" };
  }
  const m = toMinorUnits(Number.isFinite(amount) ? amount : 0, currency);
  if (m <= 0) return { ok: false, code: "INVALID_AMOUNT" };
  if (kind === "credit_note") {
    const dueM = toMinorUnits(money.amountDue, currency);
    if (m > dueM) return { ok: false, code: "CREDIT_EXCEEDS_AMOUNT_DUE" };
    if (m === dueM && toMinorUnits(money.paid, currency) <= 0) return { ok: false, code: "USE_CANCEL" };
  }
  return { ok: true, amount: fromMinorUnits(m, currency) };
}

/** VAT contained in a gross adjustment amount (credit notes carry the invoice's rate). */
export function adjustmentTax(amount: number, rate: number, currency: string): number {
  if (!rate) return 0;
  const m = toMinorUnits(amount, currency);
  return fromMinorUnits(Math.round((m * rate) / (100 + rate)), currency);
}

/** Amount of family credit that can pay an invoice: min(requested, open balance, credit). */
export function applicableCredit(outstanding: number, credit: number, currency: string, requested?: number | null): number {
  const cap = Math.min(toMinorUnits(Math.max(0, outstanding), currency), toMinorUnits(Math.max(0, credit), currency));
  const want = requested == null ? cap : toMinorUnits(requested, currency);
  return fromMinorUnits(Math.max(0, Math.min(cap, want)), currency);
}

/** Running balance of a family credit ledger (per currency). */
export function creditBalance(entries: { amount: number; currency: string }[], currency: string): number {
  const cur = currency.toUpperCase();
  return fromMinorUnits(
    entries.filter((e) => e.currency.toUpperCase() === cur).reduce((s, e) => s + toMinorUnits(e.amount, cur), 0),
    cur,
  );
}

export type CreditChange = { ok: true; delta: number; total: number; balance: number } | { ok: false; code: "NO_CHANGE" | "BELOW_USED" | "INVALID_CREDITS" };

/** Training-credit edit: by delta (grant/revoke) or by setting a new total; never below used. */
export function trainingCreditChange(current: { total: number; used: number }, change: { delta?: number; newTotal?: number }): CreditChange {
  const hasDelta = change.delta != null;
  const hasTotal = change.newTotal != null;
  if (hasDelta === hasTotal) return { ok: false, code: "INVALID_CREDITS" };
  const delta = hasDelta ? Math.trunc(change.delta as number) : Math.trunc(change.newTotal as number) - current.total;
  if (!Number.isFinite(delta)) return { ok: false, code: "INVALID_CREDITS" };
  if (delta === 0) return { ok: false, code: "NO_CHANGE" };
  const total = current.total + delta;
  if (total < current.used || total < 0) return { ok: false, code: "BELOW_USED" };
  return { ok: true, delta, total, balance: total - current.used };
}
