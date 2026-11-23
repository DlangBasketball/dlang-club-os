/**
 * Parent / player portal helpers (client + server safe, no I/O): history
 * filters and totals over the FINALIZED rows the overview RPCs return
 * (guardian_attendance_overview / player_attendance_overview). Drafts never
 * reach these rows: the database only returns finalized values.
 */
export type HistoryRow = {
  /** null for a booked training session (no team). */
  event_id: string; team_id: string | null; team_name: string; type: string; starts_at: string; status: string; is_guest: boolean;
  season_id?: string | null; season_name?: string | null; open_request?: boolean;
};

export type Totals = { sessions: number; present: number; late: number; excused: number; unexcused: number; rate: number | null };

export type HistoryFilter = { teamId?: string | null; seasonId?: string | null };

export function filterHistory<T extends HistoryRow>(rows: T[], f: HistoryFilter): T[] {
  return rows.filter((r) => (!f.teamId || r.team_id === f.teamId) && (!f.seasonId || r.season_id === f.seasonId));
}

/** Totals; rate = (present + late) / sessions, null without sessions (same rule as attendance_stats). */
export function summarize(rows: Pick<HistoryRow, "status">[]): Totals {
  const t: Totals = { sessions: 0, present: 0, late: 0, excused: 0, unexcused: 0, rate: null };
  for (const r of rows) {
    if (r.status !== "present" && r.status !== "late" && r.status !== "excused" && r.status !== "unexcused") continue;
    t.sessions += 1;
    t[r.status] += 1;
  }
  t.rate = t.sessions ? (t.present + t.late) / t.sessions : null;
  return t;
}

/** Distinct teams / seasons present in the rows (filter options), in first-seen order. */
export function historyOptions(rows: HistoryRow[]): { teams: { id: string; name: string }[]; seasons: { id: string; name: string }[] } {
  const teams = new Map<string, string>();
  const seasons = new Map<string, string>();
  for (const r of rows) {
    // Booked sessions have no team: they are never a team filter option.
    if (r.team_id && !teams.has(r.team_id)) teams.set(r.team_id, r.team_name);
    if (r.season_id && !seasons.has(r.season_id)) seasons.set(r.season_id, r.season_name ?? r.season_id);
  }
  return {
    teams: Array.from(teams, ([id, name]) => ({ id, name })),
    seasons: Array.from(seasons, ([id, name]) => ({ id, name })),
  };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A uuid search param or null (never trusted beyond shape; the RPCs check access). */
export function uuidParam(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && UUID_RE.test(s) ? s : null;
}

/** A booked private / group session row (no team, no absence report, no team record page). */
export function isBookedSession(r: { team_id?: string | null; training_session_id?: string | null; booked?: boolean }): boolean {
  return Boolean(r.booked || r.training_session_id);
}

/** Badge tone of a finalized attendance status. */
export function attendanceTone(status: string): "success" | "warning" | "info" | "danger" | "neutral" {
  switch (status) {
    case "present": return "success";
    case "late": return "warning";
    case "excused": return "info";
    case "unexcused": return "danger";
    default: return "neutral";
  }
}
