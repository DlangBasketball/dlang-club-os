import { z } from "zod";
import { monthDay, parseDate, splitInstalments } from "../payments/plans";
import { fromMinorUnits, toMinorUnits } from "../payments/currency";

/**
 * Selection programmes (pure; shared by pages, server actions and tests).
 *
 * A programme players APPLY to: divisions (age groups), packages with their
 * own instalment rules, coach approval. The database enforces the same rules
 * (migration 20250420102600_selection_programs.sql):
 *   selectionTransitionOk  <-> public.selection_transition_ok
 *   suggestDivision        <-> public.selection_suggest_division
 *   packageSchedule        <-> public.selection_due_dates + plan_split
 * Validation messages are i18n keys under `selection.errors.*`.
 * Relative imports only: the payments test runner loads this file directly.
 */

export const APPLICATION_STATUSES = ["applied", "under_review", "accepted", "waitlisted", "declined", "enrolled", "withdrawn"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Statuses a reviewer (coach / admin) may set. */
export const DECISION_STATUSES = ["under_review", "accepted", "waitlisted", "declined"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

const NEXT: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  applied: ["under_review", "accepted", "waitlisted", "declined", "withdrawn"],
  under_review: ["accepted", "waitlisted", "declined", "withdrawn"],
  waitlisted: ["under_review", "accepted", "declined", "withdrawn"],
  declined: ["under_review"],
  accepted: ["enrolled", "waitlisted", "withdrawn"],
  enrolled: ["withdrawn"],
  withdrawn: [],
};

export function selectionTransitionOk(from: string, to: string): boolean {
  return (APPLICATION_STATUSES as readonly string[]).includes(from) && (NEXT[from as ApplicationStatus] as readonly string[]).includes(to);
}

/** Next statuses a reviewer can pick for an application (no system-only steps). */
export function reviewerChoices(from: ApplicationStatus): DecisionStatus[] {
  return DECISION_STATUSES.filter((s) => selectionTransitionOk(from, s));
}

/** The family may change the package until money is received or a plan exists. */
export function packageChangeAllowed(a: { status: string; paid: number; hasPlan: boolean }): boolean {
  return ["applied", "under_review", "waitlisted", "accepted"].includes(a.status) && a.paid <= 0 && !a.hasPlan;
}

export function isLive(status: string): boolean {
  return status !== "declined" && status !== "withdrawn";
}

// ---------------------------------------------------------------------------
// Divisions
// ---------------------------------------------------------------------------
export type DivisionRule = {
  id: string;
  name: string;
  minBirthYear: number | null;
  maxBirthYear: number | null;
  /** "Under N": younger than N on ageCutoff (null = today). */
  ageUnder: number | null;
  ageCutoff: string | null;
  sort: number;
  isActive: boolean;
};

/** Whole years between a date of birth and a day (YYYY-MM-DD). */
export function ageOn(dob: string, on: string): number {
  const b = parseDate(dob);
  const d = parseDate(on);
  let age = d.y - b.y;
  if (d.m < b.m || (d.m === b.m && d.d < b.d)) age -= 1;
  return age;
}

export function divisionMatches(d: DivisionRule, dob: string, today: string): boolean {
  if (!d.isActive) return false;
  const year = parseDate(dob).y;
  if (d.minBirthYear != null && year < d.minBirthYear) return false;
  if (d.maxBirthYear != null && year > d.maxBirthYear) return false;
  if (d.ageUnder != null && ageOn(dob, d.ageCutoff ?? today) >= d.ageUnder) return false;
  return true;
}

/** First matching division (by sort, then name), or null. */
export function suggestDivision(divisions: readonly DivisionRule[], dob: string | null | undefined, today: string): string | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const sorted = [...divisions].sort((a, b) => a.sort - b.sort || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return sorted.find((d) => divisionMatches(d, dob, today))?.id ?? null;
}

// ---------------------------------------------------------------------------
// Packages and instalments
// ---------------------------------------------------------------------------
export const MAX_INSTALMENTS = 24;

export type PackageRule = { id: string; name: string; price: number; allowedCounts: number[]; showMonthly: boolean };

/** Allowed counts, sorted, de-duplicated, always including 1 (pay in full). */
export function normaliseCounts(counts: readonly number[]): number[] {
  const set = new Set<number>([1]);
  for (const n of counts) if (Number.isInteger(n) && n >= 1 && n <= MAX_INSTALMENTS) set.add(n);
  return Array.from(set).sort((a, b) => a - b);
}

/** "1-5" style input -> counts (accepts "1,2,3", "1-10", "1-4, 6"). Null on invalid input. */
export function parseCounts(input: string): number[] | null {
  const out: number[] = [];
  for (const part of input.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)) {
    const range = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(part);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a < 1 || b > MAX_INSTALMENTS || b < a) return null;
      for (let n = a; n <= b; n++) out.push(n);
    } else if (/^\d{1,2}$/.test(part)) {
      const n = Number(part);
      if (n < 1 || n > MAX_INSTALMENTS) return null;
      out.push(n);
    } else return null;
  }
  return out.length ? normaliseCounts(out) : null;
}

/** "1-5" display for counts (compact ranges). */
export function formatCounts(counts: readonly number[]): string {
  const xs = normaliseCounts(counts);
  const parts: string[] = [];
  let start = xs[0];
  let prev = xs[0];
  for (let i = 1; i <= xs.length; i++) {
    const n = xs[i];
    if (n === prev + 1) { prev = n; continue; }
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = n; prev = n;
  }
  return parts.join(", ");
}

/** Monthly amount at the largest allowed count ("from CHF 300 / month x 10"). */
export function monthlyFrom(price: number, counts: readonly number[], currency: string): { amount: number; count: number } {
  const xs = normaliseCounts(counts);
  const count = xs[xs.length - 1];
  const minor = toMinorUnits(price, currency);
  return { amount: fromMinorUnits(Math.ceil(minor / count), currency), count };
}

export function countAllowed(pkg: Pick<PackageRule, "allowedCounts">, count: number): boolean {
  return normaliseCounts(pkg.allowedCounts).includes(count);
}

/** Monthly schedule from `start` (first instalment on that day; month-end clamping). */
export function packageDueDates(start: string, count: number): string[] {
  const { y, m, d } = parseDate(start);
  return Array.from({ length: count }, (_, k) => monthDay(y, m, k, d));
}

export type ScheduleLine = { seq: number; dueDate: string; amount: number };

/** Instalments for `balance` in `count` months from `start`; remainder on the last one. */
export function packageSchedule(balance: number, count: number, currency: string, start: string): ScheduleLine[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALMENTS) throw new Error("Instalment count must be 1-24");
  const amounts = splitInstalments(balance, count, currency);
  const dates = packageDueDates(start, count);
  return amounts.map((amount, i) => ({ seq: i + 1, dueDate: dates[i], amount }));
}

// ---------------------------------------------------------------------------
// Form validation (admin set-up, applications)
// ---------------------------------------------------------------------------
const yearOpt = z.union([z.literal(""), z.null(), z.coerce.number().int().min(1900, "selection.errors.year").max(2200, "selection.errors.year")])
  .optional().transform((v) => (v === "" || v == null ? null : v));

export const divisionSchema = z.object({
  name: z.string().trim().min(1, "selection.errors.nameRequired").max(60, "selection.errors.tooLong"),
  minBirthYear: yearOpt,
  maxBirthYear: yearOpt,
  ageUnder: z.union([z.literal(""), z.null(), z.coerce.number().int().min(1, "selection.errors.age").max(99, "selection.errors.age")])
    .optional().transform((v) => (v === "" || v == null ? null : v)),
  ageCutoff: z.union([z.literal(""), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "selection.errors.date")])
    .optional().transform((v) => (v ? v : null)),
  teamId: z.union([z.literal(""), z.null(), z.string().uuid("selection.errors.invalid")]).optional().transform((v) => (v ? v : null)),
  /** "create": a new team for the division (default name "<programme> <division>"); "link": teamId; "none": no team. */
  teamMode: z.enum(["create", "link", "none"]).optional().default("link"),
  teamName: z.string().trim().max(120, "selection.errors.tooLong").optional().default(""),
  capacity: z.union([z.literal(""), z.null(), z.coerce.number().int().min(1, "selection.errors.capacity").max(10000, "selection.errors.capacity")])
    .optional().transform((v) => (v === "" || v == null ? null : v)),
  sort: z.coerce.number().int().min(0).max(1000).optional().default(0),
  isActive: z.boolean().optional().default(true),
}).refine((v) => v.minBirthYear == null || v.maxBirthYear == null || v.maxBirthYear >= v.minBirthYear,
  { message: "selection.errors.yearRange", path: ["maxBirthYear"] });
export type DivisionInput = z.input<typeof divisionSchema>;

export const packageSchema = z.object({
  name: z.string().trim().min(1, "selection.errors.nameRequired").max(80, "selection.errors.tooLong"),
  description: z.string().trim().max(500, "selection.errors.tooLong").optional().default(""),
  price: z.coerce.number({ invalid_type_error: "selection.errors.price" }).positive("selection.errors.price").max(1_000_000, "selection.errors.price"),
  counts: z.string().trim().min(1, "selection.errors.counts").transform((s, ctx) => {
    const c = parseCounts(s);
    if (!c) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: "selection.errors.counts" }); return z.NEVER; }
    return c;
  }),
  showMonthly: z.boolean().optional().default(true),
  sort: z.coerce.number().int().min(0).max(1000).optional().default(0),
  isActive: z.boolean().optional().default(true),
  // Roster fee arrangements (migration 20250420102900): optional.
  tournamentCount: z.union([z.literal(""), z.null(), z.coerce.number().int().min(1, "roster.errors.tournamentCount").max(50, "roster.errors.tournamentCount")])
    .optional().transform((v) => (v === "" || v == null ? null : v)),
  monthlyAmount: z.union([z.literal(""), z.null(), z.coerce.number().positive("roster.errors.INVALID_MONTHLY_AMOUNT").max(1_000_000, "roster.errors.INVALID_MONTHLY_AMOUNT")])
    .optional().transform((v) => (v === "" || v == null ? null : v)),
});
export type PackageInput = z.input<typeof packageSchema>;

export const settingsSchema = z.object({
  selectionEnabled: z.boolean(),
  requiresApproval: z.boolean(),
  allowNonMembers: z.boolean(),
});

const optText = (max: number) => z.string().trim().max(max, "selection.errors.tooLong").optional().default("");
export const applicationExtrasSchema = z.object({
  currentClub: optText(120),
  position: optText(60),
  notes: optText(2000),
  videoUrl: z.union([z.literal(""), z.string().trim().max(500, "selection.errors.tooLong").regex(/^https:\/\/\S+$/i, "selection.errors.videoUrl")])
    .optional().default(""),
});

export const decisionSchema = z.object({
  status: z.union([z.enum(DECISION_STATUSES), z.literal("enrolled"), z.literal("")]).optional().default(""),
  note: optText(2000),
  staffNotes: z.string().trim().max(2000, "selection.errors.tooLong").optional(),
  divisionId: z.union([z.literal(""), z.string().uuid()]).optional().default(""),
}).refine((v) => v.status !== "declined" || v.note.length > 0, { message: "selection.errors.noteRequired", path: ["note"] });
export type DecisionInput = z.input<typeof decisionSchema>;
