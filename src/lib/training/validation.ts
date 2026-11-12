import { z } from "zod";

/**
 * Validation for the training system (services, packages, availability,
 * purchases, bookings, profiles, guest checkout). Pure: shared by server
 * actions and unit tests. Messages are i18n keys under `training.errors.*`.
 */

const E = (k: string) => `training.errors.${k}`;
const uuid = z.string().uuid(E("invalidRequest"));
const optUuid = z.union([z.literal(""), z.null(), z.string().uuid(E("invalidRequest"))]).optional().transform((v) => (v ? v : null));
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, E("invalidTime"));
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const optDate = z.union([z.literal(""), z.null(), z.string().regex(isoDate, E("invalidDate"))]).optional().transform((v) => (v ? v : null));
const instant = z.string().refine((s) => !Number.isNaN(Date.parse(s)), E("invalidDate"));
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/** Neutral swatch shown by the colour picker before a service has a colour (tenant data, not theme). */
export const COLOR_PICKER_FALLBACK = "#808080";

export const SESSION_TYPES = ["individual", "group"] as const;
export const SERVICE_CURRENCIES = ["CHF", "EUR", "USD", "GBP"] as const;

export const serviceInputSchema = z
  .object({
    name: z.string().trim().min(1, E("nameRequired")).max(120, E("tooLong")),
    description: z.string().trim().max(2000, E("tooLong")).optional().default(""),
    sessionType: z.enum(SESSION_TYPES),
    maxParticipants: z.coerce.number().int(E("participants")).min(1, E("participants")).max(100, E("participants")),
    minParticipants: z.coerce.number().int(E("participants")).min(1, E("participants")).max(100, E("participants")).optional().default(1),
    durationMin: z.coerce.number().int(E("duration")).min(15, E("duration")).max(480, E("duration")),
    price: z.coerce.number({ invalid_type_error: E("price") }).min(0, E("price")).max(100_000, E("price")),
    currency: z.union([z.literal(""), z.enum(SERVICE_CURRENCIES)]).optional().default(""),
    venueId: optUuid,
    locationText: z.string().trim().max(300, E("tooLong")).optional().default(""),
    color: z.union([z.literal(""), z.string().regex(/^#[0-9A-Fa-f]{6}$/, E("color"))]).optional().default(""),
    coachIds: z.array(uuid).max(200).optional().default([]),
    isActive: z.boolean().optional().default(true),
    sortOrder: z.coerce.number().int().min(-1000).max(1000).optional().default(0),
    creditCategory: z.enum(["personal", "nutrition", "mental"]).optional().default("personal"),
    creditsRequired: z.coerce.number().int(E("credits")).min(0, E("credits")).max(99, E("credits")).optional().default(0),
  })
  .transform((v) => (v.sessionType === "individual" ? { ...v, maxParticipants: 1, minParticipants: 1 } : v))
  .refine((v) => v.minParticipants <= v.maxParticipants, { message: E("minAboveMax"), path: ["minParticipants"] });
export type ServiceInput = z.input<typeof serviceInputSchema>;
export type ServiceValues = z.output<typeof serviceInputSchema>;

export const packageRowSchema = z.object({
  id: optUuid,
  name: z.string().trim().max(120, E("tooLong")).optional().default(""),
  sessions: z.coerce.number().int(E("sessions")).min(1, E("sessions")).max(1000, E("sessions")),
  price: z.coerce.number({ invalid_type_error: E("price") }).min(0, E("price")).max(1_000_000, E("price")),
  validityDays: z.union([z.literal(""), z.null(), z.coerce.number().int(E("validity")).min(1, E("validity")).max(3650, E("validity"))]).optional().transform((v) => (v === "" || v === null || v === undefined ? null : v)),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(-1000).max(1000).optional().default(0),
  description: z.string().trim().max(500, E("tooLong")).optional().default(""),
});
export type PackageRowInput = z.input<typeof packageRowSchema>;
export const packageListSchema = z.array(packageRowSchema).max(50, E("tooMany"));

export const templateSchema = z
  .object({
    id: optUuid,
    coachId: uuid,
    venueId: optUuid,
    serviceId: optUuid,
    weekday: z.coerce.number().int().min(1, E("invalidRequest")).max(7, E("invalidRequest")),
    startTime: hm,
    endTime: hm,
    capacity: z.coerce.number().int(E("capacity")).min(1, E("capacity")).max(100, E("capacity")).optional().default(1),
    validFrom: optDate,
    validUntil: optDate,
    isActive: z.boolean().optional().default(true),
  })
  .refine((v) => toMin(v.endTime) > toMin(v.startTime), { message: E("endBeforeStart"), path: ["endTime"] })
  .refine((v) => !v.validFrom || !v.validUntil || v.validUntil >= v.validFrom, { message: E("endBeforeStart"), path: ["validUntil"] });
export type TemplateInput = z.input<typeof templateSchema>;

export const windowSchema = z
  .object({
    id: optUuid,
    coachId: uuid,
    venueId: optUuid,
    serviceId: optUuid,
    startsAt: instant,
    endsAt: instant,
    capacity: z.coerce.number().int(E("capacity")).min(1, E("capacity")).max(100, E("capacity")).optional().default(1),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), { message: E("endBeforeStart"), path: ["endsAt"] })
  .refine((v) => Date.parse(v.endsAt) - Date.parse(v.startsAt) <= 16 * 36e5, { message: E("tooLongDuration"), path: ["endsAt"] });
export type WindowInput = z.input<typeof windowSchema>;

export const blackoutSchema = z
  .object({
    id: optUuid,
    coachId: optUuid,
    venueId: optUuid,
    startsAt: instant,
    endsAt: instant,
    reason: z.string().trim().max(300, E("tooLong")).optional().default(""),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), { message: E("endBeforeStart"), path: ["endsAt"] });
export type BlackoutInput = z.input<typeof blackoutSchema>;

const dayHours = z.array(z.tuple([hm, hm]).refine(([a, b]) => toMin(b) > toMin(a), E("endBeforeStart"))).max(4);
export const openingHoursSchema = z.union([
  z.null(),
  z.record(z.enum(["1", "2", "3", "4", "5", "6", "7"]), dayHours),
]);
export type OpeningHoursInput = z.input<typeof openingHoursSchema>;

export const PURCHASE_MODES = ["invoice", "paid", "comp"] as const;
export const purchaseSchema = z.object({
  athleteId: uuid,
  serviceId: uuid,
  packageId: optUuid,
  mode: z.enum(PURCHASE_MODES).default("invoice"),
  note: z.string().trim().max(2000, E("tooLong")).optional().default(""),
});
export type PurchaseInput = z.input<typeof purchaseSchema>;

export const PAY_WITH = ["credits", "package", "invoice"] as const;
export const bookSchema = z.object({
  athleteId: uuid,
  serviceId: uuid,
  coachId: uuid,
  start: instant,
  payWith: z.enum(PAY_WITH),
  purchaseId: optUuid,
  packageId: optUuid,
  mode: z.enum(PURCHASE_MODES).optional().default("invoice"),
  override: z.boolean().optional().default(false),
  notes: z.string().trim().max(2000, E("tooLong")).optional().default(""),
});
export type BookInput = z.input<typeof bookSchema>;

export const rescheduleSchema = z.object({ bookingId: uuid, coachId: uuid, start: instant });

export const reasonSchema = z.string().trim().min(1, E("reasonRequired")).max(500, E("tooLong"));

export const profileSchema = z.object({
  athleteId: uuid,
  goals: z.string().trim().max(4000, E("tooLong")).optional().default(""),
  notes: z.string().trim().max(4000, E("tooLong")).optional().default(""),
  level: z.string().trim().max(80, E("tooLong")).optional().default(""),
  focusAreas: z.array(z.string().trim().min(1).max(60, E("tooLong"))).max(20).optional().default([]),
});
export type ProfileInput = z.input<typeof profileSchema>;

export const settingsSchema = z.object({
  enabled: z.boolean(),
  cancellationHours: z.coerce.number().int().min(0, E("invalidRequest")).max(720, E("invalidRequest")),
  refundCreditsOnCancel: z.boolean(),
  slotStepMin: z.coerce.number().int().min(5, E("invalidRequest")).max(240, E("invalidRequest")).optional().default(30),
  leadHours: z.coerce.number().int().min(0, E("invalidRequest")).max(720, E("invalidRequest")).optional().default(0),
  horizonDays: z.coerce.number().int().min(1, E("invalidRequest")).max(120, E("invalidRequest")).optional().default(28),
});
export type TrainingSettingsInput = z.input<typeof settingsSchema>;

export const guestCheckoutSchema = z.object({
  clubSlug: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/, E("invalidRequest")),
  serviceId: uuid,
  coachId: uuid,
  start: instant,
  payWith: z.enum(["package", "invoice"]),
  packageId: optUuid,
  authMode: z.enum(["password", "magic_link"]),
  parent: z.object({
    name: z.string().trim().min(1, E("nameRequired")).max(120, E("tooLong")),
    email: z.string().trim().toLowerCase().email(E("email")).max(254, E("tooLong")),
    phone: z.string().trim().max(40, E("tooLong")).optional().default(""),
    password: z.string().max(200).optional().default(""),
  }),
  child: z.object({
    firstName: z.string().trim().min(1, E("nameRequired")).max(80, E("tooLong")),
    lastName: z.string().trim().min(1, E("nameRequired")).max(80, E("tooLong")),
    dob: z.string().regex(isoDate, E("invalidDate")),
  }),
  consents: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  guardianConfirmed: z.literal(true, { errorMap: () => ({ message: E("guardianConsent") }) }),
})
  .refine((v) => v.authMode !== "password" || v.parent.password.length >= 8, { message: E("password"), path: ["parent", "password"] })
  .refine((v) => v.payWith !== "package" || !!v.packageId, { message: E("packageRequired"), path: ["packageId"] });
export type GuestCheckoutInput = z.input<typeof guestCheckoutSchema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
const DB_ERRORS: [RegExp, string][] = [
  [/BOOKINGS_DISABLED/, "bookingsDisabled"],
  [/SLOT_FULL/, "slotFull"],
  [/SLOT_NOT_AVAILABLE|SLOT_NOT_FOUND|SLOT_TAKEN|training_bookings_athlete_slot_uniq/, "slotNotAvailable"],
  [/SLOT_IN_PAST/, "slotInPast"],
  [/COACH_BUSY/, "coachBusy"],
  [/ATHLETE_BUSY/, "athleteBusy"],
  [/COACH_NOT_OFFERING/, "coachNotOffering"],
  [/INSUFFICIENT_CREDITS/, "insufficientCredits"],
  [/PACKAGE_NOT_FOUND/, "packageNotFound"],
  [/NOT_CANCELLABLE|NOT_RESCHEDULABLE|NOT_EDITABLE/, "notChangeable"],
  [/REASON_REQUIRED/, "reasonRequired"],
  [/VPC_REQUIRED/, "vpcRequired"],
  [/GUARDIAN_CONSENT_REQUIRED/, "guardianConsent"],
  [/CONSENT_REQUIRED/, "consentRequired"],
  [/ACCOUNT_EXISTS|ACCOUNT_OTHER_CLUB|ACCOUNT_MISMATCH/, "accountExists"],
  [/INVALID_DOB/, "invalidDate"],
  [/CROSS_ORG_REFERENCE/, "invalidRequest"],
  [/coach_availability_no_overlap/, "windowOverlap"],
  [/credit_packages_|training_services_|coach_availability_templates|check constraint/, "invalidRequest"],
  [/NOT_FOUND/, "notFound"],
  [/NOT_AUTHORIZED|row-level security|permission denied/, "notPermitted"],
];

/** Maps a database / RPC error message to an i18n key under training.errors. */
export function trainingErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  for (const [re, key] of DB_ERRORS) if (re.test(m)) return E(key);
  return E("generic");
}

/** First zod issue as an i18n key. */
export function zodKey(error: z.ZodError): string {
  const msg = error.issues[0]?.message ?? "";
  return msg.startsWith("training.errors.") ? msg : E("invalidRequest");
}
