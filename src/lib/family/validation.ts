import { z } from "zod";

/** Input schemas for the family & multi-club server actions (pure, unit-tested). */

export const uuid = z.string().uuid();
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

export const switchOrgSchema = z.object({ orgId: uuid });

export const guardianPermissionsSchema = z.object({
  canPay: z.boolean(),
  canSeeMedical: z.boolean(),
  receivesEmails: z.boolean(),
});

export const inviteGuardianSchema = z.object({
  familyId: uuid,
  email: z.string().trim().toLowerCase().email().max(254),
  relation: z.enum(["mother", "father", "guardian", "partner", "grandparent", "other"]).default("guardian"),
  permissions: guardianPermissionsSchema,
});
export type InviteGuardianInput = z.input<typeof inviteGuardianSchema>;

export const setPermissionsSchema = z.object({ familyId: uuid, profileId: uuid }).merge(guardianPermissionsSchema);
export type SetPermissionsInput = z.input<typeof setPermissionsSchema>;

export const billingSplitSchema = z.object({
  familyId: uuid,
  mode: z.enum(["single", "split"]),
  shares: z.array(z.object({ profileId: uuid, pct: z.number().min(0).max(100).multipleOf(0.01) })).max(6).default([]),
});
export type BillingSplitInput = z.input<typeof billingSplitSchema>;

export const correctionSchema = z.object({
  details: z.string().trim().min(5).max(2000),
  athleteId: uuid.optional().nullable(),
});
export const erasureSchema = z.object({
  reason: z.string().trim().max(1000).optional().default(""),
  confirm: z.literal(true),
});
export const consentSchema = z.object({
  kind: z.enum(["media", "marketing"]),
  athleteId: uuid.optional().nullable(),
  granted: z.boolean(),
}).refine((v) => v.kind === "marketing" || Boolean(v.athleteId), { path: ["athleteId"] });
export type ConsentInput = z.input<typeof consentSchema>;

const b64url = z.string().regex(/^[A-Za-z0-9_-]+$/);
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: b64url.min(40).max(200), auth: b64url.min(10).max(100) }),
  userAgent: z.string().max(300).optional().nullable(),
});
export type PushSubscriptionInput = z.input<typeof pushSubscriptionSchema>;

const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid date");
export const carpoolOfferSchema = z.object({
  eventId: uuid,
  fromArea: z.string().trim().min(2).max(120),
  departsAt: isoDateTime,
  seats: z.coerce.number().int().min(1).max(8),
  returnTrip: z.boolean().default(false),
  note: optText(300),
});
export type CarpoolOfferInput = z.input<typeof carpoolOfferSchema>;
export const carpoolRequestSchema = z.object({
  eventId: uuid,
  fromArea: z.string().trim().min(2).max(120),
  seats: z.coerce.number().int().min(1).max(6),
  returnTrip: z.boolean().default(false),
  note: optText(300),
});
export type CarpoolRequestInput = z.input<typeof carpoolRequestSchema>;

export const PLACEMENT_STATUSES = ["interested", "contacted", "trial", "offer", "placed", "declined", "withdrawn"] as const;
export const PLACEMENT_KINDS = ["school", "club", "college", "academy", "other"] as const;
export const seasonReviewSchema = z.object({
  id: uuid.optional().nullable(),
  athleteId: uuid,
  seasonId: uuid.optional().nullable(),
  seasonLabel: z.string().trim().min(1).max(80),
  coachComment: optText(4000),
  awards: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  sharedWithFamily: z.boolean().default(true),
});
export type SeasonReviewInput = z.input<typeof seasonReviewSchema>;
export const placementSchema = z.object({
  id: uuid.optional().nullable(),
  athleteId: uuid,
  targetName: z.string().trim().min(1).max(160),
  targetKind: z.enum(PLACEMENT_KINDS),
  country: optText(80),
  level: optText(80),
  status: z.enum(PLACEMENT_STATUSES),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("").transform(() => null)),
  nextStep: optText(300),
  notes: optText(4000),
  documentIds: z.array(uuid).max(20).default([]),
});
export type PlacementInput = z.input<typeof placementSchema>;

/** Fields a guardian may choose for a scout profile. Medical data is never one. */
export const SCOUT_FIELDS = [
  "full_name", "birth_year", "position", "dominant_hand", "teams", "stats", "attendance",
  "evaluation_trend", "coach_comments", "awards", "placements",
] as const;
export type ScoutField = (typeof SCOUT_FIELDS)[number];
export const SCOUT_CONSENT_VERSION = "1";
export const scoutPublishSchema = z.object({
  athleteId: uuid,
  fields: z.array(z.enum(SCOUT_FIELDS)).min(1).max(SCOUT_FIELDS.length),
  days: z.coerce.number().int().min(1).max(365),
  headline: optText(200),
  consent: z.literal(true),
});
export type ScoutPublishInput = z.input<typeof scoutPublishSchema>;
