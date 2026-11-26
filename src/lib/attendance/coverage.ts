/**
 * Coach coverage of one session — the TS mirror of the SQL helpers in
 * supabase/migrations/20250420105000_attendance_consistency.sql
 * (ac_session_coaches, ac_lead_pick, ac_coverage). Pure, client + server safe.
 *
 * Rules (docs/team-attendance.md §12):
 *   - Effective coaches = approved session assignments (lead / assistant /
 *     substitute) + the booked-session coach (lead) + the team's coaches
 *     (head -> lead, others -> assistant). A session assignment decides the
 *     role shown for its coach.
 *   - "Led by" = the sheet's led_by, else the approved session lead (earliest),
 *     else the booked-session coach, else the team head coach.
 *   - "Substitute assigned" only when an approved substitute exists; "No coach
 *     assigned" only when there is no coach at all.
 */

export type SessionRole = "lead" | "assistant" | "substitute";
export const SESSION_ROLES: readonly SessionRole[] = ["lead", "assistant", "substitute"] as const;
export type CoachSource = "session" | "booking" | "team" | "program";
export type LeadSource = CoachSource | "sheet";
export type CoverageState = "assigned" | "substitute" | "missing";

export type SessionCoach = { coachId: string; name: string; role: SessionRole; source: CoachSource };

export type CoverageSummary = {
  coverage: CoverageState;
  ledById: string | null;
  ledByName: string | null;
  ledBySource: LeadSource | null;
  coaches: SessionCoach[];
  substitute: boolean;
  multipleLeads: boolean;
  pendingRequests: number;
};

export type CoverageInput = {
  /** event_coach_assignments of the session (any status). */
  assignments: { coachId: string; name: string; role: string; status: string; decidedAt?: string | null; createdAt?: string | null }[];
  /** team_coaches of the event's team (empty for a booked session). */
  teamCoaches: { coachId: string; name: string; role: string; createdAt?: string | null }[];
  /** training_sessions.coach_id of a booked session. */
  bookingCoach?: { coachId: string; name: string } | null;
  /** team_attendance_sheets.led_by_coach_id (with its name). */
  sheetLead?: { coachId: string; name: string } | null;
};

const ROLE_ORDER: Record<SessionRole, number> = { lead: 0, assistant: 1, substitute: 2 };
const asRole = (r: string): SessionRole => (r === "lead" || r === "assistant" ? r : "substitute");
const byTimeThenName = (a: { at: string; name: string }, b: { at: string; name: string }) =>
  a.at.localeCompare(b.at) || a.name.localeCompare(b.name);

/** Effective coaches, sorted lead > assistant > substitute, then by name. */
export function effectiveCoaches(input: CoverageInput): SessionCoach[] {
  const seen = new Map<string, SessionCoach>();
  for (const a of input.assignments) {
    if (a.status !== "approved" || seen.has(a.coachId)) continue;
    seen.set(a.coachId, { coachId: a.coachId, name: a.name, role: asRole(a.role), source: "session" });
  }
  if (input.bookingCoach && !seen.has(input.bookingCoach.coachId)) {
    seen.set(input.bookingCoach.coachId, { ...input.bookingCoach, role: "lead", source: "booking" });
  }
  for (const c of input.teamCoaches) {
    if (seen.has(c.coachId)) continue;
    seen.set(c.coachId, { coachId: c.coachId, name: c.name, role: c.role === "head" ? "lead" : "assistant", source: "team" });
  }
  return Array.from(seen.values()).sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
}

/** Default lead when the sheet names none (session lead > booked coach > team head). */
export function defaultLead(input: CoverageInput): { coachId: string; name: string; source: CoachSource } | null {
  const leads = input.assignments
    .filter((a) => a.status === "approved" && a.role === "lead")
    .map((a) => ({ ...a, at: a.decidedAt ?? a.createdAt ?? "" }))
    .sort(byTimeThenName);
  if (leads[0]) return { coachId: leads[0].coachId, name: leads[0].name, source: "session" };
  if (input.bookingCoach) return { ...input.bookingCoach, source: "booking" };
  const heads = input.teamCoaches.filter((c) => c.role === "head").map((c) => ({ ...c, at: c.createdAt ?? "" })).sort(byTimeThenName);
  if (heads[0]) return { coachId: heads[0].coachId, name: heads[0].name, source: "team" };
  return null;
}

export function coverageOf(input: CoverageInput): CoverageSummary {
  const coaches = effectiveCoaches(input);
  const lead = input.sheetLead ? { ...input.sheetLead, source: "sheet" as const } : defaultLead(input);
  const substitute = input.assignments.some((a) => a.status === "approved" && a.role === "substitute");
  const coverage: CoverageState = !lead && coaches.length === 0 ? "missing" : substitute ? "substitute" : "assigned";
  return {
    coverage,
    ledById: lead?.coachId ?? null,
    ledByName: lead?.name ?? null,
    ledBySource: lead?.source ?? null,
    coaches,
    substitute,
    multipleLeads: input.assignments.filter((a) => a.status === "approved" && a.role === "lead").length > 1,
    pendingRequests: input.assignments.filter((a) => a.status === "pending").length,
  };
}

/** Parse the jsonb `coverage` returned by the SQL (attendance_sessions_overview, session_coverage). */
export function parseCoverage(raw: unknown): CoverageSummary {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const state = str(o.coverage);
  const coaches = Array.isArray(o.coaches) ? o.coaches : [];
  return {
    coverage: state === "substitute" || state === "missing" ? state : "assigned",
    ledById: str(o.led_by_coach_id),
    ledByName: str(o.led_by_name),
    ledBySource: (str(o.led_by_source) as LeadSource | null) ?? null,
    coaches: coaches.flatMap((c) => {
      const x = (c ?? {}) as Record<string, unknown>;
      const id = str(x.coach_id);
      if (!id) return [];
      const src = str(x.source);
      return [{
        coachId: id, name: str(x.name) ?? "", role: asRole(str(x.role) ?? ""),
        source: (src === "session" || src === "booking" || src === "team" || src === "program" ? src : "team") as CoachSource,
      }];
    }),
    substitute: o.substitute === true,
    multipleLeads: o.multiple_leads === true,
    pendingRequests: typeof o.pending_requests === "number" ? o.pending_requests : 0,
  };
}

/** Coaches grouped by role for a compact line ("Lead: A · Assistant: B, C"). */
export function coachesByRole(coaches: SessionCoach[]): { role: SessionRole; names: string[] }[] {
  return SESSION_ROLES
    .map((role) => ({ role, names: coaches.filter((c) => c.role === role).map((c) => c.name).filter(Boolean) }))
    .filter((g) => g.names.length > 0);
}
