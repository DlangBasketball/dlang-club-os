import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";
import { getInvoiceTotalsByCategory } from "@/lib/data/billing";
import {
  bookingErrorCode, type BookingDetail, type BookingErrorCode, type BookingRow, type CoachAgendaSession, type CoachBookingRequest,
  type DashboardCounts, type FamilyCatalog, type PayerSnapshot, type PortalBookings, type ServiceKind, type SetupMissingCode,
} from "./types";

/*
 * Booking workflow — server-side reads. Every read runs as the signed-in
 * user; the RPCs (security definer) re-check tenant and role, RLS covers
 * the tables. Contract: docs/booking-workflow.md §7.
 */
export type Read<T> = { data: T; error: null } | { data: null; error: BookingErrorCode | "UNKNOWN" };
const ok = <T,>(data: T): Read<T> => ({ data, error: null });
const bad = <T,>(message: string | null | undefined): Read<T> => ({ data: null, error: bookingErrorCode(message) ?? "UNKNOWN" });

type Fn = Database["public"]["Functions"];

async function call<T>(fn: keyof Fn, args: Record<string, unknown>): Promise<Read<T>> {
  const db = await createClient();
  // Argument shapes: src/types/database.ts (Functions).
  const { data, error } = await db.rpc(fn, args as never);
  return error ? bad(error.message) : ok(data as unknown as T);
}

export type CatalogService = {
  id: string; slug: string; name: string; kind: ServiceKind; session_type: "individual" | "group"; is_active: boolean;
  billing_category: string; price: number; currency: string; duration_min: number; max_participants: number; min_participants: number;
  venue_id: string | null; venue_name: string | null; default_venue_space_id: string | null; default_venue_space_name: string | null;
  location_text: string | null; credits_required: number; coaches: { id: string; display_name: string }[];
  bookable_by_families?: boolean;
  packages: { id: string; name: string }[]; setup_missing: SetupMissingCode[]; number_prefix: string | null;
};

/** Services for the booking form (admin / finance): kind, price, eligible coaches, setup_missing. */
export function getServiceCatalog(opts: { includeInactive?: boolean } = {}) {
  return call<CatalogService[]>("training_service_catalog", { p_include_inactive: opts.includeInactive ?? false });
}

export type BookingFilters = {
  from?: string; to?: string; status?: string; billingStatus?: string; coachId?: string; serviceId?: string;
  athleteId?: string; payerId?: string; search?: string; limit?: number; offset?: number;
};

export function listBookings(f: BookingFilters = {}) {
  const filters: Record<string, unknown> = {
    from: f.from, to: f.to, status: f.status, billing_status: f.billingStatus, coach_id: f.coachId, service_id: f.serviceId,
    athlete_id: f.athleteId, payer_id: f.payerId, search: f.search, limit: f.limit, offset: f.offset,
  };
  for (const k of Object.keys(filters)) if (filters[k] === undefined || filters[k] === "") delete filters[k];
  return call<{ rows: BookingRow[]; total: number; limit: number; offset: number }>("booking_list", { p_filters: filters as Json });
}

export const getBooking = (bookingId: string) => call<BookingDetail>("booking_detail", { p_booking: bookingId });
export const getBookingsToInvoice = (limit = 100) => call<BookingRow[]>("bookings_to_invoice", { p_limit: limit });
export const getAthleteBookingHistory = (athleteId: string) =>
  call<{ upcoming: BookingRow[]; past: BookingRow[] }>("athlete_booking_history", { p_athlete: athleteId });
export const getBookingDashboardCounts = () => call<DashboardCounts>("booking_dashboard_counts", {});
export type RequestFollowup = {
  booking_id: string; athlete_name: string; service_name: string; coach_name: string | null; starts_at: string;
  requested_at: string; source: "staff" | "family" | null; hours_waiting: number;
};
export const getBookingFollowups = (limit = 100) =>
  call<{ notifications: Record<string, unknown>[]; invoice_emails: Record<string, unknown>[]; requests?: RequestFollowup[];
         request_followup_hours?: number }>("booking_followups", { p_limit: limit });
export const getInvoicePreview = (bookingId: string) => call<Record<string, unknown>>("booking_invoice_preview", { p_booking: bookingId });
export const getPayerCandidates = (athleteId: string) =>
  call<{ payers: Record<string, unknown>[]; guardians: Record<string, unknown>[]; family_default: PayerSnapshot }>(
    "billing_payer_candidates", { p_athlete: athleteId });

/** Sessions the signed-in coach leads (admins may pass a coach). Roster names only. */
export const getCoachAgenda = (range: { from?: string | null; to?: string | null; coachId?: string | null } = {}) =>
  call<CoachAgendaSession[]>("coach_booking_agenda", { p_from: range.from ?? null, p_to: range.to ?? null, p_coach: range.coachId ?? null });

/** Requests waiting for the signed-in coach (admins: one coach, or the club with no coach). Names and times only. */
export const getCoachBookingRequests = (coachId?: string | null) =>
  call<CoachBookingRequest[]>("coach_booking_requests", { p_coach: coachId ?? null });

/** What a guardian may request for their own child: services, coaches, open group sessions, package coverage. */
export const getFamilyBookingCatalog = (athleteId: string) => call<FamilyCatalog>("family_booking_catalog", { p_athlete: athleteId });

/** Event ids (of the given ones) whose booked session only holds requests (calendar style). */
export async function getPendingSessionEvents(eventIds: string[]): Promise<Set<string>> {
  if (!eventIds.length) return new Set();
  const db = await createClient();
  const { data } = await db.rpc("session_events_pending", { p_events: eventIds.slice(0, 1000) });
  return new Set(((data ?? []) as unknown as string[]).map(String));
}

/** Guardian portal: own children (or one child). Invoices only where the guardian is the payer. */
export const getGuardianBookings = (athleteId?: string | null) =>
  call<PortalBookings[]>("guardian_booking_overview", { p_athlete: athleteId ?? null });

/** Player portal: own bookings and attendance, no money. */
export const getPlayerBookings = () => call<PortalBookings>("player_booking_overview", {});

/** Finance totals per revenue category and billing entity (existing billing read). */
export const getBookingFinanceTotals = getInvoiceTotalsByCategory;
