import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { attendanceErrorCode } from "./types";
import type { Read } from "./data";
import { parseCoverage, type CoverageSummary } from "./coverage";
import type { SessionAttendanceRow } from "./admin-stats";

/*
 * Attendance overview reads (migration 20250420105000_attendance_consistency).
 * ONE SQL read — attendance_sessions_overview — feeds the Attendance tab, the
 * Dashboard and the player history, so their numbers always match. Every read
 * runs as the signed-in user; the RPCs check tenant and role (admin: club;
 * coach: sessions they run; others: NOT_AUTHORIZED).
 */
type Fn = Database["public"]["Functions"];
type RawOverview = Fn["attendance_sessions_overview"]["Returns"][number];
export type OverviewRow = Omit<RawOverview, "coverage"> & { coverage: CoverageSummary };
export type RosterRow = Fn["attendance_sessions_roster"]["Returns"][number];
export type FollowupRow = Fn["attendance_followups_list"]["Returns"][number];
export type OverviewScope = "all" | "teams" | "bookings" | "programs";

export type OverviewFilter = {
  from?: string | null; to?: string | null; teamId?: string | null; athleteId?: string | null;
  scope?: OverviewScope; programId?: string | null; limit?: number;
};

const ok = <T,>(data: T): Read<T> => ({ data, error: null });
const bad = <T,>(message: string | null | undefined): Read<T> => ({ data: null, error: attendanceErrorCode(message) ?? "UNKNOWN" });

export async function getSessionsOverview(f: OverviewFilter): Promise<Read<OverviewRow[]>> {
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_sessions_overview", {
    p_from: f.from ?? null, p_to: f.to ?? null, p_team: f.teamId ?? null, p_athlete: f.athleteId ?? null,
    p_scope: f.scope ?? "all", p_program: f.programId ?? null, p_limit: f.limit ?? 300,
  });
  if (error) return bad(error.message);
  return ok((data ?? []).map((r) => ({ ...r, coverage: parseCoverage(r.coverage) })));
}

/** Rosters (current status per player) of listed sessions; max 100 ids per call. */
export async function getSessionsRoster(sessionIds: string[]): Promise<Read<Map<string, RosterRow[]>>> {
  const out = new Map<string, RosterRow[]>();
  const ids = Array.from(new Set(sessionIds)).slice(0, 100);
  if (!ids.length) return ok(out);
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_sessions_roster", { p_sessions: ids });
  if (error) return bad(error.message);
  for (const r of data ?? []) out.set(r.session_id, [...(out.get(r.session_id) ?? []), r]);
  return ok(out);
}

export async function getFollowups(status: "open" | "resolved" | null = "open", limit = 100): Promise<Read<FollowupRow[]>> {
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_followups_list", { p_status: status, p_limit: limit });
  return error ? bad(error.message) : ok(data ?? []);
}

/** Coverage (coaches, roles, led by) of several events the caller may see. */
export async function getSessionCoverage(eventIds: string[]): Promise<Map<string, CoverageSummary>> {
  const out = new Map<string, CoverageSummary>();
  const ids = Array.from(new Set(eventIds)).slice(0, 300);
  if (!ids.length) return out;
  const db = await createClient();
  const { data } = await db.rpc("session_coverage", { p_events: ids });
  for (const r of data ?? []) out.set(r.event_id, parseCoverage(r.coverage));
  return out;
}

export type OverviewTotals = {
  sessions: number; present: number; late: number; excused: number; unexcused: number; unmarked: number;
  final: number; open: number; openFollowups: number;
};

/** Totals of overview rows (cancelled sessions not counted). Same numbers on the tab and the dashboard. */
export function overviewTotals(rows: Pick<OverviewRow, "workflow_status" | "present" | "late" | "excused" | "unexcused" | "unmarked" | "open_followups">[]): OverviewTotals {
  const t: OverviewTotals = { sessions: 0, present: 0, late: 0, excused: 0, unexcused: 0, unmarked: 0, final: 0, open: 0, openFollowups: 0 };
  for (const r of rows) {
    if (r.workflow_status === "cancelled") continue;
    t.sessions += 1;
    t.present += r.present; t.late += r.late; t.excused += r.excused; t.unexcused += r.unexcused; t.unmarked += r.unmarked;
    t.openFollowups += r.open_followups;
    if (r.workflow_status === "final") t.final += 1; else t.open += 1;
  }
  return t;
}

/**
 * Overview rows in the shape of the player history (SessionAttendanceRow),
 * so playerTotals / playerTotalsByTeam keep working: totals count the
 * FINALIZED value of finalized, non-cancelled sessions.
 */
export function toSessionRows(rows: OverviewRow[]): SessionAttendanceRow[] {
  return rows.map((r) => ({
    event_id: r.session_id,
    team_id: r.team_id ?? (r.source === "program" ? r.program_id : null),
    team_name: r.group_name,
    event_type: r.event_type,
    title: r.title,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    event_status: r.event_status,
    cancel_reason: r.cancel_reason,
    local_date: r.local_date,
    sheet_status: r.workflow_status === "draft" || r.workflow_status === "final" || r.workflow_status === "reopened" ? r.workflow_status : null,
    finalized: r.finalized,
    tracked: r.tracked,
    present: r.present, late: r.late, excused: r.excused, unexcused: r.unexcused, unmarked: r.unmarked, total: r.total,
    athlete_status: r.finalized ? (r.athlete_finalized_status ?? r.athlete_status) : r.athlete_status,
    athlete_is_guest: r.athlete_is_guest,
    source: r.source,
  }));
}
