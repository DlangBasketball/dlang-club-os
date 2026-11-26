import type { AvailabilityMode, BillingStatus, BookingQuote, BookingRow, BookingState, BookingStatus } from "./types";
import { AVAILABILITY_MODES, DEFAULT_REQUEST_FOLLOWUP_HOURS } from "./types";

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
export const OVERRIDABLE_ERRORS = ["COACH_UNAVAILABLE", "COACH_NOT_ELIGIBLE", "VENUE_CLOSED"] as const;

export function quoteSummary(q: Pick<BookingQuote, "errors" | "warnings" | "billing">) {
  const errors = q.errors ?? [];
  const overridable = errors.length > 0 && errors.every((e) => (OVERRIDABLE_ERRORS as readonly string[]).includes(e));
  return {
    canConfirm: errors.length === 0,
    needsOverride: overridable,
    warnings: (q.warnings ?? []).map((w) => w.code),
    invoiceBlocked: q.billing.billing_mode === "invoice" && (q.billing.setup_missing ?? []).length > 0,
    /** Confirming creates a request the coach confirms (open availability). */
    createsRequest: (q as { creates?: string }).creates === "requested",
    discount: Number(q.billing.discount_total ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Booking requests (20250420104700)
// ---------------------------------------------------------------------------
/** The club's availability mode from app_settings.settings.booking (unknown values = declared). */
export function availabilityMode(raw: unknown): AvailabilityMode {
  return (AVAILABILITY_MODES as readonly string[]).includes(String(raw)) ? (raw as AvailabilityMode) : "declared";
}

/** Follow-up hours setting, clamped as in SQL bk_settings (1..720, default 48). */
export function requestFollowupHours(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_REQUEST_FOLLOWUP_HOURS;
  return Math.min(720, Math.max(1, Math.round(n)));
}

export const isRequest = (b: Pick<BookingRow, "status">) => b.status === "requested";

/** Whole hours a request has waited (0 when unknown). */
export function hoursWaiting(requestedAtIso: string | null | undefined, nowIso: string): number {
  if (!requestedAtIso) return 0;
  const ms = new Date(nowIso).getTime() - new Date(requestedAtIso).getTime();
  return ms > 0 ? Math.floor(ms / 3_600_000) : 0;
}

/** Is an unanswered request due for staff follow-up (mirrors SQL: requested_at older than the hours)? */
export function isStaleRequest(requestedAtIso: string | null | undefined, nowIso: string, followupHours: number): boolean {
  if (!requestedAtIso) return false;
  return new Date(nowIso).getTime() - new Date(requestedAtIso).getTime() > followupHours * 3_600_000;
}

/** A decline needs a reason (trimmed, at most 500 characters), as booking_request_decline. */
export function declineReasonOk(reason: string): boolean {
  const r = reason.trim();
  return r.length > 0 && r.length <= 500;
}

/**
 * Booking status after the finalized attendance mark (mirrors the SQL
 * trigger bk_attendance_booking_sync): present / late -> completed,
 * unexcused -> no_show, excused -> booked (with the excused marker).
 */
export function statusFromAttendance(mark: string | null | undefined): BookingStatus | null {
  switch (mark) {
    case "present": case "late": return "completed";
    case "unexcused": return "no_show";
    case "excused": return "booked";
    default: return null;
  }
}

/** Label key of a booking for people: requests wait for the coach; an excused booked session says so. */
export function bookingDisplayKey(b: { status: BookingStatus; attendance_status?: string | null }): BookingState | "excused" {
  if (b.status === "booked" && b.attendance_status === "excused") return "excused";
  return bookingState(b.status);
}

/** Promo code as typed into a form: upper case, letters / digits / - / _ only, at most 40. */
export function normalizePromoCode(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40);
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
