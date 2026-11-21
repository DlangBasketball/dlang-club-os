/**
 * Remove a person everywhere: shared, pure helpers (no server imports, so
 * client components and unit tests can use them).
 *
 * The database does the work (supabase/migrations/20250420102500_person_delete.sql):
 *   preview_delete_athlete / preview_delete_family -> DeleteImpact
 *   delete_athlete / delete_family (mode archive | erase), remove_guardian,
 *   restore_person, erase_person_deletion, purge_due_person_deletions.
 */
import { z } from "zod";

export type PersonKind = "athlete" | "family";
export type DeleteMode = "archive" | "erase";

/** Statuses that hide an athlete from every list, roster, export and count. */
export const HIDDEN_ATHLETE_STATUSES = ["archived", "erased"] as const;
/** PostgREST filter value: `.not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER)`. */
export const HIDDEN_ATHLETE_STATUS_FILTER = `(${HIDDEN_ATHLETE_STATUSES.join(",")})`;
/** Families are listed only while active (archived / erased tombstones are hidden). */
export const VISIBLE_FAMILY_STATUS = "active";
/** Days an archived person can be restored before the daily purge erases them. */
export const RESTORE_WINDOW_DAYS = 30;
/** Admins are told this many days before the purge. */
export const PURGE_NOTICE_DAYS = 3;

export function isHiddenAthleteStatus(status: string | null | undefined): boolean {
  return (HIDDEN_ATHLETE_STATUSES as readonly string[]).includes(status ?? "");
}

export type CancelledAmount = { currency: string; amount: number };

/** Counts per section, as returned by the preview / delete RPCs. */
export type DeleteImpact = {
  kind: PersonKind;
  id: string;
  status?: string;
  mode?: DeleteMode;
  athletes: number;
  guardians: number;
  teams: number;
  registrations: number;
  programmes: number;
  camps: number;
  bookings: number;
  waitlists: number;
  memberships: number;
  carpools: number;
  rsvps: number;
  kit: number;
  invoicesCancelled: number;
  invoicesCancelledAmounts: CancelledAmount[];
  invoicesKept: number;
  paymentPlans: number;
  autopay: number;
  documents: number;
  photos: number;
  records: number;
  tables: Record<string, number>;
  blocked: string[];
};

const num = z.coerce.number().int().nonnegative().catch(0);

const impactSchema = z.object({
  kind: z.enum(["athlete", "family"]),
  id: z.string(),
  status: z.string().optional().catch(undefined),
  mode: z.enum(["archive", "erase"]).optional().catch(undefined),
  athletes: num, guardians: num, teams: num, registrations: num, programmes: num, camps: num,
  bookings: num, waitlists: num, memberships: num, carpools: num, rsvps: num, kit: num,
  invoices_cancelled: num,
  invoices_cancelled_amounts: z.array(z.object({ currency: z.string(), amount: z.coerce.number() })).catch([]),
  invoices_kept: num, payment_plans: num, autopay: num, documents: num, photos: num, records: num,
  tables: z.record(z.coerce.number()).catch({}),
  blocked: z.array(z.string()).catch([]),
});

/** Parse the RPC's JSON into a DeleteImpact (missing counts read as 0). */
export function parseImpact(raw: unknown): DeleteImpact | null {
  const p = impactSchema.safeParse(raw);
  if (!p.success) return null;
  const d = p.data;
  return {
    kind: d.kind, id: d.id, status: d.status, mode: d.mode,
    athletes: d.athletes, guardians: d.guardians, teams: d.teams, registrations: d.registrations,
    programmes: d.programmes, camps: d.camps, bookings: d.bookings, waitlists: d.waitlists,
    memberships: d.memberships, carpools: d.carpools, rsvps: d.rsvps, kit: d.kit,
    invoicesCancelled: d.invoices_cancelled, invoicesCancelledAmounts: d.invoices_cancelled_amounts,
    invoicesKept: d.invoices_kept, paymentPlans: d.payment_plans, autopay: d.autopay,
    documents: d.documents, photos: d.photos, records: d.records, tables: d.tables, blocked: d.blocked,
  };
}

/** Sections of the confirmation summary, in display order. Message keys live under personDelete.impact. */
export const IMPACT_SECTIONS = [
  "teams", "programmes", "camps", "bookings", "waitlists", "memberships", "carpools", "rsvps", "kit",
  "paymentPlans", "autopay", "documents", "photos", "guardians",
] as const;
export type ImpactSection = (typeof IMPACT_SECTIONS)[number];

export type ImpactLine =
  | { key: ImpactSection; count: number }
  | { key: "invoicesCancelled"; count: number; amounts: CancelledAmount[] }
  | { key: "invoicesKept"; count: number };

/**
 * The non-empty lines of a summary, sections first, then money: what gets
 * cancelled, then what is kept for accounting (always shown when > 0).
 */
export function impactLines(impact: DeleteImpact): ImpactLine[] {
  const lines: ImpactLine[] = [];
  for (const key of IMPACT_SECTIONS) {
    const count = impact[key];
    if (count > 0) lines.push({ key, count });
  }
  if (impact.invoicesCancelled > 0) lines.push({ key: "invoicesCancelled", count: impact.invoicesCancelled, amounts: impact.invoicesCancelledAmounts });
  if (impact.invoicesKept > 0) lines.push({ key: "invoicesKept", count: impact.invoicesKept });
  return lines;
}

/** Amounts per currency, formatted and joined ("CHF 300.00 + EUR 20.00"). */
export function formatAmounts(amounts: CancelledAmount[], money: (amount: number, currency: string) => string): string {
  return amounts
    .filter((a) => a.amount !== 0)
    .sort((a, b) => a.currency.localeCompare(b.currency))
    .map((a) => money(a.amount, a.currency))
    .join(" + ");
}

/**
 * Group the planner's table counts (rows an erase removes) into the areas
 * an admin recognises, for the "details" list of the confirmation dialog.
 * Tables added later fall into "other" automatically.
 */
export const TABLE_GROUPS: Record<string, readonly string[]> = {
  profile: ["athletes", "families", "athlete_medical", "athlete_identifiers", "athlete_training_profiles", "family_members"],
  teams: ["team_memberships", "kit_assignments", "event_rsvps", "event_athlete_stats", "member_cards"],
  registrations: ["registrations", "registration_answers", "waitlist_entries", "memberships", "invitations"],
  training: ["training_bookings", "training_credits", "training_package_purchases", "attendance_marks", "training_plan_assignments", "training_plan_completions"],
  development: ["evaluations", "wellness_checkins", "nutrition_plans", "nutrition_plan_assignments", "player_season_reviews", "placement_targets", "scout_profiles"],
  documents: ["documents", "form_submissions", "form_reminders", "contracts", "incident_reports"],
};
export type TableGroup = keyof typeof TABLE_GROUPS | "other";

export function groupPlannedTables(tables: Record<string, number>): { group: TableGroup; count: number }[] {
  const out = new Map<TableGroup, number>();
  for (const [table, n] of Object.entries(tables)) {
    if (!(n > 0)) continue;
    const name = table.replace(/^public\./, "");
    const group = (Object.keys(TABLE_GROUPS).find((g) => TABLE_GROUPS[g].includes(name)) ?? "other") as TableGroup;
    out.set(group, (out.get(group) ?? 0) + n);
  }
  const order: TableGroup[] = [...(Object.keys(TABLE_GROUPS) as TableGroup[]), "other"];
  return order.filter((g) => out.has(g)).map((g) => ({ group: g, count: out.get(g)! }));
}

/** Typed confirmation for a permanent delete: the person's name, trimmed, case-insensitive. */
export function confirmationMatches(typed: string, expected: string): boolean {
  const norm = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return norm(expected).length > 0 && norm(typed) === norm(expected);
}

/** Error codes raised by the SQL functions -> message keys under personDelete.errors. */
export function errorKeyFor(message: string | null | undefined): string {
  const m = message ?? "";
  if (m.includes("NOT_AUTHORIZED")) return "personDelete.errors.forbidden";
  if (m.includes("NOT_FOUND")) return "personDelete.errors.notFound";
  if (m.includes("ALREADY_DELETED")) return "personDelete.errors.alreadyDeleted";
  if (m.includes("NOT_RESTORABLE")) return "personDelete.errors.notRestorable";
  if (m.includes("FAMILY_DELETED")) return "personDelete.errors.familyDeleted";
  if (m.includes("PERSON_DELETE_BLOCKED")) return "personDelete.errors.blocked";
  return "personDelete.errors.failed";
}

/** Days left before an archived person is erased (never negative). */
export function daysUntilPurge(purgeAfter: string | null | undefined, now: Date = new Date()): number | null {
  if (!purgeAfter) return null;
  const ms = new Date(purgeAfter).getTime() - now.getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/** Files the erase returned, as {bucket: paths[]} (validated, de-duplicated). */
export function parseFiles(raw: unknown): { bucket: string; paths: string[] }[] {
  if (!raw || typeof raw !== "object") return [];
  const out: { bucket: string; paths: string[] }[] = [];
  for (const [bucket, paths] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z0-9-]{1,63}$/.test(bucket) || !Array.isArray(paths)) continue;
    const clean = Array.from(new Set(paths.filter((p): p is string => typeof p === "string" && p.length > 0 && p.length <= 1024 && !p.includes(".."))));
    if (clean.length) out.push({ bucket, paths: clean });
  }
  return out;
}
