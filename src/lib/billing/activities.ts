/**
 * Revenue categories ("billing activities") and error codes — pure and
 * client-safe.
 *
 * Every invoice belongs to exactly one category (public.invoices.activity,
 * migration 20250420103500_billing_foundation.sql) and one issuing entity.
 * Money never crosses categories: payments belong to one invoice, family
 * credit is scoped to a category, a receipt books one payment per invoice.
 *
 *   club_membership  "Club Membership": season fee (memberships, membership_payers)
 *   selection        selection programmes; label = programme series (e.g. "EYBL")
 *   training         "Private Training": training packages AND paid training bookings
 *   shop             "Shop": shop orders (kit deposits are billed here too)
 *   camp             "Camps": camps and camp registrations
 *   other            legacy only: rows no rule identifies; never selectable for a
 *                    new invoice; each one is on the review list (data_review_flags)
 *
 * Numbers: per org and category, invoice_number_series.prefix gives
 * "<prefix>-<YYYY>-<NNNN>" at issue (drafts carry a provisional DRAFT- number);
 * without a series the org's existing invoice pattern stays.
 */
export const BILLING_ACTIVITIES = ["club_membership", "selection", "training", "shop", "camp", "other"] as const;
export type BillingActivity = (typeof BILLING_ACTIVITIES)[number];

/** Categories a user may choose for a new invoice (never "other"). */
export const SELECTABLE_CATEGORIES = ["club_membership", "selection", "training", "shop", "camp"] as const;
export type RevenueCategory = (typeof SELECTABLE_CATEGORIES)[number];
/** Categories a manual invoice may use (club fees go through the membership flow). */
export const MANUAL_INVOICE_CATEGORIES = ["selection", "training", "shop", "camp"] as const;

export const isBillingActivity = (v: unknown): v is BillingActivity =>
  typeof v === "string" && (BILLING_ACTIVITIES as readonly string[]).includes(v);

/** Translation key of a category label (selection invoices print the programme series instead when known). */
export const categoryLabelKey = (activity: string): `billing.activities.${BillingActivity}` =>
  `billing.activities.${isBillingActivity(activity) ? activity : "other"}`;

/** How an invoice got its activity. */
export const ACTIVITY_SOURCES = ["migration_rule", "migration_default", "set", "derived", "default", "linked"] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

/** How an invoice got its issuing entity. */
export type BillingEntitySource = "route" | "default" | "set" | "migration_default";

export const PAYER_KINDS = ["guardian", "family", "sponsor", "other"] as const;
export type PayerKind = (typeof PAYER_KINDS)[number];

export const CHARGE_KINDS = ["season_fee", "carry_forward", "adjustment"] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];

export const RECEIPT_STATUSES = ["open", "partially_allocated", "allocated", "void"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

/**
 * Error codes raised by the billing RPCs; each has a message under
 * billing.errors.<CODE> in every catalog. Order matters only for codes that
 * contain another code (none today).
 */
export const BILLING_ERROR_CODES = [
  "NOT_AUTHORIZED", "REQUEST_ID_REQUIRED", "INVALID_ACTIVITY", "ACTIVITY_MISMATCH", "ACTIVITY_LOCKED", "CREDIT_LINKED",
  "BILLING_ENTITY_LOCKED", "BILLING_ENTITY_NOT_FOUND", "INVALID_BILLING_ENTITY", "INVALID_IBAN", "NAME_REQUIRED",
  "DEFAULT_REQUIRED", "DEFAULT_MUST_BE_ACTIVE", "MEMBERSHIP_REQUIRED", "CROSS_ORG_REFERENCE",
  "INVALID_SETTINGS", "SETTINGS_NOT_FOUND", "SEASON_NOT_FOUND", "INVALID_INSTALLMENT_COUNT", "INVALID_DUE_DAY",
  "INVALID_FIRST_DUE_MONTH", "SCHEDULE_AFTER_SEASON_END", "SCHEDULE_BEFORE_SEASON_START",
  "ATHLETE_NOT_FOUND", "FAMILY_NOT_FOUND", "INVALID_AMOUNT", "INVALID_CURRENCY", "INVALID_SHARE", "SHARES_MISMATCH",
  "PAYERS_REQUIRED", "TOO_MANY_PAYERS", "ZERO_SHARE", "INVALID_PAYER", "PAYER_NOT_GUARDIAN", "PAYER_NAME_REQUIRED",
  "DUPLICATE_PAYER", "ALREADY_MEMBER", "MEMBERSHIP_NOT_FOUND", "MEMBERSHIP_CANCELLED", "CARRY_FORWARD_MISMATCH",
  "CARRY_FORWARD_SEASON_ORDER", "REASON_REQUIRED", "USE_MEMBERSHIP_ISSUE",
  "RECEIPT_NOT_FOUND", "RECEIPT_VOID", "RECEIPT_HAS_ALLOCATIONS", "RECEIPT_PAYMENT_LOCKED", "INVALID_ALLOCATION",
  "DUPLICATE_ALLOCATION", "ALLOCATION_EXCEEDS_BALANCE", "ALLOCATION_EXCEEDS_RECEIPT", "INSTALLMENT_NOT_FOUND",
  "INVOICE_NOT_FOUND", "INVOICE_NOT_PAYABLE", "CURRENCY_MISMATCH", "INVALID_METHOD", "INVALID_DATE",
  "ENTRY_NOT_FOUND", "ENTRY_ALREADY_BOOKED", "BANK_AMOUNT_MISMATCH", "BANK_ENTRY_NEEDS_ALLOCATION",
  "NO_CREDIT", "AMOUNT_TOO_HIGH", "CREDIT_NEGATIVE", "FLAG_NOT_FOUND", "PERIOD_CLOSED",
  "OTHER_NOT_ALLOWED", "CATEGORY_REQUIRED", "NUMBER_LOCKED", "INVALID_PREFIX", "PREFIX_IN_USE", "SEASON_DATES_INVALID",
] as const;
export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number];

/** First known billing error code in a database / validation message. */
export function billingErrorCode(message: string | null | undefined): BillingErrorCode | null {
  const m = message ?? "";
  for (const code of BILLING_ERROR_CODES) if (new RegExp(`\\b${code}\\b`).test(m)) return code;
  return null;
}

/** Instalment months of the club season: 1 = January … 12 = December. */
export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
