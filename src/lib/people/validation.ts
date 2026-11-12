import { z } from "zod";

/**
 * Validation for the admin "people & records" editors (athletes, families,
 * guardians, registrations, documents, consents) and athlete photos.
 *
 * Pure module: shared by server actions and unit tests. Every zod message is
 * an i18n key (editPeople.errors.* / athletePhoto.errors.*) that the action
 * translates with the caller's locale. Ids are only shape-checked here; the
 * server action re-resolves every referenced row inside the caller's org.
 */

export const E = {
  required: "editPeople.errors.required",
  invalidId: "editPeople.errors.invalidId",
  invalidDate: "editPeople.errors.invalidDate",
  futureDate: "editPeople.errors.futureDate",
  invalidEmail: "editPeople.errors.invalidEmail",
  tooLong: "editPeople.errors.tooLong",
  invalidOption: "editPeople.errors.invalidOption",
  reasonRequired: "editPeople.errors.reasonRequired",
} as const;

const uuid = z.string().trim().uuid(E.invalidId);
const text = (max: number) => z.string().trim().max(max, E.tooLong);
/** Optional free text: "" and whitespace become null. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, E.tooLong)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, E.invalidDate)
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), E.invalidDate);

const optIsoDate = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))), E.invalidDate);

// ---------------------------------------------------------------------------
// Athletes
// ---------------------------------------------------------------------------
export const ATHLETE_STATUSES = ["active", "inactive", "archived"] as const;
export const GENDERS = ["male", "female", "other"] as const;
export const DOMINANT_HANDS = ["right", "left", "ambidextrous"] as const;

/** Map stored free-text values ("Male", "Right") to the option keys. */
export function normaliseOption<T extends string>(value: string | null | undefined, options: readonly T[]): T | "" {
  const v = (value ?? "").trim().toLowerCase();
  return (options as readonly string[]).includes(v) ? (v as T) : "";
}

export const athleteSchema = z.object({
  familyId: uuid,
  firstName: text(80).min(1, E.required),
  lastName: text(80).min(1, E.required),
  dob: isoDate.refine((v) => new Date(`${v}T00:00:00Z`).getTime() <= Date.now(), E.futureDate),
  gender: z.enum(["", ...GENDERS], { message: E.invalidOption }).optional().default("").transform((v) => v || null),
  nationality: optText(80),
  school: optText(120),
  jerseySize: optText(10),
  dominantHand: z.enum(["", ...DOMINANT_HANDS], { message: E.invalidOption }).optional().default("").transform((v) => v || null),
  positionPref: optText(60),
  status: z.enum(ATHLETE_STATUSES, { message: E.invalidOption }).default("active"),
  notes: optText(2000),
});
export type AthleteInput = z.input<typeof athleteSchema>;
export type AthleteData = z.output<typeof athleteSchema>;

export const medicalSchema = z.object({
  allergies: optText(1000),
  conditions: optText(1000),
  medications: optText(1000),
  insurance: optText(200),
  emergencyContactName: optText(120),
  emergencyContactPhone: optText(40),
  notes: optText(2000),
});
export type MedicalInput = z.input<typeof medicalSchema>;

// ---------------------------------------------------------------------------
// Families & guardians
// ---------------------------------------------------------------------------
export const familySchema = z.object({
  name: text(120).min(1, E.required),
  address: optText(300),
  phone: optText(40),
  contactName: optText(120),
  contactEmail: z
    .string()
    .trim()
    .max(200, E.tooLong)
    .optional()
    .nullable()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, E.invalidEmail),
});
export type FamilyInput = z.input<typeof familySchema>;

export const GUARDIAN_RELATIONS = ["mother", "father", "guardian", "other"] as const;

export const guardianLinkSchema = z.object({
  familyId: uuid,
  email: z.string().trim().toLowerCase().email(E.invalidEmail),
  relation: z.enum(GUARDIAN_RELATIONS, { message: E.invalidOption }).default("guardian"),
  isPrimary: z.boolean().default(false),
});
export type GuardianLinkInput = z.input<typeof guardianLinkSchema>;

export const guardianUpdateSchema = z.object({
  familyId: uuid,
  profileId: uuid,
  relation: z.enum(GUARDIAN_RELATIONS, { message: E.invalidOption }),
  isPrimary: z.boolean(),
});
export type GuardianUpdateInput = z.input<typeof guardianUpdateSchema>;

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------
export const REGISTRATION_STATUSES = ["pending", "confirmed", "waitlist", "cancelled", "completed"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const registrationEditSchema = z
  .object({
    programId: uuid,
    status: z.enum(REGISTRATION_STATUSES, { message: E.invalidOption }),
    notes: optText(2000),
    cancellationReason: optText(1000),
  })
  .refine((v) => v.status !== "cancelled" || !!v.cancellationReason, {
    message: E.reasonRequired,
    path: ["cancellationReason"],
  });
export type RegistrationEditInput = z.input<typeof registrationEditSchema>;

export const registrationCreateSchema = z.object({
  athleteId: uuid,
  programId: uuid,
  status: z.enum(["pending", "confirmed", "waitlist"], { message: E.invalidOption }).default("confirmed"),
});
export type RegistrationCreateInput = z.input<typeof registrationCreateSchema>;

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, E.reasonRequired).max(1000, E.tooLong),
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
export const DOCUMENT_KINDS = ["other", "consent_pdf", "medical", "insurance", "photo"] as const;
export const DOCUMENT_SCOPES = ["global", "program", "family", "athlete"] as const;
export type DocumentScope = (typeof DOCUMENT_SCOPES)[number];

export const documentMetaSchema = z
  .object({
    title: optText(200),
    kind: z.enum(DOCUMENT_KINDS, { message: E.invalidOption }),
    expiresAt: optIsoDate,
    scope: z.enum(DOCUMENT_SCOPES, { message: E.invalidOption }),
    targetId: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v) => (v ? v : null)),
  })
  .refine((v) => v.scope === "global" || (!!v.targetId && z.string().uuid().safeParse(v.targetId).success), {
    message: E.required,
    path: ["targetId"],
  });
export type DocumentMetaInput = z.input<typeof documentMetaSchema>;

/** The documents row columns a scope maps to (exactly one target, or none). */
export function scopeColumns(scope: DocumentScope, targetId: string | null) {
  return {
    athlete_id: scope === "athlete" ? targetId : null,
    family_id: scope === "family" ? targetId : null,
    program_id: scope === "program" ? targetId : null,
  };
}

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Consents
// ---------------------------------------------------------------------------
export const CONSENT_SOURCES = ["paper", "verbal", "email", "other"] as const;

export const consentRecordSchema = z.object({
  athleteId: uuid,
  consentFormId: uuid,
  source: z.enum(CONSENT_SOURCES, { message: E.invalidOption }),
  signedOn: isoDate.refine((v) => new Date(`${v}T00:00:00Z`).getTime() <= Date.now(), E.futureDate),
  signerName: text(120).min(1, E.required),
  guardianId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.string().uuid().safeParse(v).success, E.invalidId),
});
export type ConsentRecordInput = z.input<typeof consentRecordSchema>;

export const consentWithdrawSchema = z.object({
  acceptanceId: uuid,
  reason: z.string().trim().min(3, E.reasonRequired).max(1000, E.tooLong),
});

// ---------------------------------------------------------------------------
// Athlete photos
// ---------------------------------------------------------------------------
export const PHOTO_BUCKET = "athlete-photos";
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const PHOTO_MAX_DIMENSION = 800;
export const PHOTO_TYPES = ["image/jpeg", "image/webp", "image/png"] as const;
/** Types a user may pick; HEIC etc. are converted by the browser canvas only if it can decode them. */
export const PHOTO_INPUT_ACCEPT = "image/jpeg,image/png,image/webp";
/** Signed URLs for photos live this long (seconds). */
export const PHOTO_URL_TTL = 300;

export type PhotoType = (typeof PHOTO_TYPES)[number];

export function isAllowedPhotoType(type: string | null | undefined): type is PhotoType {
  return !!type && (PHOTO_TYPES as readonly string[]).includes(type);
}

const EXT: Record<PhotoType, string> = { "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png" };

/** Storage key for a new photo: <org_id>/<athlete_id>/<random>.<ext>. */
export function photoObjectPath(orgId: string, athleteId: string, type: PhotoType, random: string): string {
  if (!z.string().uuid().safeParse(orgId).success || !z.string().uuid().safeParse(athleteId).success) {
    throw new Error("invalid id");
  }
  const safe = random.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) || "photo";
  return `${orgId}/${athleteId}/${safe}.${EXT[type]}`;
}

/** True when a stored key belongs to this org + athlete (defence in depth before delete/sign). */
export function isPhotoPathFor(path: string | null | undefined, orgId: string, athleteId: string): boolean {
  if (!path) return false;
  const parts = path.split("/");
  return parts.length === 3 && parts[0] === orgId && parts[1] === athleteId && parts[2].length > 0 && !parts[2].includes("..");
}

/** Validate an uploaded (already resized) photo. Returns an i18n error key or null. */
export function checkPhotoFile(file: { size: number; type: string } | null | undefined): string | null {
  if (!file || file.size === 0) return "athletePhoto.errors.noFile";
  if (!isAllowedPhotoType(file.type)) return "athletePhoto.errors.type";
  if (file.size > PHOTO_MAX_BYTES) return "athletePhoto.errors.size";
  return null;
}

/** Recognise the image by its first bytes (never trust the declared type alone). */
export function sniffImageType(bytes: Uint8Array): PhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

/** Scale (w, h) to fit inside max x max, never upscaling; integer pixels. */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_DIMENSION): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** First zod issue as an i18n key (falls back to the generic required key). */
export function firstIssueKey(err: z.ZodError): string {
  return err.issues[0]?.message ?? E.required;
}
