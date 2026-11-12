import { z } from "zod";
import { DISCOUNT_KINDS, DISCOUNT_RULES, DISCOUNT_SCOPES } from "@/lib/pricing/discounts";

/**
 * Validation for the camp admin (editions, price options, age groups, time
 * slots), discounts and the camp registration form. Pure: shared by server
 * actions and unit tests. Messages are i18n keys under `camps.errors.*`.
 */
const E = (k: string) => `camps.errors.${k}`;
const uuid = z.string().uuid(E("invalidRequest"));
const optUuid = z.union([z.literal(""), z.null(), uuid]).optional().transform((v) => v || null);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, E("invalidDate"));
const optInstant = z
  .union([z.literal(""), z.null(), z.string().refine((s) => !Number.isNaN(Date.parse(s)), E("invalidDate"))])
  .optional()
  .transform((v) => (v ? new Date(v).toISOString() : null));
const optText = (max: number) => z.string().trim().max(max, E("tooLong")).optional().default("").transform((v) => v || null);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, E("invalidTime"));
const optInt = (min: number, max: number, key: string) =>
  z.union([z.literal(""), z.null(), z.coerce.number().int(E(key)).min(min, E(key)).max(max, E(key))]).optional().transform((v) => (v === "" || v === undefined ? null : v));
const currency = z.union([z.literal(""), z.null(), z.string().regex(/^[A-Za-z]{3}$/, E("currency"))]).optional().transform((v) => (v ? v.toUpperCase() : null));

export const EDITION_STATUSES = ["draft", "published", "archived", "cancelled"] as const;

export const editionSchema = z
  .object({
    name: optText(120),
    startsOn: isoDate,
    endsOn: isoDate,
    venueId: optUuid,
    locationName: optText(200),
    address: optText(200),
    city: optText(100),
    capacity: optInt(1, 100000, "capacity"),
    registrationOpensAt: optInstant,
    registrationClosesAt: optInstant,
    status: z.enum(EDITION_STATUSES).default("draft"),
    notes: optText(2000),
  })
  .refine((v) => v.endsOn >= v.startsOn, { message: E("endBeforeStart"), path: ["endsOn"] })
  .refine((v) => (Date.parse(v.endsOn) - Date.parse(v.startsOn)) / 864e5 <= 62, { message: E("tooLong"), path: ["endsOn"] })
  .refine((v) => !v.registrationOpensAt || !v.registrationClosesAt || v.registrationClosesAt > v.registrationOpensAt,
    { message: E("windowOrder"), path: ["registrationClosesAt"] });
export type EditionInput = z.input<typeof editionSchema>;
export type EditionValues = z.output<typeof editionSchema>;

export function editionRow(v: EditionValues) {
  return {
    name: v.name, starts_on: v.startsOn, ends_on: v.endsOn, venue_id: v.venueId,
    location_name: v.venueId ? null : v.locationName, address: v.venueId ? null : v.address, city: v.city,
    capacity: v.capacity, registration_opens_at: v.registrationOpensAt, registration_closes_at: v.registrationClosesAt,
    status: v.status, notes: v.notes,
  };
}

export const priceOptionSchema = z.object({
  id: optUuid,
  editionId: optUuid,
  label: z.string().trim().min(1, E("labelRequired")).max(120, E("tooLong")),
  daysCount: z.coerce.number().int(E("days")).min(1, E("days")).max(63, E("days")),
  includesLunch: z.boolean().default(false),
  price: z.coerce.number({ invalid_type_error: E("price") }).min(0, E("price")).max(1_000_000, E("price")),
  currency,
  isActive: z.boolean().default(true),
  sort: z.coerce.number().int().min(0).max(10000).default(0),
});
export type PriceOptionInput = z.input<typeof priceOptionSchema>;

export const ageGroupSchema = z
  .object({
    id: optUuid,
    label: z.string().trim().min(1, E("labelRequired")).max(80, E("tooLong")),
    minAge: optInt(0, 99, "ageRange"),
    maxAge: optInt(0, 99, "ageRange"),
    timeSlotId: optUuid,
    isActive: z.boolean().default(true),
    sort: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .refine((v) => v.minAge === null || v.maxAge === null || v.maxAge >= v.minAge, { message: E("ageRange"), path: ["maxAge"] });
export type AgeGroupInput = z.input<typeof ageGroupSchema>;

export const timeSlotSchema = z
  .object({
    id: optUuid,
    editionId: optUuid,
    label: z.string().trim().min(1, E("labelRequired")).max(80, E("tooLong")),
    startsAt: time,
    endsAt: time,
    sort: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .refine((v) => v.endsAt.slice(0, 5) > v.startsAt.slice(0, 5), { message: E("timeOrder"), path: ["endsAt"] });
export type TimeSlotInput = z.input<typeof timeSlotSchema>;

export const discountSchema = z
  .object({
    name: z.string().trim().min(1, E("nameRequired")).max(120, E("tooLong")),
    description: optText(1000),
    kind: z.enum(DISCOUNT_KINDS),
    value: z.coerce.number({ invalid_type_error: E("value") }).positive(E("value")).max(1_000_000, E("value")),
    currency,
    scope: z.enum(DISCOUNT_SCOPES).default("all"),
    scopeProgramId: optUuid,
    scopeServiceId: optUuid,
    rule: z.enum(DISCOUNT_RULES),
    code: z.string().trim().max(40, E("code")).optional().default("").transform((v) => v.toUpperCase() || null),
    maxRedemptions: optInt(1, 1_000_000, "limit"),
    maxRedemptionsPerFamily: optInt(1, 1000, "limit"),
    validFrom: optInstant,
    validUntil: optInstant,
    siblingMinPosition: optInt(2, 20, "siblingPosition"),
    earlyBirdDaysBefore: optInt(0, 730, "daysBefore"),
    stackable: z.boolean().default(true),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.kind !== "percent" || v.value <= 100, { message: E("percent"), path: ["value"] })
  .refine((v) => v.kind !== "fixed_amount" || !!v.currency, { message: E("currency"), path: ["currency"] })
  .refine((v) => v.scope !== "program" || !!v.scopeProgramId, { message: E("scopeTarget"), path: ["scopeProgramId"] })
  .refine((v) => v.scope !== "service" || !!v.scopeServiceId, { message: E("scopeTarget"), path: ["scopeServiceId"] })
  .refine((v) => v.rule !== "promo_code" || (!!v.code && /^[A-Z0-9_-]{3,40}$/.test(v.code)), { message: E("code"), path: ["code"] })
  .refine((v) => v.rule !== "early_bird" || !!v.validUntil || v.earlyBirdDaysBefore !== null, { message: E("earlyBird"), path: ["validUntil"] })
  .refine((v) => !v.validFrom || !v.validUntil || v.validUntil > v.validFrom, { message: E("windowOrder"), path: ["validUntil"] });
export type DiscountInput = z.input<typeof discountSchema>;
export type DiscountValues = z.output<typeof discountSchema>;

export function discountRow(v: DiscountValues) {
  return {
    name: v.name, description: v.description, kind: v.kind, value: v.value,
    currency: v.kind === "fixed_amount" ? v.currency : null,
    scope: v.scope,
    scope_program_id: v.scope === "program" ? v.scopeProgramId : null,
    scope_service_id: v.scope === "service" ? v.scopeServiceId : null,
    rule: v.rule,
    code: v.rule === "promo_code" ? v.code : null,
    max_redemptions: v.rule === "promo_code" ? v.maxRedemptions : null,
    max_redemptions_per_family: v.rule === "promo_code" ? v.maxRedemptionsPerFamily : null,
    valid_from: v.validFrom, valid_until: v.validUntil,
    sibling_min_position: v.rule === "sibling" ? (v.siblingMinPosition ?? 2) : null,
    early_bird_days_before: v.rule === "early_bird" ? v.earlyBirdDaysBefore : null,
    stackable: v.stackable, is_active: v.isActive,
  };
}

// ---------------------------------------------------------------------------
// Registration form
// ---------------------------------------------------------------------------
export const campChoiceSchema = z.object({
  ageGroupId: uuid,
  priceOptionId: uuid,
  days: z.array(isoDate).min(1, E("days")).max(63, E("days")),
});

const pastDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "registration.errors.required")
  .refine((v) => Date.parse(v) < Date.now(), "registration.errors.required");

export const campPublicChildSchema = campChoiceSchema.extend({
  firstName: z.string().trim().min(1, "registration.errors.required").max(80, E("tooLong")),
  lastName: z.string().trim().min(1, "registration.errors.required").max(80, E("tooLong")),
  dob: pastDate,
  gender: z.string().max(20).optional().default(""),
  allergies: z.string().max(1000, E("tooLong")).optional().default(""),
  conditions: z.string().max(1000, E("tooLong")).optional().default(""),
  medicalNotes: z.string().max(2000, E("tooLong")).optional().default(""),
});

export const campParentChildSchema = campChoiceSchema.extend({ athleteId: uuid });

const parentSchema = z.object({
  name: z.string().trim().min(1, "registration.errors.required").max(120, E("tooLong")),
  email: z.string().trim().email("registration.errors.email").max(200),
  phone: z.string().trim().min(3, "registration.errors.required").max(40),
  address: z.string().trim().max(300).optional().default(""),
  emergencyName: z.string().trim().min(1, "registration.errors.required").max(120),
  emergencyPhone: z.string().trim().min(3, "registration.errors.required").max(40),
});

const promo = z.string().trim().max(40).optional().default("");

export const campPublicRegistrationSchema = z.object({
  programSlug: z.string().min(1).max(120),
  editionId: uuid,
  parent: parentSchema,
  children: z.array(campPublicChildSchema).min(1, E("noChildren")).max(10, E("tooMany")),
  consents: z.array(z.string().max(80)).max(50).default([]),
  promoCode: promo,
});
export type CampPublicRegistrationInput = z.input<typeof campPublicRegistrationSchema>;

export const campParentRegistrationSchema = z.object({
  programId: uuid,
  editionId: uuid,
  children: z.array(campParentChildSchema).min(1, E("noChildren")).max(10, E("tooMany")),
  consents: z.array(z.string().max(80)).max(50).default([]),
  promoCode: promo,
});
export type CampParentRegistrationInput = z.input<typeof campParentRegistrationSchema>;

/** Maps an RPC / DB error message to an i18n key under camps.errors. */
const DB_CODES = [
  "EDITION_FULL", "REGISTRATION_CLOSED", "EDITION_NOT_OPEN", "PROGRAM_NOT_OPEN", "AGE_OUT_OF_RANGE", "INVALID_DAYS",
  "PRICE_CHANGED", "PROMO_LIMIT_REACHED", "PROMO_FAMILY_LIMIT", "PROMO_INVALID", "DISCOUNT_EXPIRED",
  "DISCOUNT_NOT_AVAILABLE", "ALREADY_REGISTERED", "VPC_REQUIRED", "EDITION_HAS_REGISTRATIONS", "DISCOUNT_ALREADY_APPLIED",
  "NOTHING_TO_DISCOUNT", "CURRENCY_MISMATCH", "NOT_PRICED", "REGISTRATION_CANCELLED", "PRICE_OPTION_NOT_FOUND",
  "AGE_GROUP_NOT_FOUND", "USE_CANCEL", "CREDIT_EXCEEDS_AMOUNT_DUE", "INVOICE_CANCELLED", "INVOICE_WRITTEN_OFF",
] as const;
export type CampDbCode = (typeof DB_CODES)[number];

export function campErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  for (const c of DB_CODES) if (m.includes(c)) return `camps.errors.db.${c}`;
  if (/duplicate key|unique/i.test(m)) return E("duplicate");
  if (/row-level security|42501|NOT_AUTHORIZED|CROSS_TENANT/i.test(m)) return E("notPermitted");
  return E("generic");
}

export function firstIssueKey(err: z.ZodError): string {
  return err.issues[0]?.message ?? E("generic");
}
