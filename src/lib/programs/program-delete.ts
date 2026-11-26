/**
 * Delete / archive / restore a programme: pure helpers for the jsonb returned
 * by public.program_delete_impact / program_delete (migration
 * 20250420105300_program_delete_archive.sql), shared by the server actions
 * and the confirmation dialog.
 */

/** Categories of linked records, in display order (keys under programDelete.categories). */
export const PROGRAM_LINK_CATEGORIES = ["registrations", "bookings", "schedules", "attendance", "invoices", "payments", "other"] as const;
export type ProgramLinkCategory = (typeof PROGRAM_LINK_CATEGORIES)[number];

export type ProgramStatusValue = "draft" | "published" | "archived";

export type UpcomingSession = {
  id: string;
  kind: "event" | "program_session" | "camp_edition";
  title: string | null;
  eventType: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  status: string | null;
};

export type CurrentEnrollment = {
  id: string;
  kind: "registration" | "application";
  childName: string;
  status: string;
};

export type ProgramImpact = {
  programId: string;
  name: string;
  kind: string;
  status: ProgramStatusValue;
  previousStatus: ProgramStatusValue | null;
  categories: Record<ProgramLinkCategory, number>;
  counts: Record<string, number>;
  total: number;
  canDelete: boolean;
  upcomingSessions: UpcomingSession[];
  upcomingTotal: number;
  currentEnrollments: CurrentEnrollment[];
  currentEnrollmentsTotal: number;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const status = (v: unknown): ProgramStatusValue | null => (v === "draft" || v === "published" || v === "archived" ? v : null);
const SESSION_KINDS = ["event", "program_session", "camp_edition"] as const;
const ENROL_KINDS = ["registration", "application"] as const;

/** Parse the jsonb of program_delete_impact (or program_delete's `impact`); null when it is not one. */
export function parseProgramImpact(raw: unknown): ProgramImpact | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.program_id !== "string") return null;
  const cat = obj(o.categories);
  const categories = Object.fromEntries(PROGRAM_LINK_CATEGORIES.map((k) => [k, num(cat[k])])) as Record<ProgramLinkCategory, number>;
  const counts = Object.fromEntries(Object.entries(obj(o.counts)).map(([k, v]) => [k, num(v)]));
  const total = PROGRAM_LINK_CATEGORIES.reduce((s, k) => s + categories[k], 0);
  const sessions = Array.isArray(o.upcoming_sessions) ? o.upcoming_sessions : [];
  const enrols = Array.isArray(o.current_enrollments) ? o.current_enrollments : [];
  return {
    programId: o.program_id,
    name: str(o.name),
    kind: str(o.kind),
    status: status(o.status) ?? "draft",
    previousStatus: status(o.previous_status),
    categories,
    counts,
    total,
    // Deletable only when the server says so AND nothing is counted.
    canDelete: o.can_delete === true && total === 0,
    upcomingSessions: sessions.map(obj)
      .filter((s) => typeof s.id === "string" && (SESSION_KINDS as readonly unknown[]).includes(s.kind) && typeof s.starts_at === "string")
      .map((s) => ({
        id: s.id as string,
        kind: s.kind as UpcomingSession["kind"],
        title: strOrNull(s.title),
        eventType: strOrNull(s.event_type),
        startsAt: s.starts_at as string,
        endsAt: strOrNull(s.ends_at),
        allDay: s.all_day === true,
        status: strOrNull(s.status),
      })),
    upcomingTotal: num(o.upcoming_total),
    currentEnrollments: enrols.map(obj)
      .filter((e) => typeof e.id === "string" && (ENROL_KINDS as readonly unknown[]).includes(e.kind))
      .map((e) => ({ id: e.id as string, kind: e.kind as CurrentEnrollment["kind"], childName: str(e.child_name), status: str(e.status) })),
    currentEnrollmentsTotal: num(o.current_enrollments_total),
  };
}

/** Non-zero categories, in display order. */
export function programImpactLines(i: ProgramImpact): { key: ProgramLinkCategory; count: number }[] {
  return PROGRAM_LINK_CATEGORIES.map((key) => ({ key, count: i.categories[key] })).filter((l) => l.count > 0);
}

/** Result of program_delete: deleted, or blocked with fresh counts. */
export type ProgramDeleteOutcome = { deleted: true } | { deleted: false; impact: ProgramImpact };

export function parseProgramDeleteOutcome(raw: unknown): ProgramDeleteOutcome | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.deleted === true) return { deleted: true };
  if (o.code === "PROGRAM_HAS_LINKED_RECORDS") {
    const impact = parseProgramImpact(o.impact);
    return impact ? { deleted: false, impact } : null;
  }
  return null;
}

/** Link to the page where an upcoming session can be reviewed / cancelled (existing flows); null when there is none. */
export function upcomingSessionHref(programId: string, s: Pick<UpcomingSession, "id" | "kind">): string | null {
  if (s.kind === "event") return `/admin/schedule/${s.id}`;
  if (s.kind === "camp_edition") return `/admin/programs/${programId}/editions/${s.id}`;
  return null;
}

/** Error codes raised by the SQL functions -> message keys under programDelete.errors. */
export function programErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  if (m.includes("NOT_AUTHORIZED") || m.includes("permission denied") || m.includes("row-level security")) return "programDelete.errors.forbidden";
  if (m.includes("PROGRAM_HAS_LINKED_RECORDS") || m.includes("PROGRAM_HAS_REGISTRATIONS")) return "programDelete.errors.linked";
  if (m.includes("PROGRAM_ALREADY_ARCHIVED")) return "programDelete.errors.alreadyArchived";
  if (m.includes("PROGRAM_NOT_ARCHIVED")) return "programDelete.errors.notArchived";
  if (m.includes("PROGRAM_ARCHIVED")) return "programDelete.errors.archived";
  if (m.includes("PROGRAM_NOT_FOUND")) return "programDelete.errors.notFound";
  return "programDelete.errors.failed";
}
