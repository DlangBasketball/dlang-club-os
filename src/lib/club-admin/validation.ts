import { z } from "zod";
import { MEMBERSHIP_KINDS, MEMBERSHIP_SCOPES } from "./membership";
import { CERT_KINDS } from "./compliance";
import { BODY_PARTS, INFORMED_HOW, REFERRALS, RETURN_STATUSES, SEVERITIES, INCIDENT_STATUSES } from "./incidents";
import { isValidAhv } from "./js";

/**
 * Zod schemas for the club-admin server actions. Error messages are i18n
 * keys under "clubadmin.errors" (the action translates the first issue).
 */
const E = (k: string) => `clubadmin.errors.${k}`;
export const uuid = z.string().uuid(E("invalid"));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, E("invalidDate"));
const optDay = z.union([day, z.literal(""), z.null()]).optional().transform((v) => (v ? v : null));
const optText = (max: number) =>
  z.union([z.string(), z.null()]).optional().transform((v) => (v && v.trim() ? v.trim() : null)).refine((v) => v == null || v.length <= max, E("tooLong"));
const optInt = (min: number, max: number) =>
  z.union([z.number(), z.string(), z.null()]).optional()
    .transform((v) => (v === "" || v == null ? null : Number(v)))
    .refine((v) => v == null || (Number.isInteger(v) && v >= min && v <= max), E("invalidNumber"));
const money = z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0 && v <= 100000, E("invalidAmount"));
const optMoney = z.union([z.number(), z.string(), z.null()]).optional()
  .transform((v) => (v === "" || v == null ? null : Number(v)))
  .refine((v) => v == null || (Number.isFinite(v) && v >= 0 && v <= 100000), E("invalidAmount"));

export function firstIssueKey(err: z.ZodError): string {
  const m = err.issues[0]?.message ?? "";
  return m.startsWith("clubadmin.") ? m : E("invalid");
}

// ---- Membership ---------------------------------------------------------------
export const membershipTypeSchema = z.object({
  name: z.string().trim().min(1, E("nameRequired")).max(120, E("tooLong")),
  description: optText(1000),
  kind: z.enum(MEMBERSHIP_KINDS),
  scope: z.enum(MEMBERSHIP_SCOPES),
  price: money,
  currency: z.union([z.string().regex(/^[A-Z]{3}$/, E("invalidCurrency")), z.literal(""), z.null()]).optional().transform((v) => v || null),
  period: z.enum(["season", "calendar_year"]),
  seasonStartMonth: z.coerce.number().int().min(1).max(12),
  minAge: optInt(0, 120),
  maxAge: optInt(0, 120),
  isActive: z.boolean(),
  sort: z.coerce.number().int().min(0).max(10000).default(0),
}).refine((v) => v.minAge == null || v.maxAge == null || v.maxAge >= v.minAge, { message: E("ageRange"), path: ["maxAge"] });
export type MembershipTypeInput = z.input<typeof membershipTypeSchema>;

export const membershipCreateSchema = z.object({
  typeId: uuid,
  familyId: uuid,
  athleteId: z.union([uuid, z.literal(""), z.null()]).optional().transform((v) => v || null),
  validFrom: optDay,
  free: z.boolean().default(false),
});
export type MembershipCreateInput = z.input<typeof membershipCreateSchema>;

export const membershipCancelSchema = z.object({ id: uuid, reason: z.string().trim().min(3, E("reasonRequired")).max(500, E("tooLong")) });
export const idList = z.array(uuid).min(1, E("selectSome")).max(500);

// ---- Waitlist -----------------------------------------------------------------
export const waitlistJoinSchema = z.object({
  kind: z.enum(["program", "camp_edition"]),
  targetId: uuid,
  athleteId: uuid,
  priceOptionId: z.union([uuid, z.literal(""), z.null()]).optional().transform((v) => v || null),
  ageGroupId: z.union([uuid, z.literal(""), z.null()]).optional().transform((v) => v || null),
});
export type WaitlistJoinInput = z.input<typeof waitlistJoinSchema>;

export const waitlistAdminAddSchema = waitlistJoinSchema.extend({
  kind: z.enum(["program", "camp_edition", "training_slot"]),
  coachId: z.union([uuid, z.literal(""), z.null()]).optional().transform((v) => v || null),
  slotStart: z.union([z.string().datetime({ offset: true }), z.literal(""), z.null()]).optional().transform((v) => v || null),
});
export type WaitlistAdminAddInput = z.input<typeof waitlistAdminAddSchema>;

export const waitlistSkipSchema = z.object({ id: uuid, reason: z.string().trim().min(3, E("reasonRequired")).max(500, E("tooLong")) });
export const waitlistMoveSchema = z.object({ id: uuid, position: z.coerce.number().int().min(1).max(10000) });
export const tokenSchema = z.string().regex(/^[0-9a-f]{48}$/, E("invalidLink"));

// ---- Settings -----------------------------------------------------------------
export const settingsSchema = z.object({
  waitlistOfferHours: z.coerce.number().int().min(1, E("invalidNumber")).max(336, E("invalidNumber")),
  waitlistAutoOffer: z.boolean(),
  membershipRenewalWindowDays: z.coerce.number().int().min(1, E("invalidNumber")).max(180, E("invalidNumber")),
  jsEnabled: z.boolean(),
  jsClubNumber: optText(40),
  jsAgeMin: z.coerce.number().int().min(0).max(99),
  jsAgeMax: z.coerce.number().int().min(0).max(99),
  jsRatePerParticipantHour: optMoney,
  complianceBlockYouth: z.boolean(),
  complianceMandatoryKinds: z.array(z.enum(CERT_KINDS)).max(6),
  complianceReminderDays: z.array(z.coerce.number().int().min(1).max(365)).max(6),
}).refine((v) => v.jsAgeMax >= v.jsAgeMin, { message: E("ageRange"), path: ["jsAgeMax"] });
export type ClubAdminSettingsInput = z.input<typeof settingsSchema>;

// ---- J+S ----------------------------------------------------------------------
export const jsOfferSchema = z.object({
  programId: uuid,
  jsOffer: z.boolean(),
  jsOfferNumber: optText(40),
  jsSessionMinutes: optInt(15, 600),
});
export const coachJsNumberSchema = z.object({
  coachId: uuid,
  number: z.union([z.string().trim().regex(/^[0-9A-Za-z .-]{1,30}$/, E("invalidNumber")), z.literal(""), z.null()]).optional().transform((v) => v || null),
});
export const ahvSchema = z.object({
  athleteId: uuid,
  ahv: z.union([z.string().trim().refine(isValidAhv, E("ahvInvalid")), z.null()]),
  consentNote: z.string().trim().max(500, E("tooLong")).default(""),
}).refine((v) => v.ahv == null || v.consentNote.length >= 3, { message: E("consentRequired"), path: ["consentNote"] });
export const jsExportSchema = z.object({
  programId: uuid,
  from: day,
  to: day,
  part: z.enum(["participants", "sessions"]),
  ahv: z.boolean().default(false),
}).refine((v) => v.from <= v.to, { message: E("dateRange"), path: ["to"] });

// ---- Compliance ---------------------------------------------------------------
export const certificateSchema = z.object({
  coachId: uuid,
  kind: z.enum(CERT_KINDS),
  title: optText(160),
  reference: optText(80),
  issuedOn: optDay,
  validUntil: optDay,
  notes: optText(1000),
}).refine((v) => !v.issuedOn || !v.validUntil || v.validUntil >= v.issuedOn, { message: E("dateRange"), path: ["validUntil"] });
export type CertificateInput = z.input<typeof certificateSchema>;
export const verifySchema = z.object({
  id: uuid,
  decision: z.enum(["verified", "rejected"]),
  reason: optText(500),
}).refine((v) => v.decision === "verified" || (v.reason && v.reason.length >= 3), { message: E("reasonRequired"), path: ["reason"] });
export const overrideSchema = z.object({
  teamId: uuid,
  coachId: uuid,
  role: z.enum(["head", "assistant", "manager", "trainer"]).default("assistant"),
  reason: z.string().trim().min(3, E("reasonRequired")).max(500, E("tooLong")),
});

// ---- Incidents ----------------------------------------------------------------
const optDateTime = z.union([z.string().datetime({ offset: true }), z.literal(""), z.null()]).optional().transform((v) => v || null);
export const incidentSchema = z.object({
  athleteId: uuid,
  occurredAt: z.string().datetime({ offset: true, message: E("invalidDate") }),
  programId: z.union([uuid, z.literal(""), z.null()]).optional().transform((v) => v || null),
  teamId: z.union([uuid, z.literal(""), z.null()]).optional().transform((v) => v || null),
  location: optText(200),
  description: z.string().trim().min(3, E("descriptionRequired")).max(4000, E("tooLong")),
  bodyPart: z.enum(BODY_PARTS),
  severity: z.enum(SEVERITIES),
  firstAidGiven: z.boolean(),
  firstAidDetails: optText(2000),
  firstAidBy: optText(120),
  parentsInformedAt: optDateTime,
  parentsInformedHow: z.union([z.enum(INFORMED_HOW), z.literal(""), z.null()]).optional().transform((v) => v || null),
  referral: z.enum(REFERRALS),
  followUpNotes: optText(4000),
  returnStatus: z.enum(RETURN_STATUSES),
  clearedOn: optDay,
  status: z.enum(INCIDENT_STATUSES).default("open"),
});
export type IncidentInput = z.input<typeof incidentSchema>;

// ---- Uploads ------------------------------------------------------------------
export const UPLOAD_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
/** Server actions accept 3 MB bodies (next.config.mjs); stay below. */
export const MAX_UPLOAD_BYTES = 2.5 * 1024 * 1024;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH_RE = new RegExp(`^${UUID}/(certificates|incidents)/${UUID}/${UUID}\\.(pdf|png|jpg|webp)$`);

/** Private bucket key: <org>/<certificates|incidents>/<owner id>/<uuid>.<ext>. */
export function fileKey(orgId: string, area: "certificates" | "incidents", ownerId: string, id: string, ext: string): string {
  return `${orgId}/${area}/${ownerId}/${id}.${ext}`;
}
export function isFileKeyFor(path: string | null | undefined, orgId: string, area: "certificates" | "incidents", ownerId: string): boolean {
  return !!path && PATH_RE.test(path) && path.startsWith(`${orgId}/${area}/${ownerId}/`);
}
