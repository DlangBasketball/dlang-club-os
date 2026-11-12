import { z } from "zod";

/**
 * Validation and pure helpers for coach management (admin /admin/coaches,
 * the team form's quick-add, coach photos).
 *
 * Pure module: shared by server actions, pages and unit tests. Every zod
 * message is an i18n key under coaches.errors.* that the action translates
 * with the caller's locale. Ids are shape-checked here only; the server
 * action re-resolves every row inside the caller's org.
 */

export const COACH_ERR = {
  required: "coaches.errors.required",
  tooLong: "coaches.errors.tooLong",
  invalidId: "coaches.errors.invalidId",
  invalidService: "coaches.errors.invalidService",
} as const;

export const COACH_NAME_MAX = 120;
export const COACH_TITLE_MAX = 120;
export const COACH_BIO_MAX = 1000;

/** Optional free text: "" and whitespace become null. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, COACH_ERR.tooLong)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const displayName = z
  .string({ required_error: COACH_ERR.required, invalid_type_error: COACH_ERR.required })
  .trim()
  .min(1, COACH_ERR.required)
  .max(COACH_NAME_MAX, COACH_ERR.tooLong);

/** training_services.slug values the coach offers (player-development bookings). */
const serviceSlug = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, COACH_ERR.invalidService);

export const coachSchema = z.object({
  displayName,
  roleTitle: optText(COACH_TITLE_MAX),
  bio: optText(COACH_BIO_MAX),
  isActive: z.boolean().default(true),
  serves: z
    .array(serviceSlug)
    .max(30, COACH_ERR.tooLong)
    .default([])
    .transform((v) => Array.from(new Set(v))),
});
export type CoachInput = z.input<typeof coachSchema>;
export type CoachData = z.output<typeof coachSchema>;

/** Team form "+ New coach": name and title only. */
export const quickCoachSchema = z.object({
  displayName,
  roleTitle: optText(COACH_TITLE_MAX),
});
export type QuickCoachInput = z.input<typeof quickCoachSchema>;

export const coachIdSchema = z.string().trim().uuid(COACH_ERR.invalidId);

/** First zod issue as an i18n key. */
export function coachIssueKey(err: z.ZodError): string {
  return err.issues[0]?.message ?? COACH_ERR.required;
}

// ---------------------------------------------------------------------------
// Usage (references that block a hard delete)
// ---------------------------------------------------------------------------
export const USAGE_KINDS = ["teams", "sessions", "attendance", "availability", "bookings"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];
export type CoachUsage = Record<UsageKind, number>;

/** Normalise the jsonb returned by public.coach_usage(); unknown/missing = 0. */
export function parseUsage(raw: unknown): CoachUsage {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as CoachUsage;
  for (const k of USAGE_KINDS) {
    const n = Number(src[k]);
    out[k] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return out;
}

export function usageTotal(u: CoachUsage): number {
  return USAGE_KINDS.reduce((sum, k) => sum + u[k], 0);
}

/** A coach can be hard-deleted only when nothing references it. */
export function canHardDelete(u: CoachUsage): boolean {
  return usageTotal(u) === 0;
}

// ---------------------------------------------------------------------------
// List search / filter
// ---------------------------------------------------------------------------
export const COACH_STATUS_FILTERS = ["all", "active", "inactive"] as const;
export type CoachStatusFilter = (typeof COACH_STATUS_FILTERS)[number];

export function parseStatusFilter(v: string | null | undefined): CoachStatusFilter {
  return (COACH_STATUS_FILTERS as readonly string[]).includes(v ?? "") ? (v as CoachStatusFilter) : "all";
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Case- and accent-insensitive match on name, title and team names (every word must match). */
export function matchesCoachSearch(
  coach: { name: string; title?: string | null; teams?: string[] },
  query: string | null | undefined,
): boolean {
  const words = fold(query ?? "").split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([coach.name, coach.title ?? "", ...(coach.teams ?? [])].join(" "));
  return words.every((w) => hay.includes(w));
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------
export const COACH_PHOTO_BUCKET = "coach-photos";

/** Map a database error message from the coach RPCs to an i18n key. */
export function coachDbErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  if (m.includes("COACH_IN_USE")) return "coaches.errors.inUse";
  if (m.includes("NOT_FOUND")) return "coaches.errors.notFound";
  if (m.includes("FORBIDDEN") || m.includes("row-level security")) return "coaches.errors.forbidden";
  if (m.includes("INVALID_PATH") || m.includes("coaches_photo_path_scope")) return "coaches.errors.photoPath";
  return "coaches.errors.generic";
}
