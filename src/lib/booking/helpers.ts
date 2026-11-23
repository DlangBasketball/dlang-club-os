import type { BillingStatus, BookingQuote, BookingRow, BookingState, BookingStatus } from "./types";

/*
 * Booking workflow — pure helpers shared by the UI and the server actions.
 * They mirror the SQL rules (bk_norm, the cancellation policy, the minor
 * rule of athlete_quick_create) so forms can explain an outcome before the
 * server confirms it; the server always decides.
 */

const FOLD: Record<string, string> = { "ß": "s", "æ": "a", "Æ": "a", "œ": "o", "Œ": "o", "ø": "o", "Ø": "o" };

/** Case- and accent-insensitive comparison key, the TS twin of SQL bk_norm(). */
export function normName(value: string | null | undefined): string | null {
  if (!value) return null;
  const folded = value
    .replace(/[ßæÆœŒøØ]/g, (c) => FOLD[c] ?? c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return folded || null;
}

/** Whole years between dob and a reference day (both YYYY-MM-DD). */
export function ageOn(dob: string, onDay: string): number {
  const [y1, m1, d1] = dob.split("-").map(Number);
  const [y2, m2, d2] = onDay.split("-").map(Number);
  let age = y2 - y1;
  if (m2 < m1 || (m2 === m1 && d2 < d1)) age -= 1;
  return age;
}

/** A minor needs a guardian (existing family / guardian, or a new family contact). */
export function isMinor(dob: string, onDay: string): boolean {
  return ageOn(dob, onDay) < 18;
}

export function bookingState(status: BookingStatus): BookingState {
  return status === "booked" ? "confirmed" : status;
}

export const canReschedule = (b: Pick<BookingRow, "status">) => b.status === "booked";
export const canCancel = (b: Pick<BookingRow, "status">) => b.status === "booked";
export const canInvoice = (b: Pick<BookingRow, "billing_status">) => b.billing_status === "to_invoice";

/** Billing statuses with money still expected. */
export function isOpenBilling(s: BillingStatus): boolean {
  return s === "to_invoice" || s === "invoice_draft" || s === "invoiced" || s === "partially_paid";
}

/** End of a slot from its start and the service duration. */
export function slotEnd(startIso: string, durationMin: number): string {
  return new Date(new Date(startIso).getTime() + durationMin * 60_000).toISOString();
}

/** Blocking codes an admin can lift with an override + reason. */
export const OVERRIDABLE_ERRORS = ["COACH_UNAVAILABLE", "COACH_NOT_ELIGIBLE"] as const;

export function quoteSummary(q: Pick<BookingQuote, "errors" | "warnings" | "billing">) {
  const errors = q.errors ?? [];
  const overridable = errors.length > 0 && errors.every((e) => (OVERRIDABLE_ERRORS as readonly string[]).includes(e));
  return {
    canConfirm: errors.length === 0,
    needsOverride: overridable,
    warnings: (q.warnings ?? []).map((w) => w.code),
    invoiceBlocked: q.billing.billing_mode === "invoice" && (q.billing.setup_missing ?? []).length > 0,
  };
}

/**
 * Does the club policy restore a package entitlement on cancel? Mirrors
 * booking_cancel: the booking starts at least `cancellationHours` from now
 * and the club refunds credits on cancel. Staff can decide otherwise.
 */
export function policyRestoresPackage(slotStartIso: string, nowIso: string, cancellationHours: number, refundOnCancel: boolean): boolean {
  if (!refundOnCancel) return false;
  return new Date(slotStartIso).getTime() - new Date(nowIso).getTime() >= cancellationHours * 3_600_000;
}

/** Slot label in the club's time zone and the viewer's locale ("Mon 7 Dec, 10:00–11:00"). */
export function formatSlot(startIso: string, endIso: string | null, locale: string, timeZone: string): string {
  const start = new Date(startIso);
  const f = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });
  return endIso ? f.formatRange(start, new Date(endIso)) : f.format(start);
}
