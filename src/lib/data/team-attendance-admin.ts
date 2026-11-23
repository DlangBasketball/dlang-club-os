import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sportsDb } from "@/lib/sportsops/db";
import { HIDDEN_ATHLETE_STATUS_FILTER } from "@/lib/people/person-delete";
import { getAttendanceSheet, getTeamRosterHistory, getTeamRosterOn, type Read } from "@/lib/attendance/data";
import { activeOn, pastMembers, type SessionAttendanceRow } from "@/lib/attendance/admin-stats";
import { attendanceErrorCode, type AttendanceSheet } from "@/lib/attendance/types";
import { searchWords } from "@/lib/teams/categories";

/*
 * Admin team attendance — server reads for the Teams pages, the player
 * profile and the admin session page. Everything runs as the signed-in user:
 * the RPCs re-check tenant + role (admin_session_attendance is admin only)
 * and RLS scopes the tables (attendance tables: admin / coaches of the
 * session; data_review_flags: admin / finance). Callers gate the pages to
 * admins; finance never reaches attendance data through these reads.
 */

const ok = <T,>(data: T): Read<T> => ({ data, error: null });
const bad = <T,>(message: string | null | undefined): Read<T> => ({ data: null, error: attendanceErrorCode(message) ?? "UNKNOWN" });
const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => Boolean(x))));
const fullName = (a: { first_name: string; last_name: string } | undefined | null) => (a ? `${a.first_name} ${a.last_name}`.trim() : "");

// ---------------------------------------------------------------------------
// Session history (team page, player profile)
// ---------------------------------------------------------------------------
export type SessionFilter = { teamId?: string | null; athleteId?: string | null; from?: string | null; to?: string | null; seasonId?: string | null; limit?: number };

export async function getSessionAttendance(f: SessionFilter): Promise<Read<SessionAttendanceRow[]>> {
  const db = await createClient();
  const { data, error } = await db.rpc("admin_session_attendance", {
    p_team: f.teamId ?? null, p_athlete: f.athleteId ?? null, p_from: f.from ?? null, p_to: f.to ?? null,
    p_season: f.seasonId ?? null, p_limit: f.limit ?? 300,
  });
  return error ? bad(error.message) : ok((data ?? []) as SessionAttendanceRow[]);
}

// ---------------------------------------------------------------------------
// Current team assignments (many players)
// ---------------------------------------------------------------------------
export type Assignment = { teamId: string; teamName: string; jerseyNumber: number | null; joinedOn: string; seasonName: string | null; isCurrentSeason: boolean };

/** Current team assignments (on `day`) of each athlete: one player can be on several teams. */
export async function getCurrentAssignments(athleteIds: string[], day: string): Promise<Map<string, Assignment[]>> {
  const out = new Map<string, Assignment[]>();
  const ids = uniq(athleteIds);
  if (!ids.length) return out;
  const db = await sportsDb();
  const rows: { team_id: string; athlete_id: string; jersey_number: number | null; joined_on: string; left_on: string | null; status: string }[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await db.from("team_memberships").select("team_id,athlete_id,jersey_number,joined_on,left_on,status")
      .in("athlete_id", ids.slice(i, i + 100)).limit(1000);
    rows.push(...(data ?? []));
  }
  const live = rows.filter((r) => activeOn(r, day) && (r.status !== "inactive" || r.left_on !== null));
  const teamIds = uniq(live.map((r) => r.team_id));
  if (!teamIds.length) return out;
  const { data: teams } = await db.from("teams").select("id,name,season_id,is_active").in("id", teamIds);
  const seasonIds = uniq((teams ?? []).map((t) => t.season_id));
  const { data: seasons } = seasonIds.length ? await db.from("seasons").select("id,name,is_current").in("id", seasonIds) : { data: [] };
  const team = new Map((teams ?? []).map((t) => [t.id, t]));
  const season = new Map((seasons ?? []).map((s) => [s.id, s]));
  for (const r of live) {
    const t = team.get(r.team_id);
    if (!t) continue;
    const s = t.season_id ? season.get(t.season_id) : undefined;
    const list = out.get(r.athlete_id) ?? [];
    list.push({ teamId: t.id, teamName: t.name, jerseyNumber: r.jersey_number, joinedOn: r.joined_on, seasonName: s?.name ?? null, isCurrentSeason: !!s?.is_current });
    out.set(r.athlete_id, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.teamName.localeCompare(b.teamName));
  return out;
}

export type PlayerHit = { id: string; name: string; status: string; teams: Assignment[] };

/** Player search by name (every word must match first or last name) with current team assignments. */
export async function searchPlayersWithTeams(q: string, day: string, limit = 30): Promise<Read<PlayerHit[]>> {
  const words = searchWords(q);
  if (!words.length) return ok([]);
  const db = await createClient();
  let query = db.from("athletes").select("id,first_name,last_name,status").not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER)
    .order("last_name").order("first_name").limit(limit);
  for (const w of words) query = query.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%`);
  const { data, error } = await query;
  if (error) return bad(error.message);
  const assignments = await getCurrentAssignments((data ?? []).map((a) => a.id), day);
  return ok((data ?? []).map((a) => ({ id: a.id, name: fullName(a), status: a.status, teams: assignments.get(a.id) ?? [] })));
}

// ---------------------------------------------------------------------------
// Team roster (effective-dated)
// ---------------------------------------------------------------------------
export type RosterLine = {
  athleteId: string; membershipId: string | null; name: string; jerseyNumber: number | null; position: string | null;
  status: string; joinedOn: string; leftOn: string | null; otherTeams: Assignment[];
};
export type PastLine = { athleteId: string; name: string; joinedOn: string; leftOn: string; reason: string | null };
export type RosterView = { on: string; roster: RosterLine[]; past: PastLine[]; historyCount: number };

export async function getTeamRosterView(teamId: string, on: string): Promise<Read<RosterView>> {
  const [roster, history] = await Promise.all([getTeamRosterOn(teamId, on), getTeamRosterHistory(teamId)]);
  if (roster.error !== null) return { data: null, error: roster.error };
  if (history.error !== null) return { data: null, error: history.error };
  const others = await getCurrentAssignments(roster.data.map((r) => r.athlete_id), on);
  const past = pastMembers(history.data.map((h) => ({ ...h, left_on: h.left_on })), on);
  return ok({
    on,
    roster: roster.data.map((r) => ({
      athleteId: r.athlete_id, membershipId: r.membership_id, name: fullName(r), jerseyNumber: r.jersey_number,
      position: r.player_position, status: r.membership_status, joinedOn: r.joined_on, leftOn: r.left_on,
      otherTeams: (others.get(r.athlete_id) ?? []).filter((a) => a.teamId !== teamId),
    })).sort((a, b) => (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999) || a.name.localeCompare(b.name)),
    past: past.map((p) => ({ athleteId: p.athlete_id, name: fullName(p), joinedOn: p.joined_on, leftOn: p.left_on as string, reason: p.end_reason })),
    historyCount: history.data.length,
  });
}

// ---------------------------------------------------------------------------
// Player profile: every assignment with dates
// ---------------------------------------------------------------------------
export type TeamPeriod = { teamId: string; teamName: string; seasonName: string | null; joinedOn: string; leftOn: string | null; reason: string | null; current: boolean };

export async function getAthleteTeamPeriods(athleteId: string, day: string): Promise<Read<TeamPeriod[]>> {
  const db = await sportsDb();
  const client = await createClient();
  const [cur, hist] = await Promise.all([
    // "*": end_reason (team attendance migration) is not in the typed row.
    db.from("team_memberships").select("*").eq("athlete_id", athleteId),
    client.from("team_membership_periods").select("team_id,joined_on,left_on,reason").eq("athlete_id", athleteId),
  ]);
  if (cur.error) return bad(cur.error.message);
  if (hist.error) return bad(hist.error.message);
  const rows = [
    ...(cur.data ?? []).filter((r) => !(r.status === "inactive" && r.left_on === null)).map((r) => ({
      team_id: r.team_id, joined_on: r.joined_on, left_on: r.left_on, reason: (r as typeof r & { end_reason?: string | null }).end_reason ?? null })),
    ...(hist.data ?? []).map((r) => ({ team_id: r.team_id, joined_on: r.joined_on, left_on: r.left_on as string | null, reason: r.reason })),
  ];
  const teamIds = uniq(rows.map((r) => r.team_id));
  if (!teamIds.length) return ok([]);
  const { data: teams } = await db.from("teams").select("id,name,season_id").in("id", teamIds);
  const seasonIds = uniq((teams ?? []).map((t) => t.season_id));
  const { data: seasons } = seasonIds.length ? await db.from("seasons").select("id,name").in("id", seasonIds) : { data: [] };
  const team = new Map((teams ?? []).map((t) => [t.id, t]));
  const season = new Map((seasons ?? []).map((s) => [s.id, s.name]));
  return ok(rows.map((r) => {
    const t = team.get(r.team_id);
    return {
      teamId: r.team_id, teamName: t?.name ?? "", seasonName: t?.season_id ? season.get(t.season_id) ?? null : null,
      joinedOn: r.joined_on, leftOn: r.left_on, reason: r.left_on ? r.reason : null, current: activeOn(r, day),
    };
  }).sort((a, b) => Number(b.current) - Number(a.current) || b.joinedOn.localeCompare(a.joinedOn)));
}

// ---------------------------------------------------------------------------
// Team schedule (upcoming, cancelled included)
// ---------------------------------------------------------------------------
export type ScheduleLine = {
  eventId: string; type: string; title: string | null; startsAt: string; endsAt: string; status: string; cancelReason: string | null;
  sheetStatus: "draft" | "final" | "reopened" | null; substitutes: number;
};

export async function getTeamSchedule(teamId: string, opts: { fromISO: string; limit?: number }): Promise<Read<ScheduleLine[]>> {
  const db = await sportsDb();
  const { data, error } = await db.from("events").select("id,type,title,starts_at,ends_at,status,cancel_reason")
    .eq("team_id", teamId).gte("starts_at", opts.fromISO).order("starts_at").limit(opts.limit ?? 40);
  if (error) return bad(error.message);
  const ids = (data ?? []).map((e) => e.id);
  const client = await createClient();
  const [sheets, subs] = ids.length
    ? await Promise.all([
      client.from("team_attendance_sheets").select("event_id,status").in("event_id", ids),
      client.from("event_coach_assignments").select("event_id").eq("status", "approved").in("event_id", ids),
    ])
    : [{ data: [] }, { data: [] }];
  const sheet = new Map(((sheets.data ?? []) as { event_id: string; status: "draft" | "final" | "reopened" }[]).map((s) => [s.event_id, s.status]));
  const subCount = new Map<string, number>();
  for (const s of (subs.data ?? []) as { event_id: string }[]) subCount.set(s.event_id, (subCount.get(s.event_id) ?? 0) + 1);
  return ok((data ?? []).map((e) => ({
    eventId: e.id, type: e.type, title: e.title, startsAt: e.starts_at, endsAt: e.ends_at, status: e.status,
    cancelReason: e.cancel_reason ?? null, sheetStatus: sheet.get(e.id) ?? null, substitutes: subCount.get(e.id) ?? 0,
  })));
}

// ---------------------------------------------------------------------------
// Admin session page
// ---------------------------------------------------------------------------
export type SessionAdminDetail = {
  sheet: AttendanceSheet | null;
  sheetError: string | null;
  meta: null | {
    openedBy: string | null; submittedBy: string | null; submittedAt: string | null; finalizedBy: string | null; finalizedAt: string | null;
    firstFinalizedAt: string | null; reopenedBy: string | null; reopenedAt: string | null; reopenReason: string | null; legacySessionId: string | null;
  };
  history: { id: string; athleteName: string; previous: string | null; next: string; phase: string; reason: string | null; by: string | null; at: string }[];
  reports: { id: string; athleteId: string; athleteName: string; status: string; category: string; reason: string | null; reporterKind: string;
             reporter: string | null; needsReview: boolean; createdAt: string }[];
  alerts: { id: string; athleteId: string; athleteName: string; guardianProfileId: string | null; guardian: string | null; kind: string;
            markStatus: string; status: string; attempts: number; lastError: string | null; sentAt: string | null; createdAt: string }[];
  assignments: { id: string; coachId: string; coachName: string; role: string; status: string; requestNote: string | null; decisionNote: string | null; createdAt: string }[];
  corrections: { id: string; athleteId: string; athleteName: string; status: string; currentStatus: string; requestedStatus: string | null;
                 message: string; requestedBy: string | null; resolutionNote: string | null; createdAt: string; resolvedAt: string | null }[];
  teamCoaches: { id: string; name: string; role: string }[];
};

export async function getSessionAdminDetail(eventId: string, teamId: string | null): Promise<SessionAdminDetail> {
  const db = await createClient();
  const sports = await sportsDb();
  const [sheetRes, sheetRow, history, reports, alerts, assignments, corrections, teamCoaches] = await Promise.all([
    getAttendanceSheet(eventId),
    db.from("team_attendance_sheets").select("*").eq("event_id", eventId).maybeSingle(),
    db.from("team_attendance_mark_history").select("id,athlete_id,previous_status,new_status,phase,reason,changed_by,changed_at")
      .eq("event_id", eventId).order("changed_at", { ascending: false }).limit(500),
    db.from("team_absence_reports").select("id,athlete_id,status,reason_category,reason,reporter_kind,reported_by,needs_review,created_at")
      .eq("event_id", eventId).order("created_at", { ascending: false }),
    db.from("attendance_no_show_alerts").select("id,athlete_id,guardian_profile_id,kind,mark_status,status,attempts,last_error,sent_at,created_at")
      .eq("event_id", eventId).order("created_at", { ascending: false }),
    db.from("event_coach_assignments").select("id,coach_id,role,status,request_note,decision_note,created_at").eq("event_id", eventId).order("created_at"),
    db.from("attendance_correction_requests").select("id,athlete_id,status,current_status,requested_status,message,requested_by,resolution_note,created_at,resolved_at")
      .eq("event_id", eventId).order("created_at", { ascending: false }),
    teamId ? sports.from("team_coaches").select("coach_id,role").eq("team_id", teamId) : Promise.resolve({ data: [] as { coach_id: string; role: string }[] }),
  ]);
  const s = sheetRow.data;
  const athleteIds = uniq([
    ...(history.data ?? []).map((h) => h.athlete_id), ...(reports.data ?? []).map((r) => r.athlete_id),
    ...(alerts.data ?? []).map((a) => a.athlete_id), ...(corrections.data ?? []).map((c) => c.athlete_id),
  ]);
  const profileIds = uniq([
    s?.opened_by, s?.submitted_by, s?.finalized_by, s?.reopened_by,
    ...(history.data ?? []).map((h) => h.changed_by), ...(reports.data ?? []).map((r) => r.reported_by),
    ...(alerts.data ?? []).map((a) => a.guardian_profile_id), ...(corrections.data ?? []).map((c) => c.requested_by),
  ]);
  const coachIds = uniq([...(assignments.data ?? []).map((a) => a.coach_id), ...(teamCoaches.data ?? []).map((c) => c.coach_id)]);
  const [ath, prof, coach] = await Promise.all([
    athleteIds.length ? db.from("athletes").select("id,first_name,last_name").in("id", athleteIds) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
    profileIds.length ? db.from("profiles").select("id,full_name").in("id", profileIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    coachIds.length ? db.from("coaches").select("id,display_name").in("id", coachIds) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
  ]);
  const aName = new Map((ath.data ?? []).map((a) => [a.id, fullName(a)]));
  const pName = new Map((prof.data ?? []).map((p) => [p.id, p.full_name]));
  const cName = new Map((coach.data ?? []).map((c) => [c.id, c.display_name]));
  const pn = (id: string | null | undefined) => (id ? pName.get(id) ?? null : null);

  return {
    sheet: sheetRes.data,
    sheetError: sheetRes.error,
    meta: s ? {
      openedBy: pn(s.opened_by), submittedBy: pn(s.submitted_by), submittedAt: s.submitted_at, finalizedBy: pn(s.finalized_by),
      finalizedAt: s.finalized_at, firstFinalizedAt: s.first_finalized_at, reopenedBy: pn(s.reopened_by), reopenedAt: s.reopened_at,
      reopenReason: s.reopen_reason, legacySessionId: s.legacy_attendance_session_id,
    } : null,
    history: (history.data ?? []).map((h) => ({
      id: h.id, athleteName: aName.get(h.athlete_id) ?? "", previous: h.previous_status, next: h.new_status, phase: h.phase,
      reason: h.reason, by: pn(h.changed_by), at: h.changed_at,
    })),
    reports: (reports.data ?? []).map((r) => ({
      id: r.id, athleteId: r.athlete_id, athleteName: aName.get(r.athlete_id) ?? "", status: r.status, category: r.reason_category,
      reason: r.reason, reporterKind: r.reporter_kind, reporter: pn(r.reported_by), needsReview: r.needs_review, createdAt: r.created_at,
    })),
    alerts: (alerts.data ?? []).map((a) => ({
      id: a.id, athleteId: a.athlete_id, athleteName: aName.get(a.athlete_id) ?? "", guardianProfileId: a.guardian_profile_id,
      guardian: pn(a.guardian_profile_id), kind: a.kind, markStatus: a.mark_status, status: a.status, attempts: a.attempts,
      lastError: a.last_error, sentAt: a.sent_at, createdAt: a.created_at,
    })),
    assignments: (assignments.data ?? []).map((a) => ({
      id: a.id, coachId: a.coach_id, coachName: cName.get(a.coach_id) ?? "", role: a.role, status: a.status,
      requestNote: a.request_note, decisionNote: a.decision_note, createdAt: a.created_at,
    })),
    corrections: (corrections.data ?? []).map((c) => ({
      id: c.id, athleteId: c.athlete_id, athleteName: aName.get(c.athlete_id) ?? "", status: c.status, currentStatus: c.current_status,
      requestedStatus: c.requested_status, message: c.message, requestedBy: pn(c.requested_by), resolutionNote: c.resolution_note,
      createdAt: c.created_at, resolvedAt: c.resolved_at,
    })),
    teamCoaches: (teamCoaches.data ?? []).map((c) => ({ id: c.coach_id, name: cName.get(c.coach_id) ?? "", role: c.role })),
  };
}
