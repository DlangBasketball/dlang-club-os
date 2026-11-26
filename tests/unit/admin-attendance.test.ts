import { describe, expect, it } from "vitest";
import { groupTeamsByCategory, nameMatches, parseAgeGroup, searchWords, teamCategory, type CategorizableTeam } from "@/lib/teams/categories";
import {
  activeOn, canRetryAlert, countsInTotals, dateParam, pastMembers, playerTotals, playerTotalsByTeam, sheetState,
  teamTotals, type SessionAttendanceRow,
} from "@/lib/attendance/admin-stats";
import { canSeeFlag, flagGroup, flagHref } from "@/lib/attendance/review-flags";

// Synthetic data only.
const team = (name: string, over: Partial<CategorizableTeam> = {}): CategorizableTeam => ({
  id: name.toLowerCase().replace(/\W+/g, "-"), name, ageGroup: null, level: null, isSelectionProgram: false, ...over,
});

describe("parseAgeGroup", () => {
  it("reads common age group spellings", () => {
    expect(parseAgeGroup("U14")).toEqual({ label: "U14", age: 14 });
    expect(parseAgeGroup("u-16")).toEqual({ label: "U16", age: 16 });
    expect(parseAgeGroup("14U Girls")).toEqual({ label: "U14", age: 14 });
    expect(parseAgeGroup("Under 18")).toEqual({ label: "U18", age: 18 });
    expect(parseAgeGroup("Under-12 squad")).toEqual({ label: "U12", age: 12 });
  });
  it("takes the first age of a mixed team", () => {
    expect(parseAgeGroup("U12/U14 Regional")?.label).toBe("U12");
  });
  it("returns null without an age", () => {
    expect(parseAgeGroup("Senior Men")).toBeNull();
    expect(parseAgeGroup("Season 2026")).toBeNull();
    expect(parseAgeGroup("")).toBeNull();
    expect(parseAgeGroup(null)).toBeNull();
  });
});

describe("teamCategory / groupTeamsByCategory", () => {
  it("prefers the age_group field, then the name, then the level", () => {
    expect(teamCategory(team("Falcons", { ageGroup: "U16" })).label).toBe("U16");
    expect(teamCategory(team("U18 Elite", { ageGroup: null })).label).toBe("U18");
    expect(teamCategory(team("Masters", { level: "Veterans" }))).toMatchObject({ key: "level:veterans", label: "Veterans", age: null });
    expect(teamCategory(team("Friends"))).toMatchObject({ key: "other", label: null });
  });

  it("splits club and selection teams and orders groups oldest first, other last", () => {
    const teams = [
      team("U14 Regional"), team("U18 National"), team("U16 Regional"), team("U18 Regional"), team("U12/U14 Mixed"),
      team("U16 National"), team("Walking"), team("Seniors", { level: "Adult" }),
      team("Select U14", { isSelectionProgram: true }), team("Select U16", { isSelectionProgram: true }),
    ];
    const s = groupTeamsByCategory(teams);
    expect(s.club.map((g) => g.label ?? "other")).toEqual(["U18", "U16", "U14", "U12", "Adult", "other"]);
    expect(s.club[0].teams.map((t) => t.name)).toEqual(["U18 National", "U18 Regional"]);
    expect(s.club.find((g) => g.label === "U12")?.teams.map((t) => t.name)).toEqual(["U12/U14 Mixed"]);
    expect(s.selection.map((g) => g.label)).toEqual(["U16", "U14"]);
    // Every team is listed exactly once.
    const all = [...s.club, ...s.selection].flatMap((g) => g.teams.map((t) => t.id));
    expect(all.sort()).toEqual(teams.map((t) => t.id).sort());
  });

  it("handles an empty list", () => {
    expect(groupTeamsByCategory([])).toEqual({ club: [], selection: [] });
  });
});

describe("player search helpers", () => {
  it("normalises words and matches accent-insensitively", () => {
    expect(searchWords("  Zoë  MÜLLER  x y")).toEqual(["zoe", "muller", "x"]);
    expect(nameMatches("Zoë Müller", searchWords("muller zo"))).toBe(true);
    expect(nameMatches("Zoë Müller", searchWords("smith"))).toBe(false);
    expect(nameMatches("Anyone", [])).toBe(false);
  });
});

const row = (over: Partial<SessionAttendanceRow>): SessionAttendanceRow => ({
  event_id: "e", team_id: "t1", team_name: "Team One", event_type: "training", title: null,
  starts_at: "2026-10-01T16:00:00Z", ends_at: "2026-10-01T18:00:00Z", event_status: "scheduled", cancel_reason: null,
  local_date: "2026-10-01", sheet_status: "final", finalized: true, tracked: true,
  present: 0, late: 0, excused: 0, unexcused: 0, unmarked: 0, total: 0, athlete_status: null, athlete_is_guest: null, ...over,
});

describe("attendance totals", () => {
  const rows = [
    row({ event_id: "a", present: 8, late: 1, excused: 1, unexcused: 0, athlete_status: "present" }),
    row({ event_id: "b", present: 5, late: 0, excused: 2, unexcused: 3, athlete_status: "unexcused" }),
    // Reopened for corrections: still counts with its finalized values.
    row({ event_id: "c", sheet_status: "reopened", present: 4, late: 2, excused: 0, unexcused: 0, athlete_status: "late" }),
    // Draft (never finalized): shown, not counted.
    row({ event_id: "d", sheet_status: "draft", finalized: false, present: 9, unmarked: 1, athlete_status: "present" }),
    // Cancelled after a final sheet: never counted.
    row({ event_id: "e", event_status: "cancelled", present: 7, athlete_status: "present" }),
    row({ event_id: "f", team_id: "t2", team_name: "Team Two", present: 1, athlete_status: "excused" }),
  ];

  it("counts only finalized, non-cancelled sessions", () => {
    expect(countsInTotals(rows[2])).toBe(true);
    expect(countsInTotals(rows[3])).toBe(false);
    expect(countsInTotals(rows[4])).toBe(false);
    const t = teamTotals(rows);
    expect(t).toMatchObject({ sessions: 4, present: 18, late: 3, excused: 3, unexcused: 3, marks: 27 });
    expect(t.rate).toBeCloseTo(21 / 27);
  });

  it("player totals use the player's own status", () => {
    const p = playerTotals(rows);
    expect(p).toMatchObject({ sessions: 4, present: 1, late: 1, excused: 1, unexcused: 1, marks: 4 });
    expect(p.rate).toBe(0.5);
    expect(playerTotals([]).rate).toBeNull();
  });

  it("player totals by team", () => {
    const by = playerTotalsByTeam(rows);
    expect(by.map((b) => [b.teamName, b.totals.sessions])).toEqual([["Team One", 3], ["Team Two", 1]]);
  });
});

describe("session state and coverage", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  it("derives the sheet state", () => {
    expect(sheetState({ event_status: "cancelled", sheet_status: "final", ends_at: "2026-11-20T00:00:00Z" }, now)).toBe("cancelled");
    expect(sheetState({ event_status: "scheduled", sheet_status: "final", ends_at: "2026-11-20T00:00:00Z" }, now)).toBe("final");
    expect(sheetState({ event_status: "scheduled", sheet_status: "reopened", ends_at: "2026-11-20T00:00:00Z" }, now)).toBe("reopened");
    expect(sheetState({ event_status: "scheduled", sheet_status: "draft", ends_at: "2026-11-20T00:00:00Z" }, now)).toBe("draft");
    expect(sheetState({ event_status: "scheduled", sheet_status: null, ends_at: "2026-11-24T00:00:00Z" }, now)).toBe("upcoming");
    expect(sheetState({ event_status: "scheduled", sheet_status: null, ends_at: "2026-11-22T00:00:00Z" }, now)).toBe("missing");
  });
});

describe("roster periods", () => {
  const h = [
    { athlete_id: "p1", joined_on: "2026-08-01", left_on: null },
    { athlete_id: "p2", joined_on: "2026-08-01", left_on: "2026-09-30" },
    { athlete_id: "p3", joined_on: "2026-08-01", left_on: "2026-10-15" },
    // p4 left and came back: not a past member today.
    { athlete_id: "p4", joined_on: "2026-08-01", left_on: "2026-09-01" },
    { athlete_id: "p4", joined_on: "2026-10-01", left_on: null },
  ];
  it("activeOn is inclusive", () => {
    expect(activeOn(h[1], "2026-09-30")).toBe(true);
    expect(activeOn(h[1], "2026-10-01")).toBe(false);
    expect(activeOn(h[0], "2026-07-31")).toBe(false);
  });
  it("past members: ended before the date, newest first, rejoined players excluded", () => {
    expect(pastMembers(h, "2026-11-23").map((p) => p.athlete_id)).toEqual(["p3", "p2"]);
    expect(pastMembers(h, "2026-10-01").map((p) => p.athlete_id)).toEqual(["p2"]);
  });
});

describe("alerts, flags, params", () => {
  it("retry only failed / no_contact alerts with a guardian", () => {
    expect(canRetryAlert({ status: "failed", guardian_profile_id: "g" })).toBe(true);
    expect(canRetryAlert({ status: "no_contact", guardian_profile_id: "g" })).toBe(true);
    expect(canRetryAlert({ status: "no_contact", guardian_profile_id: null })).toBe(false);
    expect(canRetryAlert({ status: "sent", guardian_profile_id: "g" })).toBe(false);
  });
  it("groups flags and hides attendance flags from finance", () => {
    expect(flagGroup("TEAM_WITHOUT_COACH")).toBe("attendance");
    expect(flagGroup("CATEGORY_AMBIGUOUS")).toBe("billing");
    expect(flagGroup("SOMETHING_ELSE")).toBe("other");
    expect(canSeeFlag("TEAM_WITHOUT_COACH", { admin: false, finance: true })).toBe(false);
    expect(canSeeFlag("CATEGORY_AMBIGUOUS", { admin: false, finance: true })).toBe(true);
    expect(canSeeFlag("TEAM_WITHOUT_COACH", { admin: true, finance: false })).toBe(true);
  });
  it("links each flag to its record", () => {
    const id = "00000000-0000-0000-0000-0000000000aa";
    expect(flagHref({ entityTable: "teams", entityId: id, reasonCode: "TEAM_WITHOUT_COACH", details: {} })).toBe(`/admin/teams/${id}?tab=coaches`);
    expect(flagHref({ entityTable: "events", entityId: id, reasonCode: "ATTENDANCE_UNFINISHED", details: {} })).toBe(`/admin/schedule/${id}/attendance`);
    expect(flagHref({ entityTable: "team_memberships", entityId: "x", reasonCode: "MEMBERSHIP_INACTIVE_NO_END", details: { team_id: id } }))
      .toBe(`/admin/teams/${id}?tab=roster`);
    expect(flagHref({ entityTable: "team_memberships", entityId: "x", reasonCode: "MEMBERSHIP_INACTIVE_NO_END", details: { team_id: "nope" } })).toBeNull();
    expect(flagHref({ entityTable: "unknown", entityId: id, reasonCode: "X", details: {} })).toBeNull();
  });
  it("parses date params", () => {
    expect(dateParam("2026-11-23")).toBe("2026-11-23");
    expect(dateParam("2026-13-45")).toBeNull();
    expect(dateParam("23.11.2026")).toBeNull();
    expect(dateParam(undefined)).toBeNull();
  });
});
