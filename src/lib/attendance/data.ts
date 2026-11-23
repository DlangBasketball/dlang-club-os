import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { attendanceErrorCode, type AttendanceErrorCode, type AttendanceSheet } from "./types";

/*
 * Team attendance — server-side reads for the coach, admin, parent and player
 * UIs. Every read runs as the signed-in user; the RPCs re-check tenant and
 * role (security definer) and RLS covers the tables. Contract:
 * docs/team-attendance.md.
 */
type Fn = Database["public"]["Functions"];
type Rows<K extends keyof Fn> = Fn[K]["Returns"];

export type Read<T> = { data: T; error: null } | { data: null; error: AttendanceErrorCode | "UNKNOWN" };
const ok = <T,>(data: T): Read<T> => ({ data, error: null });
const bad = <T,>(message: string | null | undefined): Read<T> => ({ data: null, error: attendanceErrorCode(message) ?? "UNKNOWN" });

/** Sheet of a session (roster preview when none exists yet). Admin / coaches who can run it. */
export async function getAttendanceSheet(eventId: string): Promise<Read<AttendanceSheet>> {
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_sheet", { p_event: eventId });
  return error ? bad(error.message) : ok(data as unknown as AttendanceSheet);
}

/** The signed-in coach's sessions (default: yesterday .. +14 days). */
export async function getCoachSessions(range: { from?: string | null; to?: string | null } = {}): Promise<Read<Rows<"coach_sessions">>> {
  const db = await createClient();
  const { data, error } = await db.rpc("coach_sessions", { p_from: range.from ?? null, p_to: range.to ?? null });
  return error ? bad(error.message) : ok(data ?? []);
}

/** Ended sessions without a final sheet (training window + go-live applied). */
export async function getAwaitingSessions(opts: { teamId?: string | null; limit?: number } = {}): Promise<Read<Rows<"sessions_awaiting_attendance">>> {
  const db = await createClient();
  const { data, error } = await db.rpc("sessions_awaiting_attendance", { p_team: opts.teamId ?? null, p_limit: opts.limit ?? 100 });
  return error ? bad(error.message) : ok(data ?? []);
}

export type StatsFilter = { from?: string | null; to?: string | null; teamId?: string | null; seasonId?: string | null; athleteId?: string | null; group?: "player" | "team" };

/** Finalized attendance counts and rate = (present + late) / finalized marks. */
export async function getAttendanceStats(f: StatsFilter = {}): Promise<Read<Rows<"attendance_stats">>> {
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_stats", {
    p_from: f.from ?? null, p_to: f.to ?? null, p_team: f.teamId ?? null, p_season: f.seasonId ?? null,
    p_athlete: f.athleteId ?? null, p_group: f.group ?? "player",
  });
  return error ? bad(error.message) : ok((data ?? []).map((r) => ({ ...r, rate: r.rate === null ? null : Number(r.rate) })));
}

/** Alerts needing staff follow-up (no reachable guardian / delivery failed). */
export async function getAlertFollowups(limit = 100): Promise<Read<Rows<"attendance_alerts_followup">>> {
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_alerts_followup", { p_limit: limit });
  return error ? bad(error.message) : ok(data ?? []);
}

export async function getCorrectionRequests(opts: { status?: string | null; athleteId?: string | null } = {}): Promise<Read<Rows<"attendance_correction_requests_list">>> {
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_correction_requests_list", {
    p_status: opts.status === undefined ? "open" : opts.status, p_athlete: opts.athleteId ?? null,
  });
  return error ? bad(error.message) : ok(data ?? []);
}

export async function getSessionAccessList(status: string | null = "pending"): Promise<Read<Rows<"session_access_list">>> {
  const db = await createClient();
  const { data, error } = await db.rpc("session_access_list", { p_status: status });
  return error ? bad(error.message) : ok(data ?? []);
}

export type AthleteOverview = {
  athlete: { id: string; first_name: string; last_name: string };
  timezone: string;
  upcoming: { event_id: string; team_id: string; team_name: string; type: string; title: string | null; starts_at: string; ends_at: string;
              status: string; can_report: boolean; report: null | { report_id: string; status: string; reason: string | null;
              reason_category: string; needs_review: boolean; created_at: string } }[];
  history: { event_id: string; team_id: string; team_name: string; type: string; starts_at: string; status: string; is_guest: boolean;
             can_request_correction: boolean; open_request: boolean;
             alert: null | { alert_id: string; kind: string; status: string; mark_status: string; sent_at: string | null } }[];
  reports: { report_id: string; event_id: string; starts_at: string; team_name: string | null; status: string; reason: string | null;
             reason_category: string; needs_review: boolean; reporter_kind: string; mine: boolean; created_at: string }[];
  correction_requests: { request_id: string; event_id: string; status: string; message: string; current_status: string;
                         requested_status: string | null; resolution_note: string | null; resolved_at: string | null; created_at: string }[];
  stats: { sessions: number; present: number; late: number; excused: number; unexcused: number };
};

/** Guardian view of one child (finalized values only). */
export async function getGuardianOverview(athleteId: string, range: { from?: string | null; to?: string | null } = {}): Promise<Read<AthleteOverview>> {
  const db = await createClient();
  const { data, error } = await db.rpc("guardian_attendance_overview", { p_athlete: athleteId, p_from: range.from ?? null, p_to: range.to ?? null });
  return error ? bad(error.message) : ok(data as unknown as AthleteOverview);
}

/** Player's own view (no guardian alerts / correction requests). */
export async function getPlayerOverview(range: { from?: string | null; to?: string | null } = {}): Promise<Read<AthleteOverview>> {
  const db = await createClient();
  const { data, error } = await db.rpc("player_attendance_overview", { p_from: range.from ?? null, p_to: range.to ?? null });
  return error ? bad(error.message) : ok(data as unknown as AthleteOverview);
}

export type PlayerMe = { athleteId: string; firstName: string; lastName: string; dob: string | null; photoPath: string | null;
  teams: { team_id: string; name: string; season_id: string | null; jersey_number: number | null; position: string | null }[] };

export async function getPlayerMe(): Promise<Read<PlayerMe | null>> {
  const db = await createClient();
  const { data, error } = await db.rpc("player_me");
  if (error) return bad(error.message);
  const r = (data ?? [])[0];
  return ok(r ? { athleteId: r.athlete_id, firstName: r.first_name, lastName: r.last_name, dob: r.dob, photoPath: r.photo_path,
                  teams: (r.teams ?? []) as PlayerMe["teams"] } : null);
}

export async function getTeamRosterOn(teamId: string, on?: string | null): Promise<Read<Rows<"team_roster_on">>> {
  const db = await createClient();
  const { data, error } = await db.rpc("team_roster_on", { p_team: teamId, p_on: on ?? null });
  return error ? bad(error.message) : ok(data ?? []);
}

export async function getTeamRosterHistory(teamId: string): Promise<Read<Rows<"team_roster_history">>> {
  const db = await createClient();
  const { data, error } = await db.rpc("team_roster_history", { p_team: teamId });
  return error ? bad(error.message) : ok(data ?? []);
}

export type AttendanceSettings = { attendanceTrackingStartsOn: string | null; timezone: string; graceDays: number };

/** Club attendance settings (staff). */
export async function getAttendanceSettings(): Promise<Read<AttendanceSettings | null>> {
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_settings");
  if (error) return bad(error.message);
  const s = data as { attendance_tracking_starts_on?: string | null; timezone?: string; grace_days?: number } | null;
  return ok(s ? { attendanceTrackingStartsOn: s.attendance_tracking_starts_on ?? null, timezone: s.timezone ?? "UTC", graceDays: s.grace_days ?? 7 } : null);
}

export type TrainingBreak = { id: string; seasonId: string | null; label: string; startsOn: string; endsOn: string; cancelledSessions: number | null };

/** Club training breaks (staff, guardians, players). */
export async function getTrainingBreaks(seasonId?: string | null): Promise<Read<TrainingBreak[]>> {
  const db = await createClient();
  const { data, error } = await db.rpc("training_breaks_list", { p_season: seasonId ?? null });
  if (error) return bad(error.message);
  return ok((data ?? []).map((b) => ({ id: b.id, seasonId: b.season_id, label: b.label, startsOn: b.starts_on, endsOn: b.ends_on, cancelledSessions: b.cancelled_sessions })));
}

/** Last training day of each team's season (default end of a weekly series in the event form). */
export async function teamTrainingEnds(teams: { id: string; seasonId: string | null }[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(teams.map((t) => t.seasonId).filter((x): x is string => Boolean(x))));
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const db = await createClient();
  const { data } = await db.from("seasons").select("id,training_ends_on").in("id", ids);
  const bySeason = new Map((data ?? []).map((s) => [s.id, s.training_ends_on]));
  for (const t of teams) {
    const end = t.seasonId ? bySeason.get(t.seasonId) : null;
    if (end) out.set(t.id, end);
  }
  return out;
}
