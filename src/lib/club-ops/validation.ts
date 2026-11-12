import { z } from "zod";

/**
 * Validation for club-operations admin edits (programmes, events, attendance
 * corrections, bookings, services, availability). Pure: shared by server
 * actions and unit tests. Error messages are i18n keys under `editOps.*`;
 * actions translate them before returning.
 */

const uuid = z.string().uuid("editOps.errors.invalidRequest");
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const optDate = z.union([z.literal(""), z.string().regex(isoDate, "editOps.errors.invalidDate")]).optional().default("");
const optInstant = z
  .union([z.literal(""), z.string().refine((s) => !Number.isNaN(Date.parse(s)), "editOps.errors.invalidDate")])
  .optional()
  .default("");
const optAge = z.union([z.literal(""), z.coerce.number().int("editOps.errors.ageRange").min(0, "editOps.errors.ageRange").max(99, "editOps.errors.ageRange")]).optional().default("");

export const PROGRAM_KINDS = ["camp", "recurring_team", "clinic", "tournament"] as const;
export const PROGRAM_STATUSES = ["draft", "published", "archived"] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];
/** Currencies a programme can be priced in (empty = the club's currency). */
export const PROGRAM_CURRENCIES = ["CHF", "EUR", "USD"] as const;

export const programSchema = z
  .object({
    name: z.string().trim().min(2, "editOps.errors.nameRequired").max(120, "editOps.errors.tooLong"),
    kind: z.enum(PROGRAM_KINDS),
    status: z.enum(PROGRAM_STATUSES).default("published"),
    description: z.string().trim().max(4000, "editOps.errors.tooLong").optional().default(""),
    scheduleSummary: z.string().trim().max(500, "editOps.errors.tooLong").optional().default(""),
    location: z.string().trim().max(200, "editOps.errors.tooLong").optional().default(""),
    startsOn: optDate,
    endsOn: optDate,
    price: z.coerce.number({ invalid_type_error: "editOps.errors.price" }).min(0, "editOps.errors.price").max(1_000_000, "editOps.errors.price"),
    currency: z.union([z.literal(""), z.enum(PROGRAM_CURRENCIES)]).optional().default(""),
    capacity: z.union([z.literal(""), z.coerce.number().int("editOps.errors.capacity").min(1, "editOps.errors.capacity").max(10_000, "editOps.errors.capacity")]).optional().default(""),
    minAge: optAge,
    maxAge: optAge,
    registrationOpensAt: optInstant,
    registrationClosesAt: optInstant,
    isPublic: z.boolean().optional().default(false),
  })
  .refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, { message: "editOps.errors.endBeforeStart", path: ["endsOn"] })
  .refine((v) => v.minAge === "" || v.maxAge === "" || v.maxAge >= v.minAge, { message: "editOps.errors.ageRange", path: ["maxAge"] })
  .refine(
    (v) => !v.registrationOpensAt || !v.registrationClosesAt || Date.parse(v.registrationClosesAt) > Date.parse(v.registrationOpensAt),
    { message: "editOps.errors.windowOrder", path: ["registrationClosesAt"] },
  );
export type ProgramInput = z.input<typeof programSchema>;
export type ProgramValues = z.output<typeof programSchema>;

/** Maps validated form values to programmes columns (org_id is never taken from input). */
export function programRow(v: ProgramValues) {
  return {
    name: v.name,
    kind: v.kind,
    status: v.status,
    description: v.description || null,
    schedule: v.scheduleSummary ? { summary: v.scheduleSummary } : null,
    location: v.location || null,
    starts_on: v.startsOn || null,
    ends_on: v.endsOn || null,
    price_chf: v.price,
    currency: v.currency || null,
    capacity: v.capacity === "" ? null : v.capacity,
    min_age: v.minAge === "" ? null : v.minAge,
    max_age: v.maxAge === "" ? null : v.maxAge,
    registration_opens_at: v.registrationOpensAt ? new Date(v.registrationOpensAt).toISOString() : null,
    registration_closes_at: v.registrationClosesAt ? new Date(v.registrationClosesAt).toISOString() : null,
    is_public: v.isPublic,
  };
}

/** Reads the schedule summary back out of programs.schedule (jsonb). */
export function scheduleSummaryOf(schedule: unknown): string {
  if (schedule && typeof schedule === "object" && !Array.isArray(schedule)) {
    const s = (schedule as Record<string, unknown>).summary;
    if (typeof s === "string") return s;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
export const EVENT_SCOPES = ["one", "following"] as const;
export type EventScope = (typeof EVENT_SCOPES)[number];
export const eventScopeSchema = z.enum(EVENT_SCOPES).default("one");

export const reasonSchema = z.string().trim().max(500, "editOps.errors.reasonTooLong");
export const requiredReasonSchema = reasonSchema.min(1, "editOps.errors.reasonRequired");

/**
 * New start/end for each later occurrence of a series when one occurrence is
 * moved: every occurrence shifts by the same offset and takes the new length.
 */
export function shiftOccurrences(
  edited: { oldStart: string; newStart: string; newEnd: string },
  occurrences: { id: string; startsAt: string }[],
): { id: string; startsAt: string; endsAt: string }[] {
  const delta = Date.parse(edited.newStart) - Date.parse(edited.oldStart);
  const length = Date.parse(edited.newEnd) - Date.parse(edited.newStart);
  return occurrences.map((o) => {
    const s = Date.parse(o.startsAt) + delta;
    return { id: o.id, startsAt: new Date(s).toISOString(), endsAt: new Date(s + length).toISOString() };
  });
}

// ---------------------------------------------------------------------------
// Attendance corrections
// ---------------------------------------------------------------------------
export const ATTENDANCE_STATUSES = ["present", "late", "absent", "excused"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const attendanceCorrectionSchema = z.object({
  sessionId: uuid,
  marks: z
    .array(
      z.object({
        athleteId: uuid,
        /** null removes the mark. */
        status: z.enum(ATTENDANCE_STATUSES).nullable(),
        notes: z.string().trim().max(1000, "editOps.errors.tooLong").optional().default(""),
        injuryFlag: z.boolean().optional().default(false),
      }),
    )
    .min(1, "editOps.errors.nothingToSave")
    .max(300, "editOps.errors.invalidRequest"),
  reason: reasonSchema.optional().default(""),
});
export type AttendanceCorrectionInput = z.input<typeof attendanceCorrectionSchema>;

// ---------------------------------------------------------------------------
// Bookings, services, availability
// ---------------------------------------------------------------------------
export const BOOKING_EDIT_STATUSES = ["booked", "completed", "no_show"] as const;

export const bookingEditSchema = z
  .object({
    serviceId: uuid,
    coachId: uuid,
    startsAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "editOps.errors.invalidDate"),
    endsAt: optInstant,
    status: z.enum(BOOKING_EDIT_STATUSES),
    notes: z.string().trim().max(2000, "editOps.errors.tooLong").optional().default(""),
  })
  .refine((v) => !v.endsAt || Date.parse(v.endsAt) > Date.parse(v.startsAt), { message: "editOps.errors.endBeforeStart", path: ["endsAt"] })
  .refine((v) => !v.endsAt || Date.parse(v.endsAt) - Date.parse(v.startsAt) <= 12 * 36e5, { message: "editOps.errors.tooLongDuration", path: ["endsAt"] });
export type BookingEditInput = z.input<typeof bookingEditSchema>;

export const serviceSchema = z.object({
  name: z.string().trim().min(1, "editOps.errors.nameRequired").max(120, "editOps.errors.tooLong"),
  description: z.string().trim().max(2000, "editOps.errors.tooLong").optional().default(""),
  durationMin: z.coerce.number().int("editOps.errors.duration").min(15, "editOps.errors.duration").max(480, "editOps.errors.duration"),
  priceChf: z.coerce.number().min(0, "editOps.errors.price").max(100_000, "editOps.errors.price"),
  creditCategory: z.enum(["personal", "nutrition", "mental"]),
  creditsRequired: z.coerce.number().int("editOps.errors.credits").min(0, "editOps.errors.credits").max(99, "editOps.errors.credits"),
  isActive: z.boolean().default(true),
});
export type ServiceInput = z.input<typeof serviceSchema>;

export const availabilitySchema = z
  .object({
    startsAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "editOps.errors.invalidDate"),
    endsAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "editOps.errors.invalidDate"),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), { message: "editOps.errors.endBeforeStart", path: ["endsAt"] })
  .refine((v) => Date.parse(v.endsAt) - Date.parse(v.startsAt) <= 12 * 36e5, { message: "editOps.errors.tooLongDuration", path: ["endsAt"] });

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
const DB_ERRORS: [RegExp, string][] = [
  [/PROGRAM_HAS_REGISTRATIONS/, "editOps.errors.programHasRegistrations"],
  [/programs_age_chk/, "editOps.errors.ageRange"],
  [/programs_reg_window_chk/, "editOps.errors.windowOrder"],
  [/SESSION_LOCKED/, "editOps.errors.sessionLocked"],
  [/SESSION_NOT_FOUND|BOOKING_NOT_FOUND|ATHLETE_NOT_FOUND|SERVICE_NOT_FOUND|COACH_NOT_FOUND/, "editOps.errors.notFound"],
  [/ALREADY_OPEN/, "editOps.errors.alreadyOpen"],
  [/COACH_BUSY|training_bookings_coach_slot_uniq/, "editOps.errors.coachBusy"],
  [/SLOT_TAKEN/, "editOps.errors.slotTaken"],
  [/NOT_EDITABLE|NOT_CANCELLABLE/, "editOps.errors.notEditable"],
  [/REASON_REQUIRED/, "editOps.errors.reasonRequired"],
  [/REASON_TOO_LONG/, "editOps.errors.reasonTooLong"],
  [/INVALID_TIME/, "editOps.errors.endBeforeStart"],
  [/coach_availability_no_overlap/, "editOps.errors.slotOverlap"],
  [/events_space_no_overlap/, "editOps.errors.spaceTaken"],
  [/NOT_AUTHORIZED|row-level security|permission denied/, "editOps.errors.notPermitted"],
];

/** Maps a database/RPC error message to an i18n key (generic fallback). */
export function dbErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  for (const [re, key] of DB_ERRORS) if (re.test(m)) return key;
  return "editOps.errors.generic";
}

/** First zod issue as an i18n key (messages above are keys). */
export function zodErrorKey(error: z.ZodError): string {
  const msg = error.issues[0]?.message ?? "";
  return msg.startsWith("editOps.") ? msg : "editOps.errors.invalidRequest";
}

/** Wall-clock date (YYYY-MM-DD) and time (HH:mm) of an instant in a time zone. */
export function zonedParts(iso: string | null | undefined, timeZone: string): { date: string; time: string } {
  if (!iso || Number.isNaN(Date.parse(iso))) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
