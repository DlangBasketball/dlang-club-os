import { z } from "zod";

/** zod schemas + DB error mapping for the messaging, alerts and leads actions. */

export const uuid = z.string().uuid();
const optUuid = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().uuid().nullable());
const optText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() ? v.trim() : null) : v ?? null), z.string().max(max).nullable());
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const optTime = z.preprocess((v) => (v === "" || v === undefined ? null : v), hhmm.nullable());
/** "YYYY-MM-DDTHH:MM" from a datetime-local input (club wall-clock time). */
const optLocalDateTime = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/).nullable(),
);

export const MESSAGE_MAX = 5000;
export const body = z.string().trim().min(1).max(MESSAGE_MAX);

/** Attachments: PDF and images, small enough for a server action body. */
export const ATTACHMENT_BUCKET = "message-attachments";
export const ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
export const ATTACHMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const ATTACHMENT_URL_TTL = 60 * 5;

export const startDirectSchema = z
  .object({
    /** null = "the club office" (guardians only). */
    targetId: optUuid,
    familyId: optUuid,
    subject: optText(160),
    body,
    sensitive: z.boolean().default(true),
  });
export type StartDirectInput = z.input<typeof startDirectSchema>;

export const CHANNEL_SCOPES = ["team", "program", "camp_edition"] as const;
export type ChannelScope = (typeof CHANNEL_SCOPES)[number];

export const startChannelSchema = z.object({
  scope: z.enum(CHANNEL_SCOPES),
  scopeId: uuid,
  subject: z.string().trim().min(1).max(160),
  body,
  allowReplies: z.boolean().default(true),
  sensitive: z.boolean().default(false),
});
export type StartChannelInput = z.input<typeof startChannelSchema>;

export const reportSchema = z.object({ messageId: uuid, reason: z.string().trim().min(3).max(1000) });
export type ReportInput = z.input<typeof reportSchema>;

export const hideSchema = z.object({ messageId: uuid, hidden: z.boolean(), reason: optText(300) });

export const messagingSettingsSchema = z
  .object({
    parentsCanStart: z.boolean(),
    parentRepliesInChannels: z.boolean(),
    readReceipts: z.boolean(),
    emailNotifications: z.boolean(),
    quietStart: optTime,
    quietEnd: optTime,
  })
  .refine((v) => (v.quietStart === null) === (v.quietEnd === null) && (v.quietStart === null || v.quietStart !== v.quietEnd), {
    path: ["quietEnd"],
  });
export type MessagingSettingsInput = z.input<typeof messagingSettingsSchema>;

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
export const ALERT_SEVERITIES = ["info", "warning", "urgent"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
export const ALERT_AUDIENCES = ["all", "staff", "parents", "team", "program", "camp_edition"] as const;
export type AlertAudience = (typeof ALERT_AUDIENCES)[number];
export const SCOPED_AUDIENCES: readonly AlertAudience[] = ["team", "program", "camp_edition"];

export const alertSchema = z
  .object({
    title: z.string().trim().min(1).max(140),
    body: optText(2000),
    severity: z.enum(ALERT_SEVERITIES),
    audience: z.enum(ALERT_AUDIENCES),
    scopeId: optUuid,
    /** null = send now */
    startsAt: optLocalDateTime,
    expiresAt: optLocalDateTime,
    alsoEmail: z.boolean().default(true),
  })
  .refine((v) => (SCOPED_AUDIENCES.includes(v.audience) ? v.scopeId !== null : v.scopeId === null), { path: ["scopeId"] })
  .refine((v) => !v.startsAt || !v.expiresAt || v.expiresAt > v.startsAt, { path: ["expiresAt"] });
export type AlertInput = z.input<typeof alertSchema>;

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------
export const LEAD_INTERESTS = ["camp", "training", "team", "other"] as const;
export type LeadInterest = (typeof LEAD_INTERESTS)[number];
export const LEAD_STATUSES = ["new", "replied", "converted", "closed"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const contactFormSchema = z.object({
  clubSlug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).nullable().optional(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() ? v.trim() : null) : v ?? null),
    z.string().max(40).regex(/^[+0-9 ().\-/]{4,40}$/).nullable(),
  ),
  message: z.string().trim().min(5).max(3000),
  interest: z.enum(LEAD_INTERESTS),
  consent: z.literal(true),
  programId: optUuid.optional(),
  source: optText(200).optional(),
  /** honeypot (must stay empty) */
  website: z.string().max(500).optional().default(""),
  /** epoch ms when the form rendered (time trap) */
  renderedAt: z.number().int().nonnegative().optional(),
});
export type ContactFormInput = z.input<typeof contactFormSchema>;

export const leadReplySchema = z.object({ leadId: uuid, body: z.string().trim().min(1).max(5000) });
export const leadStatusSchema = z.object({ leadId: uuid, status: z.enum(LEAD_STATUSES) });

// ---------------------------------------------------------------------------
// DB error -> catalog key (messaging.errors.*)
// ---------------------------------------------------------------------------
export function messagingErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  const map: [RegExp, string][] = [
    [/PARENT_START_DISABLED/, "parentStartDisabled"],
    [/FAMILY_NOT_FOUND/, "familyNotFound"],
    [/SCOPE_NOT_FOUND/, "scopeNotFound"],
    [/RATE_LIMITED/, "rateLimited"],
    [/CONSENT_REQUIRED/, "consentRequired"],
    [/INVALID_BODY|INVALID_SUBJECT|msg_messages_body_chk/, "invalid"],
    [/NOT_FOUND/, "notFound"],
    [/CROSS_ORG_REFERENCE/, "invalid"],
    [/NOT_ALLOWED|NOT_AUTHENTICATED|NOT_A_GUARDIAN|NOT_A_STAFF_MEMBER|row-level security|permission denied/, "forbidden"],
  ];
  for (const [re, key] of map) if (re.test(m)) return `messaging.errors.${key}`;
  return "messaging.errors.generic";
}

/** First bytes -> MIME type (never trust the browser's type or file name). */
export function sniffAttachmentType(bytes: Uint8Array): string | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/** Safe display name for an uploaded file. */
export function cleanFileName(name: string, ext: string): string {
  const base = name.replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 180);
  return base || `attachment.${ext}`;
}
