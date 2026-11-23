/**
 * Admin attendance views: pure helpers (client + server safe, no I/O).
 *
 * Totals follow the contract of docs/team-attendance.md §3: only FINALIZED
 * sheets of non-cancelled sessions count (a reopened sheet still counts with
 * its last finalized values); rate = (present + late) / counted marks.
 * Unfinished sheets (draft, never finalized) and cancelled sessions are shown
 * in the history but never counted.
 */

export type SessionAttendanceRow = {
  event_id: string;
  team_id: string | null;
  team_name: string | null;
  event_type: string;
  title: string | null;
  starts_at: string;
  ends_at: string;
  event_status: string;
  cancel_reason: string | null;
  local_date: string;
  sheet_status: "draft" | "final" | "reopened" | null;
  finalized: boolean;
  tracked: boolean;
  present: number;
  late: number;
  excused: number;
  unexcused: number;
  unmarked: number;
  total: number;
  athlete_status: string | null;
  athlete_is_guest: boolean | null;
};

export type Totals = { sessions: number; present: number; late: number; excused: number; unexcused: number; marks: number; rate: number | null };

/** Does this session count in totals? Finalized at least once and not cancelled. */
export function countsInTotals(r: Pick<SessionAttendanceRow, "finalized" | "event_status">): boolean {
  return r.finalized && r.event_status !== "cancelled";
}

export function rateOf(present: number, late: number, marks: number): number | null {
  return marks > 0 ? (present + late) / marks : null;
}

/** Team totals over a session history (all marks of each counted session). */
export function teamTotals(rows: SessionAttendanceRow[]): Totals {
  const t = { sessions: 0, present: 0, late: 0, excused: 0, unexcused: 0, marks: 0 };
  for (const r of rows) {
    if (!countsInTotals(r)) continue;
    t.sessions += 1;
    t.present += r.present;
    t.late += r.late;
    t.excused += r.excused;
    t.unexcused += r.unexcused;
    t.marks += r.present + r.late + r.excused + r.unexcused;
  }
  return { ...t, rate: rateOf(t.present, t.late, t.marks) };
}

/** One player's totals over their session history (athlete_status per row). */
export function playerTotals(rows: SessionAttendanceRow[]): Totals {
  const t = { sessions: 0, present: 0, late: 0, excused: 0, unexcused: 0, marks: 0 };
  for (const r of rows) {
    if (!countsInTotals(r)) continue;
    const s = r.athlete_status;
    if (s !== "present" && s !== "late" && s !== "excused" && s !== "unexcused") continue;
    t.sessions += 1;
    t.marks += 1;
    t[s] += 1;
  }
  return { ...t, rate: rateOf(t.present, t.late, t.marks) };
}

/** Totals per team for a player's history (one entry per team, by name). */
export function playerTotalsByTeam(rows: SessionAttendanceRow[]): { teamId: string; teamName: string; totals: Totals }[] {
  const by = new Map<string, { name: string; rows: SessionAttendanceRow[] }>();
  for (const r of rows) {
    if (!r.team_id) continue;
    const g = by.get(r.team_id) ?? { name: r.team_name ?? "", rows: [] };
    g.rows.push(r);
    by.set(r.team_id, g);
  }
  return Array.from(by.entries())
    .map(([teamId, g]) => ({ teamId, teamName: g.name, totals: playerTotals(g.rows) }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName));
}

/**
 * State of a session's sheet for display: cancelled > final > reopened >
 * draft > upcoming (not started, no sheet) > missing (ended, no sheet).
 */
export type SheetState = "cancelled" | "final" | "reopened" | "draft" | "upcoming" | "missing";
export function sheetState(r: { event_status: string; sheet_status: string | null; ends_at: string; starts_at?: string }, now = Date.now()): SheetState {
  if (r.event_status === "cancelled") return "cancelled";
  if (r.sheet_status === "final") return "final";
  if (r.sheet_status === "reopened") return "reopened";
  if (r.sheet_status === "draft") return "draft";
  return Date.parse(r.ends_at) > now ? "upcoming" : "missing";
}

/**
 * Coach coverage of a session: a substitute / lead approved for the session,
 * the team's own coaches, or nobody (missing).
 */
export type Coverage = "substitute" | "assigned" | "missing";
export function coachCoverage(teamCoachCount: number, approvedAssignments: number): Coverage {
  if (approvedAssignments > 0) return "substitute";
  if (teamCoachCount > 0) return "assigned";
  return "missing";
}

export type MembershipPeriod = { athlete_id: string; joined_on: string; left_on: string | null };

/** Is a membership period active on a date (both ends inclusive)? */
export function activeOn(p: Pick<MembershipPeriod, "joined_on" | "left_on">, day: string): boolean {
  return p.joined_on <= day && (p.left_on === null || p.left_on >= day);
}

/**
 * Past members of a team on a date: periods that ended before the date, for
 * players who are not on the roster that day. Newest departures first.
 */
export function pastMembers<T extends MembershipPeriod>(history: T[], day: string): T[] {
  const onRoster = new Set(history.filter((p) => activeOn(p, day)).map((p) => p.athlete_id));
  return history
    .filter((p) => p.left_on !== null && p.left_on < day && !onRoster.has(p.athlete_id))
    .sort((a, b) => (b.left_on ?? "").localeCompare(a.left_on ?? ""));
}

/** Alert statuses an admin can re-queue (failed delivery, or no channel with a known guardian). */
export function canRetryAlert(a: { status: string; guardian_profile_id: string | null }): boolean {
  return (a.status === "failed" || a.status === "no_contact") && a.guardian_profile_id !== null;
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A YYYY-MM-DD query parameter, or null. */
export function dateParam(v: unknown): string | null {
  return typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null;
}
