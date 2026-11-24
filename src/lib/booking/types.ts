import { z } from "zod";

/*
 * Booking workflow — shared contract (client + server safe, no I/O).
 * Schema: supabase/migrations/20250420104400_booking_workflow.sql.
 * Full contract: docs/booking-workflow.md.
 */

export const SERVICE_KINDS = ["private", "group", "trial", "package"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

/** Database booking status (training_bookings.status). */
export const BOOKING_STATUSES = ["requested", "booked", "completed", "no_show", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
/** Status shown to people: "booked" is a confirmed booking. */
export const BOOKING_STATES = ["requested", "confirmed", "completed", "no_show", "cancelled"] as const;
export type BookingState = (typeof BOOKING_STATES)[number];

/** Billing status, derived from the billing mode, the invoice and its payments. */
export const BILLING_STATUSES = [
  "awaiting_confirmation", "not_billable", "package", "to_invoice", "invoice_draft", "invoiced", "partially_paid", "paid", "credited",
] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

export const BILLING_CHOICES = ["auto", "invoice", "package", "free"] as const;
export type BillingChoice = (typeof BILLING_CHOICES)[number];
export const BILLING_MODES = ["invoice", "package", "free", "credits"] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export const REFUND_MODES = ["none", "cancel_invoice", "credit_note"] as const;
export type RefundMode = (typeof REFUND_MODES)[number];

export const PAYER_KINDS = ["athlete", "guardian", "sponsor", "other"] as const;
export type PayerKind = (typeof PAYER_KINDS)[number];

export const NOTIFICATION_KINDS = [
  "confirmed", "rescheduled", "cancelled", "requested", "request_confirmed", "request_declined", "request_withdrawn",
] as const;
export type BookingNotificationKind = (typeof NOTIFICATION_KINDS)[number];
export const NOTIFICATION_STATUSES = ["pending", "sending", "sent", "failed", "no_contact", "skipped"] as const;
export type BookingNotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
export const RECIPIENT_KINDS = ["payer", "guardian", "family", "coach", "player", "admin"] as const;

/** Club setting app_settings.settings.booking.availability_mode (default "declared"). */
export const AVAILABILITY_MODES = ["declared", "open_confirm"] as const;
export type AvailabilityMode = (typeof AVAILABILITY_MODES)[number];
/** Default hours after which an unanswered request is listed in the booking follow-ups. */
export const DEFAULT_REQUEST_FOLLOWUP_HOURS = 48;
export type RequestSource = "staff" | "family";
export type RequestDecision = "confirmed" | "declined" | "withdrawn";
export type RecipientKind = (typeof RECIPIENT_KINDS)[number];

/** Delivery attempts of one notification row before it needs staff follow-up (= SQL claim limit). */
export const NOTIFICATION_MAX_ATTEMPTS = 5;

/** Codes the booking RPCs raise (or return as `code`). Translations: bookingWorkflow.errors.<CODE>. */
export const BOOKING_ERROR_CODES = [
  "NOT_AUTHORIZED", "REQUEST_ID_REQUIRED", "REQUEST_ID_REUSED", "ATHLETE_NOT_FOUND", "ATHLETE_ARCHIVED", "SERVICE_NOT_FOUND",
  "SERVICE_INACTIVE", "SESSION_NOT_FOUND", "SESSION_SERVICE_MISMATCH", "SESSION_NOT_SCHEDULED", "SESSION_FULL",
  "INVALID_TIME", "COACH_REQUIRED", "COACH_NOT_FOUND", "COACH_NOT_ELIGIBLE", "COACH_UNAVAILABLE", "COACH_BUSY",
  "SPACE_NOT_FOUND", "SPACE_TAKEN", "ALREADY_BOOKED", "ATHLETE_OVERLAP", "OVERRIDE_NOT_ALLOWED", "OVERRIDE_REASON_REQUIRED",
  "NOTE_TOO_LONG", "PAYER_NOT_FOUND", "INVALID_BILLING", "PACKAGE_REQUIRED", "PACKAGE_NOT_AVAILABLE", "INVALID_PRICE",
  "PRICE_OVERRIDE_REASON_REQUIRED", "BOOKING_NOT_FOUND", "BOOKING_NOT_ACTIVE", "BOOKING_NOT_CANCELLABLE",
  "BOOKING_ATTENDED", "ALREADY_CANCELLED", "SAME_SLOT", "REASON_REQUIRED", "REASON_TOO_LONG", "INVALID_REFUND_MODE",
  "NOT_BILLABLE", "NOT_INVOICED", "SETUP_MISSING", "NOTIFICATION_NOT_FOUND", "NOT_RETRYABLE", "SESSION_EVENT_MANAGED",
  "NAME_REQUIRED", "DOB_REQUIRED", "INVALID_DOB", "INVALID_EMAIL", "GUARDIAN_REQUIRED", "GUARDIAN_NOT_FOUND",
  "GUARDIAN_NAME_REQUIRED", "GUARDIAN_CONTACT_REQUIRED", "FAMILY_NOT_FOUND", "DUPLICATE_SUSPECTED", "INVALID_PAYER_KIND",
  "PAYER_NAME_REQUIRED", "INVALID_COUNTRY", "PROFILE_NOT_FOUND", "ATHLETE_REQUIRED", "CROSS_ORG_REFERENCE",
  // money functions reused by cancel / reschedule / payments
  "HAS_PAYMENTS", "CANNOT_CANCEL", "CREDIT_EXCEEDS_AMOUNT_DUE", "INVALID_AMOUNT", "INVALID_METHOD", "INVOICE_CANCELLED",
  "INVALID_DATE",
  // booking requests (20250420104700)
  "VENUE_CLOSED", "REQUEST_PENDING", "NOT_A_REQUEST", "BOOKING_REQUEST_MANAGED", "BOOKINGS_DISABLED", "SLOT_IN_PAST",
  "PROMO_UNKNOWN_CODE", "PROMO_OUT_OF_SCOPE", "PROMO_NOT_YET_VALID", "PROMO_EXPIRED", "PROMO_CURRENCY_MISMATCH",
  "PROMO_LIMIT_REACHED", "PROMO_FAMILY_LIMIT_REACHED", "PROMO_NOT_COMBINABLE", "PROMO_NOT_APPLICABLE",
  "PROMO_WITH_PRICE_OVERRIDE", "PROMO_CHANGED",
  // booking orders (20250420104800)
  "OPTION_REQUIRED", "OPTION_NOT_OFFERED", "PACKAGE_NOT_FOUND", "PRICING_MISSING", "DESCRIPTION_TOO_LONG", "DUPLICATE_DATE",
  "TOO_MANY_DATES", "SINGLE_ONE_DATE", "DATES_REQUIRED", "PACKAGE_TOO_MANY_DATES", "TOO_MANY_PARTICIPANTS", "ONE_ATHLETE_ONLY",
  "DUPLICATE_ATHLETE", "PARTICIPANT_DATE_UNKNOWN", "PARTICIPANT_NO_DATES", "DATE_WITHOUT_PLAYERS", "ORDER_DATES_OVERLAP",
  "DATES_UNAVAILABLE", "ORDER_NOT_FOUND", "ORDER_NOT_ACTIVE", "ORDER_SINGLE_DATE", "CATEGORY_MIXED", "CURRENCY_MIXED",
  "INVOICE_SHARED", "ORDER_INVOICING", "INVALID_SCOPE", "NOTHING_TO_CANCEL", "NOTHING_TO_RESCHEDULE", "INVALID_PRICING_BASIS",
  "TOO_MANY_PACKAGES", "DUPLICATE_PACKAGE", "INVALID_PACKAGE", "INVOICE_IS_DRAFT", "USE_CANCEL",
  // Service instalments (20250420105400_service_instalments.sql)
  "INSTALMENTS_NOT_ALLOWED", "INSTALMENTS_OUT_OF_RANGE", "INSTALMENT_DATES_INVALID", "INSTALMENTS_NOTHING_TO_SPLIT",
] as const;
export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[number];

/** Non-blocking findings of a quote / confirm / reschedule. Translations: bookingWorkflow.warnings.<CODE>. */
export const BOOKING_WARNING_CODES = [
  "ATHLETE_OVERLAP", "AVAILABILITY_OVERRIDDEN", "COACH_NOT_ELIGIBLE_OVERRIDDEN", "COACH_TEAM_EVENT_OVERLAP", "SLOT_IN_PAST",
  "VENUE_CLOSED_OVERRIDDEN", "NEEDS_COACH_CONFIRMATION",
] as const;
export type BookingWarningCode = (typeof BOOKING_WARNING_CODES)[number];

/** Why a paid service cannot be invoiced yet. Translations: bookingWorkflow.setup.<CODE>. */
export const SETUP_MISSING_CODES = ["BILLING_CATEGORY_MISSING", "BILLING_ENTITY_MISSING", "NUMBER_SERIES_MISSING"] as const;
export type SetupMissingCode = (typeof SETUP_MISSING_CODES)[number];

/** The booking error code inside a database error message, if any. */
export function bookingErrorCode(message: string | null | undefined): BookingErrorCode | null {
  const m = message ?? "";
  for (const code of BOOKING_ERROR_CODES) if (new RegExp(`\\b${code}\\b`).test(m)) return code;
  return null;
}

// ---------------------------------------------------------------------------
// Payload schemas (server actions validate with these; the RPCs re-check).
// ---------------------------------------------------------------------------
const uuid = z.string().uuid();
const optUuid = uuid.nullish();
const isoInstant = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid_time");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullish().transform((v) => (v ? v : null));
const money = z.coerce.number().finite().min(0).max(100000);
const promoCode = z.string().trim().toUpperCase().max(40).regex(/^[A-Z0-9_-]*$/).nullish().transform((v) => (v ? v : null));

export const bookingPayloadSchema = z.object({
  athleteId: uuid,
  serviceId: uuid,
  coachId: optUuid,
  /** Join an existing session (group) instead of a new slot. */
  sessionId: optUuid,
  /** Start instant (ISO, UTC); the duration comes from the service. */
  startsAt: isoInstant.nullish(),
  venueSpaceId: optUuid,
  payerId: optUuid,
  billing: z.enum(BILLING_CHOICES).default("auto"),
  purchaseId: optUuid,
  /** Price override (finance staff); needs priceReason. */
  price: money.nullish(),
  priceReason: optText(500),
  /** Availability / eligibility override (admins); needs overrideReason. */
  overrideAvailability: z.boolean().default(false),
  overrideReason: optText(500),
  notes: optText(2000),
  notify: z.boolean().default(true),
  /** Promo code (shared discount engine); single paid sessions at list price only. */
  promoCode,
}).refine((v) => Boolean(v.sessionId) || (Boolean(v.coachId) && Boolean(v.startsAt)), { message: "slot_required", path: ["startsAt"] });
export type BookingPayloadInput = z.input<typeof bookingPayloadSchema>;
export type BookingPayload = z.output<typeof bookingPayloadSchema>;

export const reschedulePayloadSchema = z.object({
  bookingId: uuid,
  coachId: optUuid,
  sessionId: optUuid,
  startsAt: isoInstant.nullish(),
  venueSpaceId: optUuid,
  price: money.nullish(),
  priceReason: optText(500),
  overrideAvailability: z.boolean().default(false),
  overrideReason: optText(500),
  notify: z.boolean().default(true),
}).refine((v) => Boolean(v.sessionId) || Boolean(v.startsAt), { message: "slot_required", path: ["startsAt"] });
export type ReschedulePayloadInput = z.input<typeof reschedulePayloadSchema>;

/** Family request (parent portal): own child, family payer, auto billing, no overrides. */
export const familyRequestSchema = z.object({
  athleteId: uuid,
  serviceId: uuid,
  coachId: optUuid,
  sessionId: optUuid,
  startsAt: isoInstant.nullish(),
  notes: optText(1000),
  promoCode,
}).refine((v) => Boolean(v.sessionId) || Boolean(v.startsAt), { message: "slot_required", path: ["startsAt"] });
export type FamilyRequestInput = z.input<typeof familyRequestSchema>;

export const declinePayloadSchema = z.object({
  bookingId: uuid,
  reason: text(500).min(1),
  notify: z.boolean().default(true),
});
export type DeclinePayloadInput = z.input<typeof declinePayloadSchema>;

export const cancelPayloadSchema = z.object({
  bookingId: uuid,
  reason: text(500).min(1),
  refundMode: z.enum(REFUND_MODES).default("none"),
  /** null = club policy (cancellation hours); true / false = staff decision. */
  restorePackage: z.boolean().nullish(),
  notify: z.boolean().default(true),
});
export type CancelPayloadInput = z.input<typeof cancelPayloadSchema>;

export const payerSchema = z.object({
  id: optUuid,
  kind: z.enum(PAYER_KINDS),
  profileId: optUuid,
  familyId: optUuid,
  athleteId: optUuid,
  name: text(140).min(1),
  email: z.string().trim().email().max(254).nullish().or(z.literal("")).transform((v) => v || null),
  phone: optText(40),
  street: optText(140),
  postalCode: optText(16),
  city: optText(80),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullish().or(z.literal("")).transform((v) => v || null),
  notes: optText(1000),
  isActive: z.boolean().optional(),
});
export type PayerInput = z.input<typeof payerSchema>;

export const quickCreateSchema = z.object({
  firstName: text(80).min(1),
  lastName: text(80).min(1),
  /** Required for every athlete (the schema stores dob; it decides whether a guardian is needed). */
  dob: isoDate,
  gender: optText(40),
  email: z.string().trim().email().max(254).nullish().or(z.literal("")).transform((v) => v || null),
  phone: optText(40),
  familyId: optUuid,
  guardianProfileId: optUuid,
  newFamily: z.object({
    name: optText(120),
    contactName: text(140).min(1),
    contactEmail: z.string().trim().email().max(254).nullish().or(z.literal("")).transform((v) => v || null),
    contactPhone: optText(40),
    street: optText(140),
    postalCode: optText(12),
    city: optText(80),
  }).nullish(),
  createPayer: payerSchema.partial({ name: true, kind: true }).nullish(),
  confirmDuplicate: z.boolean().default(false),
});
export type QuickCreateInput = z.input<typeof quickCreateSchema>;

// ---------------------------------------------------------------------------
// RPC payload mappers (camelCase form values -> snake_case RPC JSON)
// ---------------------------------------------------------------------------
const compact = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

export function toBookingRpcPayload(p: BookingPayload): Record<string, unknown> {
  return compact({
    athlete_id: p.athleteId, service_id: p.serviceId, coach_id: p.coachId, session_id: p.sessionId,
    starts_at: p.startsAt ? new Date(p.startsAt).toISOString() : null, venue_space_id: p.venueSpaceId, payer_id: p.payerId,
    billing: p.billing, purchase_id: p.purchaseId, price: p.price, price_reason: p.priceReason,
    override_availability: p.overrideAvailability || null, override_reason: p.overrideReason, notes: p.notes,
    notify: p.notify, promo_code: p.promoCode,
  });
}

export function toFamilyRequestRpcPayload(p: z.output<typeof familyRequestSchema>): Record<string, unknown> {
  return compact({
    athlete_id: p.athleteId, service_id: p.serviceId, coach_id: p.coachId, session_id: p.sessionId,
    starts_at: p.startsAt ? new Date(p.startsAt).toISOString() : null, notes: p.notes, promo_code: p.promoCode,
  });
}

export function toPayerRpcPayload(p: Partial<z.output<typeof payerSchema>>): Record<string, unknown> {
  return compact({
    id: p.id, kind: p.kind, profile_id: p.profileId, family_id: p.familyId, athlete_id: p.athleteId, name: p.name,
    email: p.email, phone: p.phone, street: p.street, postal_code: p.postalCode, city: p.city, country: p.country,
    notes: p.notes, is_active: p.isActive,
  });
}

export function toQuickCreateRpcPayload(p: z.output<typeof quickCreateSchema>): Record<string, unknown> {
  return compact({
    first_name: p.firstName, last_name: p.lastName, dob: p.dob, gender: p.gender, email: p.email, phone: p.phone,
    family_id: p.familyId, guardian_profile_id: p.guardianProfileId,
    new_family: p.newFamily ? compact({
      name: p.newFamily.name, contact_name: p.newFamily.contactName, contact_email: p.newFamily.contactEmail,
      contact_phone: p.newFamily.contactPhone, street: p.newFamily.street, postal_code: p.newFamily.postalCode, city: p.newFamily.city,
    }) : null,
    create_payer: p.createPayer ? toPayerRpcPayload(p.createPayer) : null,
    confirm_duplicate: p.confirmDuplicate || null,
  });
}

// ---------------------------------------------------------------------------
// RPC result shapes
// ---------------------------------------------------------------------------
export type BookingWarning = { code: BookingWarningCode; bookings?: { booking_id: string; starts_at: string }[] };

export type BookingQuote = {
  ok: boolean;
  errors: string[];
  warnings: BookingWarning[];
  slot: {
    session_id: string | null; coach_id: string | null; starts_at: string | null; ends_at: string | null;
    venue_id: string | null; venue_space_id: string | null; capacity: number | null; participants: number; places_left: number | null;
    within_availability?: boolean; needs_confirmation?: boolean; session_pending?: boolean; availability_mode?: AvailabilityMode;
  };
  billing: {
    billing_mode: BillingMode; price: number; list_price: number; currency: string; price_override: boolean;
    purchase_id: string | null; package_remaining: number | null; billing_status: BillingStatus; setup_missing: SetupMissingCode[];
    discount_total?: number; discount_lines?: DiscountLine[]; promo?: "none" | "applied" | "rejected"; promo_code?: string | null;
  };
  /** What confirming creates: a confirmed booking, or a request the coach confirms. */
  creates?: "booked" | "requested";
  service: { id: string; name: string; kind: ServiceKind; duration_min: number; billing_category: string; max_participants: number };
  billing_entity: { id: string; name: string } | null;
  number_prefix: string | null;
  payer: PayerSnapshot;
};

export type DiscountLine = { discount_id: string; name: string; rule: string; code: string | null; kind: string; value: number; amount: number };

export type PayerSnapshot = {
  payer_id: string | null; kind: PayerKind | "family"; invoice_payer_kind: "guardian" | "family" | "sponsor" | "other";
  profile_id: string | null; name: string | null; email: string | null; phone: string | null;
  address: { street: string | null; postal_code: string | null; city: string | null; country: string | null };
  has_account: boolean;
};

export type ConfirmResult = {
  ok: true; booking_id: string; session_id: string; event_id: string; starts_at: string; ends_at: string; coach_id: string;
  billing_mode: BillingMode; billing_status: BillingStatus; price: number; currency: string; purchase_id: string | null;
  invoice_id: string | null; warnings: BookingWarning[]; setup_missing: SetupMissingCode[]; replayed: boolean;
  status?: "booked" | "requested"; requested?: boolean; discount_total?: number;
};

export type RequestDecisionResult = {
  ok: true; booking_id: string; status: BookingStatus; session_id?: string | null; session_status?: string | null;
  package_restored?: boolean; billing_status?: BillingStatus; already_decided?: boolean; replayed?: boolean;
};

export type FamilyCatalogService = {
  id: string; name: string; kind: ServiceKind; duration_min: number; price: number; currency: string; max_participants: number;
  venue_name: string | null; coaches: { id: string; display_name: string }[]; package_remaining: number;
  sessions: { session_id: string; starts_at: string; ends_at: string; coach_id: string; coach_name: string | null; places_left: number; pending: boolean }[];
};

export type FamilyCatalog = {
  athlete: { id: string; first_name: string; last_name: string };
  timezone: string;
  availability_mode: AvailabilityMode;
  enabled: boolean;
  services: FamilyCatalogService[];
};

export type FamilyQuote = {
  ok: boolean; errors: string[]; warnings: BookingWarning[]; creates: "requested";
  slot: { session_id: string | null; coach_id: string | null; coach_name: string | null; starts_at: string | null; ends_at: string | null;
          places_left: number | null; capacity: number | null; within_availability: boolean };
  billing: { billing_mode: BillingMode | null; price: number | null; list_price: number | null; currency: string | null;
             package_remaining: number | null; discount_total: number | null; promo: "none" | "applied" | "rejected" | null; promo_code: string | null };
  service: { id: string; name: string; kind: ServiceKind; duration_min: number };
};

export type FamilyRequestResult = {
  ok: true; booking_id: string; status: "requested"; session_id: string; starts_at: string; ends_at: string; coach_id: string;
  billing_mode: BillingMode; price: number; currency: string; discount_total: number; replayed?: boolean;
};

export type CoachBookingRequest = {
  booking_id: string; session_id: string | null; event_id: string | null; service_id: string; service_name: string; kind: ServiceKind;
  coach_id: string; coach_name: string | null; starts_at: string; ends_at: string | null; location: string | null;
  athlete_first_name: string; athlete_last_name: string; source: RequestSource | null; requested_at: string | null; stale: boolean;
  participants_count: number; capacity: number | null;
};

export type InvoiceResult =
  | { ok: true; invoice_id: string; number: string; status: string; total?: number; currency?: string; activity?: string;
      already_invoiced?: boolean; replayed?: boolean; send?: boolean }
  | { ok: false; code: "SETUP_MISSING"; setup_missing: SetupMissingCode[] };

export type QuickCreateResult =
  | { ok: true; athlete_id: string; family_id: string; created_family: boolean; payer_id: string | null; is_minor: boolean; replayed: boolean }
  | { ok: false; code: "DUPLICATE_SUSPECTED"; candidates: DuplicateAthlete[] };

export type DuplicateAthlete = {
  id: string; first_name: string; last_name: string; dob: string; family_id: string; family_name: string | null;
  archived: boolean; score: number; reason: "NAME_DOB" | "NAME" | "NAME_SWAPPED" | "LAST_NAME_DOB" | "FIRST_NAME_DOB" | "NAME_SIMILAR";
};

export type DuplicateCheck = {
  athletes: DuplicateAthlete[];
  payers: { id: string; kind: PayerKind; name: string; email: string | null; family_id: string | null; reason: "EMAIL" | "NAME" }[];
  families: { id: string; name: string; contact_name: string | null; reason: "EMAIL" }[];
  guardians: { profile_id: string; full_name: string | null; family_id: string; reason: "EMAIL" }[];
};

export type BookingRow = {
  booking_id: string; status: BookingStatus; state: BookingState; billing_status: BillingStatus; billing_mode: BillingMode | null;
  slot_start: string; slot_end: string | null; created_via: "legacy" | "workflow"; created_at: string;
  /** The booking order this booking belongs to (20250420104800), if any. */
  order_id?: string | null;
  service: { id: string; name: string; kind: ServiceKind; billing_category: string };
  coach: { id: string; display_name: string };
  athlete: { id: string; first_name: string; last_name: string; family_id: string };
  payer: { id: string; kind: PayerKind; name: string } | null;
  session: { id: string; event_id: string | null; status: "scheduled" | "cancelled" | "completed"; capacity: number; participants: number;
             rescheduled_from: string | null } | null;
  location: string | null; price: number | null; list_price: number | null; currency: string; price_override_reason: string | null;
  invoice: { id: string; number: string; status: string; due_date: string | null; total: number; paid: number; balance: number } | null;
  warnings: BookingWarning[]; cancel_reason: string | null; cancelled_at: string | null;
  discount_total?: number; promo_code?: string | null;
  request?: { source: RequestSource | null; requested_at: string; requested_by_name: string | null; decision: RequestDecision | null;
              decided_at: string | null; decided_by_name: string | null; stale: boolean } | null;
  /** Finalized attendance mirrored on the booking: present / late / excused / unexcused. */
  attendance_status?: "present" | "late" | "excused" | "unexcused" | null;
};

export type BookingDetail = BookingRow & {
  notes: string | null; availability_override_reason: string | null; recipient: PayerSnapshot;
  participants: { booking_id: string; athlete_id: string; first_name: string; last_name: string; status: BookingStatus }[];
  entitlement: { purchase_id: string; consumed_at: string; restored_at: string | null; sessions: number; sessions_used: number } | null;
  attendance: { sheet_status: string; status: string | null; finalized_status: string | null } | null;
  notifications: { id: string; kind: BookingNotificationKind; recipient_kind: RecipientKind; recipient_name: string | null;
                   recipient_email: string | null; status: BookingNotificationStatus; attempts: number; last_error: string | null;
                   sent_at: string | null; created_at: string }[];
  invoice_deliveries: { email_log_id: string; to_email: string; status: string; error: string | null; attempts: number;
                        sent_at: string | null; created_at: string }[];
  invoice_preview: Record<string, unknown> | null;
  can_decide?: boolean;
  discounts?: { name: string; code: string | null; amount: number; currency: string; invoice_id: string | null; voided_at: string | null }[];
  absence_report?: { report_id: string; status: string; reason_category: string; created_at: string } | null;
};

export type CoachAgendaSession = {
  session_id: string; event_id: string | null; service_id: string; service_name: string; kind: ServiceKind;
  starts_at: string; ends_at: string; status: string; rescheduled_from: string | null; location: string | null;
  venue_space: string | null; capacity: number; participants_count: number; sheet_status: string | null;
  /** Only requests so far (awaiting the coach). */
  pending?: boolean; requests_count?: number;
  participants: { athlete_id: string; first_name: string; last_name: string; booking_status: BookingStatus }[];
};

export type PortalBookings = {
  athlete: { id: string; first_name: string; last_name: string };
  upcoming: { booking_id: string; service_name: string; coach_name: string | null; starts_at: string; ends_at: string | null;
              status: BookingStatus; rescheduled_from: string | null; rescheduled_at: string | null; location: string | null;
              awaiting_confirmation?: boolean; can_withdraw?: boolean; requested_at?: string | null; event_id?: string | null;
              can_report_absence?: boolean; absence_report?: { report_id: string; status: string; reason_category: string } | null }[];
  changes: { booking_id: string; service_name: string; starts_at: string; change: "cancelled" | "rescheduled" | "declined" | "withdrawn"; at: string }[];
  attendance: { event_id: string; service_name: string; starts_at: string; status: string; booking_status?: BookingStatus | null }[];
  /** Only invoices the viewer may see as the payer (always empty for players). */
  invoices: { invoice_id: string; number: string; status: string; due_date: string | null; currency: string; total: number;
              balance: number; booking_id: string | null; service_name: string; starts_at?: string | null }[];
};

export type DashboardCounts = {
  today: number; next_7_days: number; awaiting_invoice: number; failed_notifications: number;
  awaiting_confirmation?: number; stale_requests?: number;
  outstanding: { currency: string; amount: number; count: number }[];
};
