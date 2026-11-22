import { describe, expect, it } from "vitest";
import {
  defaultDivisionTeamName,
  groupTeamsForPicker,
  programmeShortName,
  splitTeamsBySeason,
  teamOptionLabel,
  type PickerTeam,
} from "@/lib/teams/programme-teams";
import { parseTeamImpact, teamErrorKey, teamImpactLines } from "@/lib/teams/team-delete";

describe("programme team naming", () => {
  it("drops a trailing season or year from the programme name", () => {
    expect(programmeShortName("EYBL 2026-27")).toBe("EYBL");
    expect(programmeShortName("EYBL 2026/2027")).toBe("EYBL");
    expect(programmeShortName("Academy (2026-27)")).toBe("Academy");
    expect(programmeShortName("Elite squad – 2026")).toBe("Elite squad");
    expect(programmeShortName("  Regional   select  ")).toBe("Regional select");
  });
  it("keeps a name that is only a year", () => {
    expect(programmeShortName("2026")).toBe("2026");
  });
  it("default division team name is '<programme short name> <division>'", () => {
    expect(defaultDivisionTeamName("EYBL 2026-27", "U18")).toBe("EYBL U18");
    expect(defaultDivisionTeamName("EYBL", " U16 ")).toBe("EYBL U16");
    expect(defaultDivisionTeamName("x".repeat(130), "U14")).toHaveLength(120);
  });
});

const team = (over: Partial<PickerTeam> & { id: string; name: string }): PickerTeam => ({
  seasonId: null, seasonName: null, isCurrentSeason: false, isActive: true, programId: null, programName: null, isSelectionProgram: false, ...over,
});

describe("team picker groups", () => {
  const teams: PickerTeam[] = [
    team({ id: "a", name: "U12 Girls", seasonId: "s1", seasonName: "2026-27", isCurrentSeason: true }),
    team({ id: "b", name: "Men 1", seasonId: "s1", seasonName: "2026-27", isCurrentSeason: true }),
    team({ id: "c", name: "EYBL U16", seasonId: "s1", seasonName: "2026-27", isCurrentSeason: true, programId: "p1", programName: "EYBL 2026-27", isSelectionProgram: true }),
    team({ id: "d", name: "EYBL U14", programId: "p1", programName: "EYBL 2026-27", isSelectionProgram: true }),
    team({ id: "e", name: "U14 Boys", seasonId: "s0", seasonName: "2025-26" }),
    team({ id: "f", name: "U10 Mixed", seasonId: "s9", seasonName: "2024-25" }),
    team({ id: "g", name: "Walking basketball" }),
    team({ id: "h", name: "Old squad", seasonId: "s1", seasonName: "2026-27", isCurrentSeason: true, isActive: false }),
    team({ id: "i", name: "Camp team", programId: "p2", programName: "Summer camp", isSelectionProgram: false }),
  ];

  it("lists every active team: current season, selection programmes, other seasons, no season", () => {
    const groups = groupTeamsForPicker(teams);
    expect(groups.map((g) => g.kind)).toEqual(["current", "selection", "season", "season", "noSeason"]);
    expect(groups[0].options.map((t) => t.name)).toEqual(["Men 1", "U12 Girls"]);
    expect(groups[1].options.map((t) => t.name)).toEqual(["EYBL U14", "EYBL U16"]);
    expect(groups[2].seasonName).toBe("2025-26");
    expect(groups[3].seasonName).toBe("2024-25");
    expect(groups[4].options.map((t) => t.name)).toEqual(["Camp team", "Walking basketball"]);
  });
  it("leaves out archived teams and the excluded ones", () => {
    const ids = groupTeamsForPicker(teams, ["a", "d"]).flatMap((g) => g.options.map((t) => t.id));
    expect(ids).not.toContain("h");
    expect(ids).not.toContain("a");
    expect(ids).not.toContain("d");
    expect(ids).toContain("c");
  });
  it("drops empty groups", () => {
    expect(groupTeamsForPicker([team({ id: "x", name: "Solo" })]).map((g) => g.kind)).toEqual(["noSeason"]);
    expect(groupTeamsForPicker([])).toEqual([]);
  });
  it("adds the season to the label of teams outside the current season", () => {
    expect(teamOptionLabel(teams[0])).toBe("U12 Girls");
    expect(teamOptionLabel(teams[4])).toBe("U14 Boys · 2025-26");
    expect(teamOptionLabel(teams[6])).toBe("Walking basketball");
  });
  it("Teams page: the season filter keeps teams without a season in their own group", () => {
    const rows = [{ id: "1", seasonId: "s1" }, { id: "2", seasonId: null }, { id: "3", seasonId: "s0" }];
    expect(splitTeamsBySeason(rows, "s1")).toEqual({ inSeason: [rows[0]], noSeason: [rows[1]] });
    expect(splitTeamsBySeason(rows, undefined)).toEqual({ inSeason: rows, noSeason: [] });
  });
});

describe("team delete impact", () => {
  const raw = {
    team_id: "t1", name: "EYBL U16", is_active: true, players: 12, memberships: 13, coaches: 2, upcoming_events: 3,
    past_events: 4, past_games: 2, results: 2, stats: 10, linked_divisions: 1,
    divisions: [{ id: "d1", name: "U16", program_id: "p1", program_name: "EYBL 2026-27" }],
    messages: 0, kit_outstanding: 0, billing_links: 0, blockers: ["past_events", "bogus"], can_delete: false,
  };
  it("parses the preview", () => {
    const i = parseTeamImpact(raw)!;
    expect(i.players).toBe(12);
    expect(i.blockers).toEqual(["past_events"]);
    expect(i.canDelete).toBe(false);
    expect(i.divisions[0]).toEqual({ id: "d1", name: "U16", programId: "p1", programName: "EYBL 2026-27" });
    expect(teamImpactLines(i).map((l) => l.key)).toEqual(["players", "coaches", "upcomingEvents", "pastEvents", "pastGames", "linkedDivisions"]);
  });
  it("can delete only without blockers", () => {
    expect(parseTeamImpact({ ...raw, blockers: [], can_delete: true })!.canDelete).toBe(true);
    expect(parseTeamImpact({ ...raw, can_delete: true })!.canDelete).toBe(false);
  });
  it("rejects what is not an impact", () => {
    expect(parseTeamImpact(null)).toBeNull();
    expect(parseTeamImpact([])).toBeNull();
    expect(parseTeamImpact({ name: "x" })).toBeNull();
  });
  it("maps SQL errors to message keys", () => {
    expect(teamErrorKey("NOT_AUTHORIZED")).toBe("teamAdmin.errors.forbidden");
    expect(teamErrorKey("TEAM_DELETE_BLOCKED")).toBe("teamAdmin.errors.blocked");
    expect(teamErrorKey("DIVISION_HAS_APPLICATIONS")).toBe("teamAdmin.errors.divisionHasApplications");
    expect(teamErrorKey("DIVISION_NOT_FOUND")).toBe("teamAdmin.errors.divisionNotFound");
    expect(teamErrorKey("NOT_FOUND")).toBe("teamAdmin.errors.notFound");
    expect(teamErrorKey('duplicate key value violates unique constraint "teams_name_per_season"')).toBe("teamAdmin.errors.duplicateName");
    expect(teamErrorKey("boom")).toBe("teamAdmin.errors.failed");
  });
});
