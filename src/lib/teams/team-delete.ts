/**
 * Archive / delete a team: pure helpers for the impact preview returned by
 * public.preview_delete_team / delete_team (migration
 * 20250420102700_team_delete.sql), shared by the server actions and the
 * confirmation dialog.
 */
export type TeamDeleteMode = "archive" | "delete";
export type TeamDeleteBlocker = "past_events" | "messages" | "kit";

export type TeamImpact = {
  teamId: string;
  name: string;
  isActive: boolean;
  players: number;
  coaches: number;
  upcomingEvents: number;
  pastEvents: number;
  pastGames: number;
  results: number;
  stats: number;
  linkedDivisions: number;
  divisions: { id: string; name: string; programId: string; programName: string }[];
  messages: number;
  kitOutstanding: number;
  billingLinks: number;
  blockers: TeamDeleteBlocker[];
  canDelete: boolean;
};

const BLOCKERS: TeamDeleteBlocker[] = ["past_events", "messages", "kit"];
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Parse the jsonb of preview_delete_team / delete_team; null when it is not one. */
export function parseTeamImpact(raw: unknown): TeamImpact | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.team_id !== "string") return null;
  const blockers = Array.isArray(o.blockers) ? (o.blockers.filter((b) => BLOCKERS.includes(b as TeamDeleteBlocker)) as TeamDeleteBlocker[]) : [];
  const divisions = Array.isArray(o.divisions)
    ? o.divisions.filter((d): d is Record<string, unknown> => !!d && typeof d === "object").map((d) => ({
      id: str(d.id), name: str(d.name), programId: str(d.program_id), programName: str(d.program_name),
    }))
    : [];
  return {
    teamId: o.team_id,
    name: str(o.name),
    isActive: o.is_active !== false,
    players: num(o.players),
    coaches: num(o.coaches),
    upcomingEvents: num(o.upcoming_events),
    pastEvents: num(o.past_events),
    pastGames: num(o.past_games),
    results: num(o.results),
    stats: num(o.stats),
    linkedDivisions: num(o.linked_divisions),
    divisions,
    messages: num(o.messages),
    kitOutstanding: num(o.kit_outstanding),
    billingLinks: num(o.billing_links),
    blockers,
    canDelete: o.can_delete === true && blockers.length === 0,
  };
}

export type TeamImpactLine = { key: "players" | "coaches" | "upcomingEvents" | "pastEvents" | "pastGames" | "linkedDivisions" | "messages" | "kitOutstanding" | "billingLinks"; count: number };

/** Non-zero counts, in display order (keys under teamAdmin.delete.impact). */
export function teamImpactLines(i: TeamImpact): TeamImpactLine[] {
  const lines: TeamImpactLine[] = [
    { key: "players", count: i.players },
    { key: "coaches", count: i.coaches },
    { key: "upcomingEvents", count: i.upcomingEvents },
    { key: "pastEvents", count: i.pastEvents },
    { key: "pastGames", count: i.pastGames },
    { key: "linkedDivisions", count: i.linkedDivisions },
    { key: "messages", count: i.messages },
    { key: "kitOutstanding", count: i.kitOutstanding },
    { key: "billingLinks", count: i.billingLinks },
  ];
  return lines.filter((l) => l.count > 0);
}

/** Error codes raised by the SQL functions -> message keys under teamAdmin.errors. */
export function teamErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  if (m.includes("NOT_AUTHORIZED") || m.includes("permission denied") || m.includes("row-level security")) return "teamAdmin.errors.forbidden";
  if (m.includes("TEAM_DELETE_BLOCKED")) return "teamAdmin.errors.blocked";
  if (m.includes("DIVISION_HAS_APPLICATIONS")) return "teamAdmin.errors.divisionHasApplications";
  if (m.includes("DIVISION_HAS_TEAM")) return "teamAdmin.errors.divisionHasTeam";
  if (m.includes("DIVISION_NOT_FOUND")) return "teamAdmin.errors.divisionNotFound";
  if (m.includes("NOT_ARCHIVED")) return "teamAdmin.errors.notArchived";
  if (m.includes("NOT_FOUND")) return "teamAdmin.errors.notFound";
  if (m.includes("teams_name_per_season") || m.includes("duplicate key")) return "teamAdmin.errors.duplicateName";
  return "teamAdmin.errors.failed";
}
