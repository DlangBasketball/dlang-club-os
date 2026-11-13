import { describe, expect, it } from "vitest";
import {
  applyFilters,
  groupByDay,
  inRange,
  itemDayKeys,
  mergeSources,
  monthGrid,
  stepAnchor,
  viewRange,
  type CalendarItem,
} from "@/lib/calendar/aggregate";
import { buildIcs, foldLine, icsEscape } from "@/lib/calendar/ics";

const TZ = "Europe/Zurich";
const item = (over: Partial<CalendarItem>): CalendarItem => ({
  id: "x", kind: "team_event", sourceId: "x", title: "Item", subtype: null,
  start: "2026-03-04T16:00:00Z", end: "2026-03-04T17:30:00Z", allDay: false,
  location: null, venueId: null, teamId: null, coachIds: [], profileId: null, status: null,
  href: null, color: null, description: null, ...over,
});

describe("calendar aggregation", () => {
  const items = [
    item({ id: "team_event:e1", sourceId: "e1", teamId: "t1", venueId: "v1", coachIds: ["c1"], linkedSessionId: "s1" }),
    item({ id: "session:s1", kind: "session", sourceId: "s1", coachIds: ["c1"] }),
    item({ id: "session:s2", kind: "session", sourceId: "s2", coachIds: ["c2"], start: "2026-03-05T08:00:00Z", end: "2026-03-05T09:00:00Z" }),
    item({ id: "camp:k1", kind: "camp", sourceId: "k1", allDay: true, start: "2026-03-30", end: "2026-04-03", venueId: "v2" }),
    item({ id: "club_event:c1", kind: "club_event", sourceId: "c1", start: "2026-03-04T06:00:00Z", end: "2026-03-04T07:00:00Z" }),
    item({ id: "club_event:c1", kind: "club_event", sourceId: "c1", start: "2026-03-04T06:00:00Z", end: "2026-03-04T07:00:00Z" }),
  ];

  it("merges sources, drops sessions shown as team events and duplicates", () => {
    const merged = mergeSources(items);
    expect(merged.map((i) => i.id)).toEqual(["camp:k1", "club_event:c1", "team_event:e1", "session:s2"]);
  });

  it("filters by type, team, coach and venue", () => {
    const merged = mergeSources(items);
    expect(applyFilters(merged, { kinds: ["session", "camp"] }).map((i) => i.id)).toEqual(["camp:k1", "session:s2"]);
    expect(applyFilters(merged, { teamId: "t1" }).map((i) => i.id)).toEqual(["team_event:e1"]);
    expect(applyFilters(merged, { coachId: "c2" }).map((i) => i.id)).toEqual(["session:s2"]);
    expect(applyFilters(merged, { venueId: "v2" }).map((i) => i.id)).toEqual(["camp:k1"]);
    expect(applyFilters(merged, {}).length).toBe(4);
  });

  it("spreads multi-day and overnight items over club-local days", () => {
    expect(itemDayKeys(items[3], TZ)).toEqual(["2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-03"]);
    const night = item({ start: "2026-03-03T21:00:00Z", end: "2026-03-04T01:00:00Z" });
    expect(itemDayKeys(night, TZ)).toEqual(["2026-03-03", "2026-03-04"]);
    const toMidnight = item({ start: "2026-03-03T21:00:00Z", end: "2026-03-03T23:00:00Z" }); // 22:00-00:00 local
    expect(itemDayKeys(toMidnight, TZ)).toEqual(["2026-03-03"]);
  });

  it("groups by club-local day (time zone, not UTC)", () => {
    const late = item({ id: "late", start: "2026-03-04T23:30:00Z", end: "2026-03-04T23:45:00Z" }); // 00:30 on the 5th
    const g = groupByDay([late, ...mergeSources(items)], "2026-03-04", "2026-03-05", TZ);
    expect(g.get("2026-03-04")!.map((i) => i.id)).toEqual(["club_event:c1", "team_event:e1"]);
    expect(g.get("2026-03-05")!.map((i) => i.id)).toEqual(["late", "session:s2"]);
    expect(inRange(items[3], "2026-04-03", "2026-04-10", TZ)).toBe(true);
    expect(inRange(items[3], "2026-04-04", "2026-04-10", TZ)).toBe(false);
  });

  it("builds month grids and view ranges", () => {
    const grid = monthGrid("2026-03-15", 1);
    expect(grid[0][0]).toBe("2026-02-23");
    expect(grid[grid.length - 1][6]).toBe("2026-04-05");
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(monthGrid("2026-03-15", 0)[0][0]).toBe("2026-03-01");
    expect(viewRange("week", "2026-03-04", 1)).toEqual({ from: "2026-03-02", to: "2026-03-08" });
    expect(viewRange("week", "2026-03-04", 0)).toEqual({ from: "2026-03-01", to: "2026-03-07" });
    expect(viewRange("day", "2026-03-04")).toEqual({ from: "2026-03-04", to: "2026-03-04" });
    expect(viewRange("list", "2026-03-04")).toEqual({ from: "2026-03-04", to: "2026-03-31" });
    expect(stepAnchor("month", "2026-12-10", 1)).toBe("2027-01-01");
    expect(stepAnchor("week", "2026-03-04", -1)).toBe("2026-02-25");
  });
});

describe("ICS feed", () => {
  it("escapes and folds", () => {
    expect(icsEscape("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const folded = foldLine("SUMMARY:" + "x".repeat(100));
    expect(folded.split("\r\n ").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it("writes timed and all-day events", () => {
    const ics = buildIcs(
      [
        item({ id: "team_event:e1", title: "Training, U12", location: "Hall A", href: "/coach/team/events/e1" }),
        item({ id: "camp:k1", kind: "camp", allDay: true, start: "2026-03-30", end: "2026-04-03", title: "Easter camp", status: "cancelled" }),
      ],
      { calendarName: "Club", domain: "example.test", now: new Date("2026-03-01T00:00:00Z"), baseUrl: "https://club.example.test" },
    );
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("UID:team_event:e1@example.test");
    expect(ics).toContain("DTSTART:20260304T160000Z");
    expect(ics).toContain("SUMMARY:Training\\, U12");
    expect(ics).toContain("URL:https://club.example.test/coach/team/events/e1");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260330");
    expect(ics).toContain("DTEND;VALUE=DATE:20260404");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics.trim().endsWith("END:VCALENDAR")).toBe(true);
  });
});
