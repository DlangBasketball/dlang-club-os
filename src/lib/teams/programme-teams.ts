/**
 * Programme teams and team pickers: pure helpers shared by the server
 * (data loaders, actions) and the client pickers. No i18n here: callers turn
 * the group `kind` into a label with their translator.
 */

export const TEAM_NAME_MAX = 120;

/**
 * The programme name without a trailing season or year:
 * "EYBL 2026-27" -> "EYBL", "Academy (2026/2027)" -> "Academy",
 * "Elite squad – 2026" -> "Elite squad". Mirrors the SQL of
 * public.create_division_team.
 */
export function programmeShortName(name: string): string {
  const full = name.trim().replace(/\s+/g, " ");
  const short = full.replace(/[\s·–—-]*\(?\d{4}(\s*[-/–]\s*\d{2,4})?\)?\s*$/u, "").trim();
  return short || full;
}

/** Default team name of a programme division: "<programme short name> <division>" (e.g. "EYBL U18"). */
export function defaultDivisionTeamName(programName: string, divisionName: string): string {
  const name = `${programmeShortName(programName)} ${divisionName.trim().replace(/\s+/g, " ")}`.trim();
  return name.slice(0, TEAM_NAME_MAX);
}

export type PickerTeam = {
  id: string;
  name: string;
  seasonId: string | null;
  seasonName: string | null;
  isCurrentSeason: boolean;
  isActive: boolean;
  /** Programme the team belongs to (billing / registration link). */
  programId?: string | null;
  programName?: string | null;
  /** The programme is a selection programme (players apply: EYBL, academies, elite squads). */
  isSelectionProgram?: boolean;
};

export type TeamPickerGroupKind = "current" | "selection" | "season" | "noSeason";
export type TeamPickerGroup<T extends PickerTeam = PickerTeam> = {
  key: string;
  kind: TeamPickerGroupKind;
  /** Season name for kind "season". */
  seasonName: string | null;
  options: T[];
};

/** Option text: the season is added when it is not the current one ("EYBL U16 · 2025-26"). */
export function teamOptionLabel(t: PickerTeam): string {
  return t.seasonName && !t.isCurrentSeason ? `${t.name} · ${t.seasonName}` : t.name;
}

/**
 * Every active team of the club for a picker, in groups:
 *   1. current season
 *   2. selection programmes (EYBL U14, EYBL U16 …, whatever their season)
 *   3. one group per other season (newest name first)
 *   4. teams without a season
 * Alphabetical inside each group. Inactive (archived) teams and `excludeIds`
 * are left out; empty groups are dropped.
 */
export function groupTeamsForPicker<T extends PickerTeam>(teams: T[], excludeIds: Iterable<string> = []): TeamPickerGroup<T>[] {
  const skip = new Set(excludeIds);
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const byProgramme = (a: T, b: T) => (a.programName ?? "").localeCompare(b.programName ?? "") || byName(a, b);
  const current: T[] = [];
  const selection: T[] = [];
  const seasons = new Map<string, { name: string; teams: T[] }>();
  const none: T[] = [];
  for (const t of teams) {
    if (!t.isActive || skip.has(t.id)) continue;
    if (t.isSelectionProgram && t.programId) selection.push(t);
    else if (t.isCurrentSeason) current.push(t);
    else if (t.seasonId) {
      const s = seasons.get(t.seasonId) ?? { name: t.seasonName ?? "", teams: [] };
      s.teams.push(t);
      seasons.set(t.seasonId, s);
    } else none.push(t);
  }
  const groups: TeamPickerGroup<T>[] = [];
  if (current.length) groups.push({ key: "current", kind: "current", seasonName: null, options: current.sort(byName) });
  if (selection.length) groups.push({ key: "selection", kind: "selection", seasonName: null, options: selection.sort(byProgramme) });
  for (const [id, s] of [...seasons.entries()].sort((a, b) => b[1].name.localeCompare(a[1].name))) {
    groups.push({ key: `season:${id}`, kind: "season", seasonName: s.name || null, options: s.teams.sort(byName) });
  }
  if (none.length) groups.push({ key: "noSeason", kind: "noSeason", seasonName: null, options: none.sort(byName) });
  return groups;
}

/**
 * Teams page under a season filter: the season's teams, plus the teams with
 * no season (shown in their own "No season" group so a team never silently
 * disappears from the list).
 */
export function splitTeamsBySeason<T extends { seasonId: string | null }>(teams: T[], seasonId: string | null | undefined): { inSeason: T[]; noSeason: T[] } {
  if (!seasonId) return { inSeason: teams, noSeason: [] };
  return {
    inSeason: teams.filter((t) => t.seasonId === seasonId),
    noSeason: teams.filter((t) => !t.seasonId),
  };
}
