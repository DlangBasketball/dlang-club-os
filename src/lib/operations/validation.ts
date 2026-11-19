import { z } from "zod";

/**
 * zod schemas for the operations server actions (equipment, kit, facilities,
 * board, sponsors and donations). Inputs come from plain forms, so numbers,
 * booleans and empty strings are normalised here. The org never comes from
 * the client: actions take it from the session.
 */

const blankToNull = (v: unknown) => (v === "" || v === undefined ? null : v);
export const uuid = z.string().uuid();
export const optUuid = z.preprocess(blankToNull, z.string().uuid().nullable());
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const optText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() ? v.trim() : null) : v ?? null), z.string().max(max).nullable());
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optDate = z.preprocess(blankToNull, dateKey.nullable());
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).transform((v) => v.slice(0, 5));
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/);
const bool = z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean());
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const optInt = (min: number, max: number) => z.preprocess(blankToNull, z.coerce.number().int().min(min).max(max).nullable());
const money = z.coerce.number().min(0).max(10_000_000).transform((v) => Math.round(v * 100) / 100);
const optMoney = z.preprocess(blankToNull, money.nullable());
const optCurrency = z.preprocess(
  (v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null),
  z.string().regex(/^[A-Z]{3}$/).nullable(),
);
const optEmail = z.preprocess(blankToNull, z.string().trim().toLowerCase().email().max(254).nullable());
const size = z.preprocess(blankToNull, z.string().trim().regex(/^[A-Za-z0-9 /.-]{1,12}$/).nullable());

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------
export const EQUIPMENT_CATEGORIES = ["balls", "cones", "bibs", "first_aid", "camp", "training", "electronics", "other"] as const;
export const CONDITIONS = ["new", "good", "fair", "poor", "broken"] as const;

export const equipmentItemSchema = z.object({
  name: text(1, 120),
  category: z.enum(EQUIPMENT_CATEGORIES),
  venueId: optUuid,
  quantity: int(0, 100000),
  condition: z.enum(CONDITIONS),
  purchaseDate: optDate,
  purchaseValue: optMoney,
  expenseId: optUuid,
  notes: optText(2000),
  isActive: bool.default(true),
});

export const checkoutSchema = z.object({
  itemId: uuid,
  quantity: int(1, 100000),
  coachId: optUuid,
  teamId: optUuid,
  dueOn: optDate,
  notes: optText(1000),
});

export const checkinSchema = z.object({
  checkoutId: uuid,
  condition: z.preprocess(blankToNull, z.enum(CONDITIONS).nullable()),
  notes: optText(1000),
});

export const maintenanceSchema = z.object({
  itemId: uuid,
  performedOn: dateKey,
  note: text(1, 2000),
  cost: optMoney,
});

// ---------------------------------------------------------------------------
// Kit
// ---------------------------------------------------------------------------
export const kitAssignmentSchema = z.object({
  teamId: uuid,
  athleteId: uuid,
  jerseyNumber: optInt(0, 999),
  jerseySize: size,
  shortsSize: size,
  warmupSize: size,
  includeJersey: bool.default(true),
  includeShorts: bool.default(true),
  includeWarmup: bool.default(false),
  depositAmount: optMoney,
  notes: optText(1000),
});

export const kitRequestSchema = z.object({
  teamId: uuid,
  includeWarmup: bool.default(false),
  depositAmount: optMoney,
});

export const KIT_STATUS_VALUES = ["sizes_requested", "sizes_submitted", "ordered", "handed_out", "returned"] as const;
export const kitStatusSchema = z.object({ id: uuid, status: z.enum(KIT_STATUS_VALUES) });

export const kitSizesSchema = z.object({ assignmentId: uuid, jerseySize: size, shortsSize: size, warmupSize: size });

// ---------------------------------------------------------------------------
// Facilities
// ---------------------------------------------------------------------------
export const allocationSchema = z
  .object({
    venueId: uuid,
    spaceId: optUuid,
    teamId: optUuid,
    label: optText(120),
    weekday: int(1, 7),
    startTime: hhmm,
    endTime: hhmm,
    validFrom: dateKey,
    validUntil: optDate,
    notes: optText(1000),
  })
  .refine((v) => v.endTime > v.startTime, { path: ["endTime"] })
  .refine((v) => !v.validUntil || v.validUntil >= v.validFrom, { path: ["validUntil"] })
  .refine((v) => v.teamId !== null || v.label !== null, { path: ["teamId"] });

export const generateEventsSchema = z
  .object({ allocationId: uuid, from: dateKey, to: dateKey })
  .refine((v) => v.to >= v.from && Date.parse(v.to) - Date.parse(v.from) <= 366 * 864e5, { path: ["to"] });

export const CUSTOMER_KINDS = ["company", "person", "organization"] as const;
export const customerSchema = z.object({
  kind: z.enum(CUSTOMER_KINDS).default("company"),
  name: text(1, 160),
  contactName: optText(160),
  email: optEmail,
  phone: optText(40),
  street: optText(160),
  postalCode: optText(16),
  city: optText(80),
  country: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null), z.string().regex(/^[A-Z]{2}$/).nullable()),
  notes: optText(2000),
});

export const RENTAL_STATUSES = ["tentative", "confirmed", "cancelled"] as const;
export const rentalSchema = z
  .object({
    venueId: uuid,
    spaceId: optUuid,
    customerId: optUuid,
    renterName: text(1, 160),
    contactEmail: optEmail,
    contactPhone: optText(40),
    date: dateKey,
    startTime: hhmm,
    endTime: hhmm,
    price: money,
    status: z.enum(RENTAL_STATUSES).default("confirmed"),
    notes: optText(1000),
  })
  .refine((v) => v.endTime > v.startTime, { path: ["endTime"] });

export const CLOSURE_REASONS = ["holiday", "maintenance", "emergency", "other"] as const;
export const closureSchema = z
  .object({
    venueId: uuid,
    spaceId: optUuid,
    startsOn: dateKey,
    endsOn: dateKey,
    reason: z.enum(CLOSURE_REASONS),
    note: optText(1000),
  })
  .refine((v) => v.endsOn >= v.startsOn && Date.parse(v.endsOn) - Date.parse(v.startsOn) <= 366 * 864e5, { path: ["endsOn"] });

export const CLOSURE_ITEM_KINDS = ["event", "session", "camp", "booking", "rental"] as const;
export const CLOSURE_OPS = ["cancel", "shift", "relocate", "notify_only"] as const;
export const closureApplySchema = z
  .object({
    closureId: uuid,
    items: z.array(z.object({ kind: z.enum(CLOSURE_ITEM_KINDS), id: uuid })).max(500),
    op: z.enum(CLOSURE_OPS),
    shiftDays: optInt(-366, 366),
    targetVenueId: optUuid,
    notify: bool.default(true),
    message: optText(1000),
  })
  .refine((v) => v.op !== "shift" || (v.shiftDays !== null && v.shiftDays !== 0), { path: ["shiftDays"] })
  .refine((v) => v.op !== "relocate" || v.targetVenueId !== null, { path: ["targetVenueId"] });

// ---------------------------------------------------------------------------
// Board & committees
// ---------------------------------------------------------------------------
export const COMMITTEE_KINDS = ["board", "technical", "events", "finance", "other"] as const;
export const MEMBER_ROLES = ["chair", "vice_chair", "secretary", "treasurer", "member", "advisor"] as const;
export const MEETING_KINDS = ["meeting", "agm", "extraordinary"] as const;
export const MEETING_STATUSES = ["planned", "held", "cancelled"] as const;
export const ATTENDEE_STATUSES = ["present", "absent", "excused", "proxy"] as const;
export const DECISION_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;

export const committeeSchema = z.object({
  name: text(1, 120),
  kind: z.enum(COMMITTEE_KINDS),
  description: optText(2000),
  isActive: bool.default(true),
});

export const memberSchema = z
  .object({
    committeeId: uuid,
    profileId: optUuid,
    displayName: text(1, 160),
    role: z.enum(MEMBER_ROLES),
    email: optEmail,
    startsOn: optDate,
    endsOn: optDate,
  })
  .refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, { path: ["endsOn"] });

export const meetingSchema = z.object({
  committeeId: uuid,
  title: text(1, 160),
  kind: z.enum(MEETING_KINDS),
  startsAt: localDateTime,
  location: optText(200),
  status: z.enum(MEETING_STATUSES).default("planned"),
  /** One agenda item per line. */
  agenda: z
    .preprocess((v) => (typeof v === "string" ? v : ""), z.string().max(10000))
    .transform((v) => v.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 50).map((title) => ({ title: title.slice(0, 300) }))),
});

export const minutesSchema = z.object({ meetingId: uuid, minutes: z.string().max(100000), approve: bool.default(false) });

export const attendeeSchema = z.object({
  meetingId: uuid,
  memberId: optUuid,
  displayName: text(1, 160),
  status: z.enum(ATTENDEE_STATUSES),
  proxyFor: optText(160),
});

export const decisionSchema = z.object({
  committeeId: uuid,
  meetingId: optUuid,
  title: text(1, 200),
  description: optText(4000),
  ownerMemberId: optUuid,
  dueOn: optDate,
  status: z.enum(DECISION_STATUSES).default("open"),
});

export const voteSchema = z.object({
  meetingId: uuid,
  motion: text(1, 500),
  votesFor: int(0, 100000),
  votesAgainst: int(0, 100000),
  abstentions: int(0, 100000),
  notes: optText(1000),
});

export const documentSchema = z.object({
  committeeId: uuid,
  meetingId: optUuid,
  title: text(1, 200),
  url: z.string().trim().url().max(2000).refine((u) => u.startsWith("https://")),
});

// ---------------------------------------------------------------------------
// Sponsors & donations
// ---------------------------------------------------------------------------
export const SPONSOR_TIERS = ["platinum", "gold", "silver", "bronze", "partner", "supplier"] as const;
export const SPONSOR_STATUSES = ["prospect", "active", "expired", "cancelled"] as const;
export const DELIVERABLE_KINDS = ["jersey_logo", "banner", "website", "social_post", "event", "newsletter", "other"] as const;
export const CAMPAIGN_STATUSES = ["draft", "active", "closed"] as const;
export const DONATION_METHODS = ["bank_transfer", "cash", "card", "twint", "online", "other"] as const;

export const sponsorSchema = z
  .object({
    customerId: optUuid,
    companyName: optText(160),
    contactName: optText(160),
    email: optEmail,
    phone: optText(40),
    tier: z.enum(SPONSOR_TIERS),
    packageName: optText(160),
    amount: money,
    currency: optCurrency,
    contractStart: optDate,
    contractEnd: optDate,
    renewalReminderDays: int(0, 365).default(60),
    status: z.enum(SPONSOR_STATUSES).default("active"),
    notes: optText(2000),
  })
  .refine((v) => v.customerId !== null || v.companyName !== null, { path: ["companyName"] })
  .refine((v) => !v.contractStart || !v.contractEnd || v.contractEnd >= v.contractStart, { path: ["contractEnd"] });

export const deliverableSchema = z.object({
  sponsorId: uuid,
  kind: z.enum(DELIVERABLE_KINDS),
  title: text(1, 200),
  dueOn: optDate,
  notes: optText(1000),
});

export const campaignSchema = z
  .object({
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/),
    title: text(1, 160),
    description: optText(4000),
    goalAmount: z.coerce.number().positive().max(10_000_000),
    currency: optCurrency,
    startsOn: optDate,
    endsOn: optDate,
    isPublic: bool.default(false),
    status: z.enum(CAMPAIGN_STATUSES).default("draft"),
  })
  .refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, { path: ["endsOn"] });

export const donationSchema = z.object({
  campaignId: optUuid,
  donorId: optUuid,
  donorName: optText(160),
  donorEmail: optEmail,
  amount: z.coerce.number().positive().max(10_000_000),
  currency: optCurrency,
  donatedOn: dateKey,
  purpose: optText(300),
  method: z.enum(DONATION_METHODS),
  isAnonymous: bool.default(false),
  notes: optText(1000),
});

export const publicDonationSchema = z.object({
  campaignId: uuid,
  amount: z.coerce.number().min(1).max(100_000),
  name: text(1, 160),
  email: z.string().trim().toLowerCase().email().max(254),
  anonymous: bool.default(false),
});

/** First issue -> catalog key under operations.errors (falls back to "invalid"). */
export function opsErrorKey(issues: z.ZodIssue[]): string {
  const field = String(issues[0]?.path[0] ?? "");
  const known: Record<string, string> = {
    endTime: "timeOrder", endsOn: "dateOrder", validUntil: "dateOrder", contractEnd: "dateOrder", to: "dateOrder",
    teamId: "teamOrLabel", companyName: "companyRequired", shiftDays: "shiftDays", targetVenueId: "targetVenue",
    url: "httpsUrl", email: "email", contactEmail: "email", donorEmail: "email", slug: "slug", jerseyNumber: "jerseyNumber",
  };
  return `operations.errors.${known[field] ?? "invalid"}`;
}

/** Postgres / RPC error message -> catalog key under operations.errors. */
export function opsDbErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  const map: [RegExp, string][] = [
    [/NOT_ENOUGH_STOCK/, "notEnoughStock"],
    [/ALREADY_RETURNED/, "alreadyReturned"],
    [/HOLDER_REQUIRED/, "holderRequired"],
    [/INVALID_DUE_DATE/, "dueDate"],
    [/KIT_LOCKED/, "kitLocked"],
    [/INVALID_SIZE/, "invalidSize"],
    [/kit_assignments_jersey_uniq/, "jerseyTaken"],
    [/kit_assignments_team_id_athlete_id_key/, "kitExists"],
    [/SPACE_NOT_IN_VENUE/, "spaceNotInVenue"],
    [/CROSS_ORG_REFERENCE|CUSTOMER_NOT_FOUND|ITEM_NOT_FOUND|CHECKOUT_NOT_FOUND/, "notFound"],
    [/COMMITTEE_MISMATCH/, "committeeMismatch"],
    [/committees_org_id_name_key/, "nameTaken"],
    [/fundraising_campaigns_org_id_slug_key/, "slugTaken"],
    [/ops_customers_email_uniq/, "emailTaken"],
    [/events_space_no_overlap/, "spaceBooked"],
    [/NOT_AUTHORIZED|row-level security/, "forbidden"],
  ];
  return `operations.errors.${map.find(([re]) => re.test(m))?.[1] ?? "generic"}`;
}
