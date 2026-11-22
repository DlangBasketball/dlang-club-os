/**
 * Alumni & placements — shared, pure rules (client, server and unit tests).
 * Mirrors migration 20250420102800_alumni_placements.sql: value lists,
 * the minor rule, who to contact, the showcase consent filter, list filters
 * and the summary counts.
 */
import { z } from "zod";

export const INSTITUTION_TYPES = [
  "high_school", "prep_academy", "junior_college", "ncaa_d1", "ncaa_d2", "ncaa_d3", "naia", "u_sports",
  "club_amateur", "pro_club", "national_team", "other",
] as const;
export type InstitutionType = (typeof INSTITUTION_TYPES)[number];

export const SCHOLARSHIPS = ["full", "partial", "walk_on", "none", "unknown"] as const;
export type Scholarship = (typeof SCHOLARSHIPS)[number];

export const PLACEMENT_STATUSES = ["committed", "signed", "enrolled", "transferred", "graduated", "turned_pro", "left"] as const;
export type AlumniPlacementStatus = (typeof PLACEMENT_STATUSES)[number];

export const ALUMNI_STATUSES = ["active", "lost_touch", "do_not_contact"] as const;
export type AlumniStatus = (typeof ALUMNI_STATUSES)[number];

export const CONTACT_KINDS = ["email", "call", "whatsapp", "meeting", "note"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const DIRECTIONS = ["outbound", "inbound", "none"] as const;
export type ContactDirection = (typeof DIRECTIONS)[number];

export const GENDERS = ["female", "male", "other"] as const;
export const NAME_STYLES = ["initial", "full"] as const;

/** Summary card groups, in display order ("high schools / academies" share a card). */
export const COUNT_GROUPS = [
  { key: "ncaa_d1", types: ["ncaa_d1"] },
  { key: "ncaa_d2", types: ["ncaa_d2"] },
  { key: "ncaa_d3", types: ["ncaa_d3"] },
  { key: "naia", types: ["naia"] },
  { key: "junior_college", types: ["junior_college"] },
  { key: "u_sports", types: ["u_sports"] },
  { key: "schools", types: ["high_school", "prep_academy"] },
  { key: "pro", types: ["pro_club"] },
  { key: "national_team", types: ["national_team"] },
  { key: "clubs", types: ["club_amateur"] },
  { key: "other", types: ["other"] },
] as const satisfies readonly { key: string; types: readonly InstitutionType[] }[];
export type CountGroup = (typeof COUNT_GROUPS)[number]["key"];

/** Placements of a player-journey target (placement_targets.target_kind) -> institution type. */
export const TARGET_KIND_TO_TYPE: Record<string, InstitutionType> = {
  school: "high_school", academy: "prep_academy", club: "club_amateur", college: "other", other: "other",
};

export const MAJORITY_AGE = 18;

// ---------------------------------------------------------------------------
// Minor rule
// ---------------------------------------------------------------------------

/**
 * Possibly a minor? With a full birth date: under 18 on `today`. With a
 * birth year only: until the year they turn 19 (the birthday is unknown, so
 * we stay on the safe side). Unknown age: false (see showcaseEligible).
 */
export function isMinor(p: { birthYear?: number | null; birthDate?: string | null }, today: Date = new Date()): boolean {
  if (p.birthDate) {
    const [y, m, d] = p.birthDate.slice(0, 10).split("-").map(Number);
    if (y && m && d) {
      const ty = today.getUTCFullYear();
      const tm = today.getUTCMonth() + 1;
      const td = today.getUTCDate();
      const age = ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
      return age < MAJORITY_AGE;
    }
  }
  if (p.birthYear) return today.getUTCFullYear() - p.birthYear < MAJORITY_AGE + 1;
  return false;
}

export function ageKnown(p: { birthYear?: number | null; birthDate?: string | null }): boolean {
  return Boolean(p.birthYear || p.birthDate);
}

// ---------------------------------------------------------------------------
// Contact rules
// ---------------------------------------------------------------------------

export type ContactPerson = {
  firstName: string;
  lastName: string;
  birthYear: number | null;
  birthDate: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: boolean;
  guardianName: string | null;
  guardianEmail: string | null;
  guardianPhone: string | null;
  contactConsent: boolean;
  status: AlumniStatus;
};

export type ContactBlock = "do_not_contact" | "no_consent" | "no_email" | "no_phone";

export type ContactTarget = {
  /** Who we reach: the alumnus (adult) or the guardian (minor). */
  via: "self" | "guardian";
  name: string;
  email: string | null;
  phone: string | null;
  /** Digits for https://wa.me/<digits>, when WhatsApp is possible. */
  whatsapp: string | null;
  /** Why calling / emailing is blocked (empty = allowed). */
  emailBlocked: ContactBlock | null;
  phoneBlocked: ContactBlock | null;
  /** The club may send an email from its own sender (consent recorded). */
  canSendFromClub: boolean;
};

/** wa.me wants the full international number, digits only (no +, spaces, 00). */
export function whatsappDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else return null; // a national number cannot be dialled internationally
  return /^\d{7,15}$/.test(d) ? d : null;
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/**
 * Minors are reached through their guardian; "do not contact" blocks every
 * outreach. Sending an email from the club needs recorded contact consent.
 */
export function contactTarget(p: ContactPerson, today: Date = new Date()): ContactTarget {
  const minor = isMinor(p, today);
  const via = minor ? "guardian" : "self";
  const email = minor ? p.guardianEmail : p.email;
  const phone = minor ? p.guardianPhone : p.phone;
  const name = minor ? p.guardianName ?? "" : `${p.firstName} ${p.lastName}`.trim();
  const dnc = p.status === "do_not_contact";
  const emailBlocked: ContactBlock | null = dnc ? "do_not_contact" : !email ? "no_email" : null;
  const phoneBlocked: ContactBlock | null = dnc ? "do_not_contact" : !phone ? "no_phone" : null;
  return {
    via, name, email, phone,
    whatsapp: !dnc && phone && (minor || p.whatsapp) ? whatsappDigits(phone) : null,
    emailBlocked, phoneBlocked,
    canSendFromClub: !emailBlocked && p.contactConsent,
  };
}

/** Why the club may not send an email (null = it may). */
export function sendBlockReason(p: ContactPerson, today: Date = new Date()): ContactBlock | null {
  const t = contactTarget(p, today);
  if (t.emailBlocked) return t.emailBlocked;
  if (!p.contactConsent) return "no_consent";
  return null;
}

// ---------------------------------------------------------------------------
// Public showcase
// ---------------------------------------------------------------------------

export type ShowcaseCandidate = {
  firstName: string;
  lastName: string;
  birthYear: number | null;
  birthDate: string | null;
  showcaseConsent: boolean;
  showcaseGuardianConsent: boolean;
  showcaseNameStyle: "initial" | "full";
  status: AlumniStatus;
};

/** Mirrors alumni_public_showcase(): consent, adult (known age) or guardian consent, not "do not contact". */
export function showcaseEligible(a: ShowcaseCandidate, today: Date = new Date()): boolean {
  if (!a.showcaseConsent || a.status === "do_not_contact") return false;
  if (a.showcaseGuardianConsent) return true;
  return ageKnown(a) && !isMinor(a, today);
}

export function showcaseName(a: Pick<ShowcaseCandidate, "firstName" | "lastName" | "showcaseNameStyle">): string {
  return a.showcaseNameStyle === "full" ? `${a.firstName} ${a.lastName}` : `${a.firstName} ${a.lastName.slice(0, 1)}.`;
}

// ---------------------------------------------------------------------------
// List: current placement, filters, counts
// ---------------------------------------------------------------------------

export type PlacementLite = {
  id: string;
  institution: string;
  institution_type: InstitutionType;
  country: string | null;
  start_date: string | null;
  end_year: number | null;
  status: AlumniPlacementStatus;
  is_current: boolean;
  created_at: string;
};

export type AlumniListItem = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  status: AlumniStatus;
  tags: string[];
  birth_year: number | null;
  placements: PlacementLite[];
  /** Earliest open follow-up date (YYYY-MM-DD), if any. */
  follow_up_on: string | null;
};

/** The placement that describes the alumnus today: current first, then the latest. */
export function currentPlacement<P extends PlacementLite>(placements: P[]): P | null {
  const live = placements.filter((p) => p.status !== "left");
  const pool = live.length ? live : placements;
  return [...pool].sort((a, b) =>
    Number(b.is_current) - Number(a.is_current)
    || (b.start_date ?? "").localeCompare(a.start_date ?? "")
    || (b.end_year ?? 0) - (a.end_year ?? 0)
    || b.created_at.localeCompare(a.created_at))[0] ?? null;
}

export type AlumniFilters = {
  q?: string | null;
  type?: InstitutionType | null;
  country?: string | null;
  gradYear?: number | null;
  status?: AlumniStatus | null;
  followUp?: boolean;
};

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Parse list filters from URL search params (unknown values are ignored). */
export function parseFilters(sp: Record<string, string | string[] | undefined>): AlumniFilters {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || null;
  };
  const type = one("type");
  const status = one("status");
  const year = Number(one("year"));
  return {
    q: one("q")?.slice(0, 100) ?? null,
    type: type && (INSTITUTION_TYPES as readonly string[]).includes(type) ? (type as InstitutionType) : null,
    country: one("country")?.slice(0, 80) ?? null,
    gradYear: Number.isInteger(year) && year >= 1950 && year <= 2100 ? year : null,
    status: status && (ALUMNI_STATUSES as readonly string[]).includes(status) ? (status as AlumniStatus) : null,
    followUp: one("followUp") === "1",
  };
}

/** Filter the list: type / country / graduation year look at every placement of the person. */
export function filterAlumni<T extends AlumniListItem>(rows: T[], f: AlumniFilters, today: string): T[] {
  const q = f.q ? fold(f.q) : null;
  const country = f.country ? fold(f.country) : null;
  return rows.filter((r) => {
    if (f.status && r.status !== f.status) return false;
    if (f.followUp && !(r.follow_up_on && r.follow_up_on <= today)) return false;
    if (f.type && !r.placements.some((p) => p.institution_type === f.type)) return false;
    if (country && !r.placements.some((p) => p.country && fold(p.country) === country)) return false;
    if (f.gradYear && !r.placements.some((p) => p.end_year === f.gradYear)) return false;
    if (q) {
      const hay = fold([r.first_name, r.last_name, r.email ?? "", r.phone ?? "", ...r.tags, ...r.placements.map((p) => p.institution)].join(" "));
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export type AlumniCounts = { total: number; groups: { key: CountGroup; count: number }[]; followUpsDue: number };

/** People per group of their CURRENT placement (one person counts once). */
export function countAlumni(rows: AlumniListItem[], today: string): AlumniCounts {
  const by = new Map<string, number>();
  for (const r of rows) {
    const cur = currentPlacement(r.placements);
    if (!cur) continue;
    const g = COUNT_GROUPS.find((x) => (x.types as readonly string[]).includes(cur.institution_type));
    if (g) by.set(g.key, (by.get(g.key) ?? 0) + 1);
  }
  return {
    total: rows.length,
    groups: COUNT_GROUPS.map((g) => ({ key: g.key, count: by.get(g.key) ?? 0 })).filter((g) => g.count > 0),
    followUpsDue: rows.filter((r) => r.follow_up_on && r.follow_up_on <= today).length,
  };
}

/** Distinct countries and graduation years for the filter dropdowns. */
export function filterOptions(rows: AlumniListItem[]): { countries: string[]; years: number[] } {
  const countries = new Map<string, string>();
  const years = new Set<number>();
  for (const r of rows) for (const p of r.placements) {
    if (p.country) countries.set(fold(p.country), p.country);
    if (p.end_year) years.add(p.end_year);
  }
  return { countries: [...countries.values()].sort((a, b) => a.localeCompare(b)), years: [...years].sort((a, b) => b - a) };
}

// ---------------------------------------------------------------------------
// Input schemas (server actions)
// ---------------------------------------------------------------------------

export const uuid = z.string().uuid();
const opt = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(v)), "invalid");
const optDate = z.union([isoDate, z.literal(""), z.null(), z.undefined()]).transform((v) => (v ? v : null));
const optUrl = z.string().trim().max(500).optional().nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), "alumni.errors.url");
const optEmail = z.string().trim().toLowerCase().max(254).optional().nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.string().email().safeParse(v).success, "alumni.errors.email");
const optPhone = z.string().trim().max(40).optional().nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\+?[0-9 ().-]{4,40}$/.test(v), "alumni.errors.phone");
const optYear = (min: number, max: number) => z.union([z.coerce.number().int().min(min).max(max), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (typeof v === "number" ? v : null));

export const alumniSchema = z.object({
  id: uuid.optional().nullable(),
  athleteId: uuid.optional().nullable(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  birthYear: optYear(1900, 2100),
  birthDate: optDate,
  gender: z.enum(GENDERS).optional().nullable().or(z.literal("")).transform((v) => (v ? v : null)),
  nationality: opt(80),
  photoPath: opt(300),
  email: optEmail,
  phone: optPhone,
  whatsapp: z.boolean().default(false),
  instagram: opt(100),
  xHandle: opt(100),
  linkedinUrl: optUrl,
  highlightUrl: optUrl,
  guardianName: opt(160),
  guardianEmail: optEmail,
  guardianPhone: optPhone,
  contactConsent: z.boolean().default(false),
  contactConsentOn: optDate,
  contactConsentSource: opt(200),
  showcaseConsent: z.boolean().default(false),
  showcaseConsentOn: optDate,
  showcaseGuardianConsent: z.boolean().default(false),
  showcaseNameStyle: z.enum(NAME_STYLES).default("initial"),
  notes: opt(4000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  status: z.enum(ALUMNI_STATUSES).default("active"),
}).superRefine((v, ctx) => {
  if (v.birthDate && v.birthYear && Number(v.birthDate.slice(0, 4)) !== v.birthYear) {
    ctx.addIssue({ code: "custom", path: ["birthYear"], message: "alumni.errors.birthMismatch" });
  }
  if (isMinor({ birthYear: v.birthYear, birthDate: v.birthDate }) && (!v.guardianName || (!v.guardianEmail && !v.guardianPhone))) {
    ctx.addIssue({ code: "custom", path: ["guardianName"], message: "alumni.errors.ALUMNI_GUARDIAN_REQUIRED" });
  }
}).transform((v) => ({
  ...v,
  contactConsentOn: v.contactConsent ? v.contactConsentOn ?? new Date().toISOString().slice(0, 10) : v.contactConsentOn,
  showcaseConsentOn: v.showcaseConsent ? v.showcaseConsentOn ?? new Date().toISOString().slice(0, 10) : v.showcaseConsentOn,
}));
export type AlumniInput = z.input<typeof alumniSchema>;
export type AlumniValues = z.output<typeof alumniSchema>;

export const placementSchema = z.object({
  id: uuid.optional().nullable(),
  alumniId: uuid,
  institution: z.string().trim().min(1).max(160),
  institutionType: z.enum(INSTITUTION_TYPES).default("other"),
  country: opt(80),
  region: opt(120),
  league: opt(120),
  level: opt(120),
  sport: opt(60),
  position: opt(60),
  startDate: optDate,
  endYear: optYear(1950, 2100),
  scholarship: z.enum(SCHOLARSHIPS).default("unknown"),
  status: z.enum(PLACEMENT_STATUSES).default("committed"),
  isCurrent: z.boolean().default(true),
  sourceNote: opt(1000),
  rosterUrl: optUrl,
});
export type AlumniPlacementInput = z.input<typeof placementSchema>;

export const contactSchema = z.object({
  id: uuid.optional().nullable(),
  alumniId: uuid,
  kind: z.enum(CONTACT_KINDS).default("note"),
  direction: z.enum(DIRECTIONS).default("outbound"),
  summary: z.string().trim().min(1).max(4000),
  happenedAt: z.string().optional().nullable().refine((v) => !v || !Number.isNaN(Date.parse(v)), "invalid").transform((v) => (v ? new Date(v).toISOString() : null)),
  followUpOn: optDate,
});
export type ContactInput = z.input<typeof contactSchema>;

export const sendEmailSchema = z.object({
  alumniId: uuid,
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  followUpOn: optDate,
});
export type SendEmailInput = z.input<typeof sendEmailSchema>;

/** Row shape for inserts / updates (snake_case, DB columns). */
export function alumniToRow(v: AlumniValues) {
  return {
    athlete_id: v.athleteId ?? null, first_name: v.firstName, last_name: v.lastName, birth_year: v.birthYear, birth_date: v.birthDate,
    gender: v.gender, nationality: v.nationality, photo_path: v.photoPath, email: v.email, phone: v.phone, whatsapp: v.whatsapp,
    instagram: v.instagram, x_handle: v.xHandle, linkedin_url: v.linkedinUrl, highlight_url: v.highlightUrl,
    guardian_name: v.guardianName, guardian_email: v.guardianEmail, guardian_phone: v.guardianPhone,
    contact_consent: v.contactConsent, contact_consent_on: v.contactConsentOn, contact_consent_source: v.contactConsentSource,
    showcase_consent: v.showcaseConsent, showcase_consent_on: v.showcaseConsentOn, showcase_guardian_consent: v.showcaseGuardianConsent,
    showcase_name_style: v.showcaseNameStyle, notes: v.notes, tags: v.tags, status: v.status,
  };
}

export function placementToRow(v: z.output<typeof placementSchema>) {
  return {
    institution: v.institution, institution_type: v.institutionType, country: v.country, region: v.region, league: v.league,
    level: v.level, sport: v.sport, position: v.position, start_date: v.startDate, end_year: v.endYear, scholarship: v.scholarship,
    status: v.status, is_current: v.isCurrent, source_note: v.sourceNote, roster_url: v.rosterUrl,
  };
}

/** Database error codes with a translation under alumni.errors.<code>. */
export const ALUMNI_DB_CODES = ["ALUMNI_GUARDIAN_REQUIRED", "ALUMNI_DO_NOT_CONTACT", "CROSS_ORG_REFERENCE", "ALUMNI_IMMUTABLE"] as const;

export function alumniErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  const code = ALUMNI_DB_CODES.find((c) => m.includes(c));
  if (code) return `alumni.errors.${code}`;
  if (/uniq_alumni_athlete/.test(m)) return "alumni.errors.alreadyAlumni";
  if (/row-level security|permission denied/i.test(m)) return "alumni.errors.forbidden";
  return "alumni.errors.generic";
}
