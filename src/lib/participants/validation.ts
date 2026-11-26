import { z } from "zod";

/**
 * Participant profiles (migration 20250420105600_participant_profiles.sql):
 * validation, age rules and picker logic. Pure module (client + server +
 * unit tests). Every zod message is an i18n key (participants.errors.*); the
 * server action translates it with the caller's locale. The database checks
 * everything again (participant_* RPCs).
 */

export const PE = {
  required: "participants.errors.required",
  nameRequired: "participants.errors.NAME_REQUIRED",
  dobRequired: "participants.errors.DOB_REQUIRED",
  invalidDob: "participants.errors.INVALID_DOB",
  invalidSex: "participants.errors.INVALID_SEX",
  invalidHeight: "participants.errors.INVALID_HEIGHT",
  invalidWeight: "participants.errors.INVALID_WEIGHT",
  invalidJersey: "participants.errors.INVALID_JERSEY_NUMBER",
  tooLong: "participants.errors.TOO_LONG",
  invalidEmail: "participants.errors.invalidEmail",
  invalidRelation: "participants.errors.INVALID_RELATION",
  contactRequired: "participants.errors.contactRequired",
} as const;

/** Sex options of new forms. Stored legacy values (e.g. "other") stay readable. */
export const SEXES = ["male", "female"] as const;
export type Sex = (typeof SEXES)[number];

/** Relation of the requesting adult when linking to an existing child (family_members.relation). */
export const LINK_RELATIONS = ["mother", "father", "guardian", "aunt_uncle", "grandparent", "adult_sibling", "family_friend", "other"] as const;

/**
 * Scope of an approved link (20250420106300): the whole family (second parent
 * / co-guardian, family_members) or this child only (athlete_guardian_links).
 */
export const LINK_SCOPES = ["family", "athlete"] as const;
export type LinkScope = (typeof LINK_SCOPES)[number];

/** Relation of an adult linked to one child only. */
export const CHILD_LINK_RELATIONS = ["aunt_uncle", "grandparent", "adult_sibling", "family_friend", "other_carer"] as const;
export type ChildLinkRelation = (typeof CHILD_LINK_RELATIONS)[number];

/** Permissions of a per-child link (defaults for "This child only"). */
export const childLinkPermissionsSchema = z.object({
  relation: z.enum(CHILD_LINK_RELATIONS).default("other_carer"),
  canRegister: z.boolean().default(true),
  canPay: z.boolean().default(true),
  canSeeMedical: z.boolean().default(false),
  receivesEmails: z.boolean().default(true),
  canEditProfile: z.boolean().default(false),
  /** Activity consent by the linker: only effective while the club setting is ON. */
  // Granted by default with a per-child link (founder decision); counts only while the club setting is ON.
  canConsent: z.boolean().default(true),
}).refine((p) => !p.canRegister || p.canPay, { message: "participants.errors.REGISTER_NEEDS_PAY", path: ["canPay"] });
export type ChildLinkPermissions = z.output<typeof childLinkPermissionsSchema>;
export const DEFAULT_CHILD_LINK: ChildLinkPermissions = {
  relation: "other_carer", canRegister: true, canPay: true, canSeeMedical: false, receivesEmails: true, canEditProfile: false,
  canConsent: true,
};

/** Booking needs payment (a linker's bookings are invoiced to them): keep the pair consistent. */
export function normaliseChildLink(p: ChildLinkPermissions, changed: keyof ChildLinkPermissions): ChildLinkPermissions {
  if (changed === "canRegister" && p.canRegister) return { ...p, canPay: true };
  if (changed === "canPay" && !p.canPay) return { ...p, canRegister: false };
  return p;
}

/** Permissions payload of participant_link_decide / athlete_link_update. */
export function childLinkToRpc(p: ChildLinkPermissions): Record<string, string | boolean> {
  return {
    relation: p.relation, can_register: p.canRegister, can_pay: p.canPay, can_see_medical: p.canSeeMedical,
    receives_emails: p.receivesEmails, can_edit_profile: p.canEditProfile, can_consent: p.canConsent,
  };
}

/** Invite a relative / friend by e-mail for one child (permissions as a per-child link). */
export const relativeInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("participants.errors.INVALID_EMAIL").max(254, "participants.errors.INVALID_EMAIL"),
  permissions: childLinkPermissionsSchema,
});
export type RelativeInviteInput = z.input<typeof relativeInviteSchema>;

/** Invitation link token shape (32 random bytes, base64url). */
export function isInviteToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** "Someone else": how the booker knows the participant. */
export const BOOKER_RELATIONS = ["nephew_niece", "friends_child", "other"] as const;

/** Suggested basketball positions (free text is still accepted: other sports, other labels). */
export const POSITION_SUGGESTIONS = ["point_guard", "shooting_guard", "small_forward", "power_forward", "center"] as const;

export const JERSEY_SIZES = ["YS", "YM", "YL", "S", "M", "L", "XL", "XXL"] as const;

/** Error codes raised by the participant RPCs (participants.errors.<CODE>). */
export const PARTICIPANT_ERROR_CODES = [
  "NOT_AUTHENTICATED", "NO_ORG", "REQUEST_ID_REQUIRED", "REQUEST_ID_REUSED", "NAME_REQUIRED", "DOB_REQUIRED", "INVALID_DOB",
  "INVALID_SEX", "INVALID_HEIGHT", "INVALID_WEIGHT", "INVALID_JERSEY_NUMBER", "TOO_LONG", "FAMILY_NOT_FOUND", "NOT_FOUND",
  "NOT_ALLOWED", "FIELD_NOT_ALLOWED", "SELF_MUST_BE_ADULT", "INVALID_DATE", "REVIEW_REQUIRED", "INVALID_DECISION",
  "INVALID_RELATION", "NO_MATCH", "EXPIRED", "THIRD_PARTY_NOT_ENABLED",
  // 20250420106300_flexible_links_finance_scope.sql
  "INVALID_SCOPE", "REGISTER_NEEDS_PAY", "LINK_NOT_ACTIVE", "NO_GUARDIAN_CONTACT",
  // 20250420106500_relative_invites_carer_consent.sql
  "TOKEN_REQUIRED", "INVALID_EMAIL", "CANNOT_INVITE_SELF", "ALREADY_GUARDIAN", "ALREADY_LINKED", "INVITE_LIMIT", "RATE_LIMITED",
  "INVITE_NOT_PENDING", "INVITE_USED", "EMAIL_MISMATCH", "CARER_CONSENT_DISABLED", "MEMBERSHIP_SUSPENDED",
] as const;
export type ParticipantErrorCode = (typeof PARTICIPANT_ERROR_CODES)[number];

/** First known error code in a database / action message, else null. */
export function participantErrorCode(message: string | null | undefined): ParticipantErrorCode | null {
  const m = message ?? "";
  return (PARTICIPANT_ERROR_CODES as readonly string[]).find((c) => new RegExp(`\\b${c}\\b`).test(m)) as ParticipantErrorCode | undefined ?? null;
}

// ---------------------------------------------------------------------------
// Ages
// ---------------------------------------------------------------------------
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: string | null | undefined): v is string {
  return !!v && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
}

/** Whole years between dob and `on` (both YYYY-MM-DD), like Postgres age(); null when unknown. */
export function ageOn(dob: string | null | undefined, on: string | null | undefined): number | null {
  if (!isIsoDate(dob) || !isIsoDate(on)) return null;
  const [y1, m1, d1] = dob.split("-").map(Number);
  const [y2, m2, d2] = on.split("-").map(Number);
  let age = y2 - y1;
  if (m2 < m1 || (m2 === m1 && d2 < d1)) age -= 1;
  return age;
}

export const ADULT_AGE = 18;

/** "Myself" is for adults only: 18+ on the activity date. */
export function isAdultOn(dob: string | null | undefined, on: string): boolean {
  const a = ageOn(dob, on);
  return a !== null && a >= ADULT_AGE;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const name = z.string().trim().min(1, PE.nameRequired).max(80, PE.tooLong);
const dob = z
  .string()
  .trim()
  .min(1, PE.dobRequired)
  .refine((v) => isIsoDate(v), PE.invalidDob)
  .refine((v) => v >= "1900-01-02" && new Date(`${v}T00:00:00Z`).getTime() <= Date.now(), PE.invalidDob);

/** Optional number field from a form ("" = not set / cleared). */
const optNumber = (min: number, max: number, msg: string, integer = false) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
      const n = typeof v === "number" ? v : Number(v.trim().replace(",", "."));
      if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
        return z.NEVER;
      }
      return integer ? n : Math.round(n * 10) / 10;
    });
const optText = (max: number) =>
  z.string().trim().max(max, PE.tooLong).optional().nullable().transform((v) => (v ? v : null));

export const sportsSchema = z.object({
  heightCm: optNumber(40, 250, PE.invalidHeight),
  weightKg: optNumber(10, 250, PE.invalidWeight),
  positionPref: optText(60),
  jerseySize: optText(10),
  preferredJerseyNumber: optNumber(0, 999, PE.invalidJersey, true),
});
export type SportsInput = z.input<typeof sportsSchema>;
export type SportsData = z.output<typeof sportsSchema>;

export const participantCreateSchema = sportsSchema.extend({
  firstName: name,
  lastName: name,
  dob,
  sex: z.enum(SEXES, { message: PE.invalidSex }),
  /** After POSSIBLE_MATCH: "this is a different child" creates a new (flagged) profile. */
  decision: z.enum(["different"]).optional(),
});
export type ParticipantCreateInput = z.input<typeof participantCreateSchema>;

export const selfProfileSchema = z.object({
  firstName: name,
  lastName: name,
  dob,
  sex: z.enum(["", ...SEXES], { message: PE.invalidSex }).optional().default("").transform((v) => v || null),
  /** Activity date: "Myself" must be 18+ on it (default: today). */
  at: z.string().trim().optional().nullable().refine((v) => !v || isIsoDate(v), PE.invalidDob).transform((v) => v || null),
});
export type SelfProfileInput = z.input<typeof selfProfileSchema>;

export const participantUpdateSchema = sportsSchema.extend({
  firstName: name,
  lastName: name,
  dob,
  /** A stored legacy value (e.g. "other") may be sent back unchanged; the database refuses a NEW one. */
  sex: z.string().trim().max(20, PE.tooLong).optional().nullable().transform((v) => (v ? v.toLowerCase() : null)),
});
export type ParticipantUpdateInput = z.input<typeof participantUpdateSchema>;

export const linkRequestSchema = z.object({
  firstName: name,
  lastName: name,
  dob,
  relation: z.enum(LINK_RELATIONS, { message: PE.invalidRelation }).default("guardian"),
});
export type LinkRequestInput = z.input<typeof linkRequestSchema>;

export const linkPermissionsSchema = z.object({
  canPay: z.boolean().default(false),
  canSeeMedical: z.boolean().default(false),
  receivesEmails: z.boolean().default(true),
});
export type LinkPermissions = z.output<typeof linkPermissionsSchema>;

const email = z.string().trim().max(254, PE.tooLong).email(PE.invalidEmail);

/**
 * "Someone else": a participant who is not in the booker's family. The booker
 * (payer) stays separate from the participant and from the participant's own
 * parent / legal guardian, who is asked for consent (Workstream B).
 */
export const thirdPartySchema = z
  .object({
    firstName: name,
    lastName: name,
    dob,
    sex: z.enum(SEXES, { message: PE.invalidSex }),
    guardianName: z.string().trim().min(1, PE.required).max(140, PE.tooLong),
    guardianEmail: z.union([email, z.literal("")]).optional().transform((v) => v || null),
    guardianPhone: z.string().trim().max(40, PE.tooLong).optional().transform((v) => v || null),
    relation: z.enum(BOOKER_RELATIONS, { message: PE.invalidRelation }),
  })
  .refine((v) => !!v.guardianEmail || !!v.guardianPhone, { message: PE.contactRequired, path: ["guardianEmail"] });
export type ThirdPartyInput = z.input<typeof thirdPartySchema>;

/** First issue's i18n key. */
export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? PE.required;
}

/** RPC payloads (snake_case, only the keys that were given). */
export function sportsToRpc(d: Partial<SportsData>): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  if ("heightCm" in d) out.height_cm = d.heightCm ?? null;
  if ("weightKg" in d) out.weight_kg = d.weightKg ?? null;
  if ("positionPref" in d) out.position_pref = d.positionPref ?? null;
  if ("jerseySize" in d) out.jersey_size = d.jerseySize ?? null;
  if ("preferredJerseyNumber" in d) out.preferred_jersey_number = d.preferredJerseyNumber ?? null;
  return out;
}

// ---------------------------------------------------------------------------
// Picker logic
// ---------------------------------------------------------------------------
/**
 * "other" = someone outside the family (Workstream B: third-party participant awaiting guardian consent);
 * "linked" = a child the adult is linked to on its own ("This child only"; relation label). Both book
 * through the guardian consent flow.
 */
export type ParticipantKind = "self" | "child" | "other" | "linked";
export type ParticipantOption = { id: string; name: string; dob: string | null; kind: ParticipantKind; relation?: string | null };
export type PickerMode = "self" | "child" | "linked" | "other";

/** Self profile state for the picker: none yet (create on first use) or the existing one. */
export type SelfState = { athleteId: string | null; dob: string | null; firstName: string; lastName: string };

/** Modes the picker offers. "Myself" disappears when the self profile is known to be a minor on the date. */
export function pickerModes(opts: { allowSelf: boolean; allowOther: boolean; self: SelfState | null; on: string; hasLinked?: boolean }): PickerMode[] {
  const modes: PickerMode[] = [];
  if (opts.allowSelf && opts.self && !(opts.self.dob && !isAdultOn(opts.self.dob, opts.on))) modes.push("self");
  modes.push("child");
  // Linked children book through the same guardian-consent flow as "Someone else".
  if (opts.allowOther && opts.hasLinked) modes.push("linked");
  if (opts.allowOther) modes.push("other");
  return modes;
}

/** Picker mode of a participant. */
export function participantMode(p: Pick<ParticipantOption, "kind">): PickerMode {
  return p.kind === "self" ? "self" : p.kind === "other" ? "other" : p.kind === "linked" ? "linked" : "child";
}

/** Booked through the guardian consent flow (not the adult's own family). */
export function needsGuardianConsent(p: Pick<ParticipantOption, "kind">): boolean {
  return p.kind === "other" || p.kind === "linked";
}

/** Initial mode: the mode of the current selection, else children. */
export function initialMode(selected: string[], participants: ParticipantOption[], modes: PickerMode[]): PickerMode {
  const first = participants.find((p) => selected.includes(p.id));
  if (first?.kind === "self" && modes.includes("self")) return "self";
  if (first?.kind === "linked" && modes.includes("linked")) return "linked";
  return modes.includes("child") ? "child" : modes[0];
}

/** Merge newly created participants into the server list (dedupe by id, keep order). */
export function mergeParticipants(base: ParticipantOption[], added: ParticipantOption[]): ParticipantOption[] {
  const seen = new Set(base.map((p) => p.id));
  return [...base, ...added.filter((p) => !seen.has(p.id) && (seen.add(p.id), true))];
}

/** Toggle / select a participant id (single: replace; multiple: toggle). */
export function selectParticipant(current: string[], id: string, multiple: boolean): string[] {
  if (!multiple) return [id];
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
}
