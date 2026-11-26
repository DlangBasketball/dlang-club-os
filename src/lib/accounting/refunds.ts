/**
 * Refund & cancellation policy math. Pure; mirrors public.refund_policy_percent
 * and public.refund_quote (the database is authoritative, this drives the UI
 * preview and the unit tests).
 *
 * A policy per product type (camp / training / team_season / shop):
 *   - full refund when cancelling at least `fullUntilDays` days before the start
 *   - `partialPercent` % when at least `partialUntilDays` days before
 *   - nothing after that
 *   - medical cancellation with a certificate: `medicalPercent` %, paid out as
 *     family credit ("credit"), money back ("refund") or the family's choice
 *     ("choice"); "none" = no special medical rule.
 * The refund is a credit note on the invoice; the money that goes back is
 * the part of what was paid that exceeds the new amount due.
 */
import { fromMinorUnits, toMinorUnits } from "@/lib/payments/currency";

export const PRODUCT_TYPES = ["camp", "training", "team_season", "shop"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
export const MEDICAL_MODES = ["none", "credit", "refund", "choice"] as const;
export type MedicalMode = (typeof MEDICAL_MODES)[number];
export const RESOLUTIONS = ["family_credit", "stripe_refund", "bank_refund"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export type RefundPolicy = {
  fullUntilDays: number | null;
  partialPercent: number;
  partialUntilDays: number | null;
  medicalMode: MedicalMode;
  medicalPercent: number;
};

export type RefundQuote = {
  daysBefore: number | null;
  percent: number;
  refund: number;
  /** Money back (credit or payout) after the credit note. */
  payout: number;
  /** Still to pay after the credit note when less was paid than is kept. */
  stillOwed: number;
  needsReview: boolean;
};

/** Whole days from `on` to `start` (YYYY-MM-DD, calendar days, DST-safe). */
export function daysBetween(on: string, start: string): number {
  const a = Date.UTC(Number(on.slice(0, 4)), Number(on.slice(5, 7)) - 1, Number(on.slice(8, 10)));
  const b = Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

export function refundPercent(policy: RefundPolicy | null, daysBefore: number | null, medical: boolean): number {
  if (!policy) return 0;
  if (medical && policy.medicalMode !== "none") return clampPct(policy.medicalPercent);
  if (daysBefore === null) return 0;
  if (policy.fullUntilDays !== null && daysBefore >= policy.fullUntilDays) return 100;
  if (policy.partialUntilDays !== null && daysBefore >= policy.partialUntilDays) return clampPct(policy.partialPercent);
  return 0;
}

const clampPct = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

export function quoteRefund(input: {
  policy: RefundPolicy | null; startsOn: string | null; on: string; medical: boolean;
  base: number; amountDue: number; paid: number; currency: string;
}): RefundQuote {
  const { currency } = input;
  const daysBefore = input.startsOn ? daysBetween(input.on, input.startsOn) : null;
  const percent = refundPercent(input.policy, daysBefore, input.medical);
  const baseMinor = Math.max(0, toMinorUnits(input.base, currency));
  // round half away from zero on minor units (same as SQL round())
  const refundMinor = Math.round((baseMinor * percent) / 100);
  const dueMinor = toMinorUnits(input.amountDue, currency);
  const paidMinor = toMinorUnits(input.paid, currency);
  const credit = Math.min(refundMinor, Math.max(dueMinor, 0));
  const newDue = dueMinor - credit;
  return {
    daysBefore,
    percent,
    refund: fromMinorUnits(refundMinor, currency),
    payout: fromMinorUnits(Math.max(0, Math.min(refundMinor, paidMinor - newDue)), currency),
    stillOwed: fromMinorUnits(Math.max(0, newDue - paidMinor), currency),
    needsReview: !input.policy || (daysBefore === null && !input.medical),
  };
}

/** Resolutions a family may pick for a quote. */
export function allowedResolutions(policy: RefundPolicy | null, medical: boolean, stripeAvailable: boolean): Resolution[] {
  if (medical && policy?.medicalMode === "credit") return ["family_credit"];
  return RESOLUTIONS.filter((r) => r !== "stripe_refund" || stripeAvailable);
}

// ---------------------------------------------------------------------------
// IBAN (mirrors public.iban_is_valid)
// ---------------------------------------------------------------------------
export function normalizeIban(s: string | null | undefined): string {
  return (s ?? "").replace(/\s/g, "").toUpperCase();
}

export function isValidIban(s: string | null | undefined): boolean {
  const v = normalizeIban(s);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(v)) return false;
  const moved = v.slice(4) + v.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const d = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const x of d) rem = (rem * 10 + Number(x)) % 97;
  }
  return rem === 1;
}

/** "•••• 1234" style display needs only the last 4 characters. */
export function ibanLast4(s: string | null | undefined): string | null {
  const v = normalizeIban(s);
  return v.length >= 4 ? v.slice(-4) : null;
}
