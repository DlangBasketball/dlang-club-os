import { describe, expect, it } from "vitest";
import {
  COVER_MAX_BYTES,
  COVER_MAX_WIDTH,
  athleteCoverObjectPath,
  checkCoverFile,
  clampFocal,
  coverErrorKey,
  coverFormData,
  coverResizeParams,
  focalFromPoint,
  isAthleteCoverPath,
  isLibraryPath,
  isPublicCoverTarget,
  libraryObjectPath,
  mediaAssetUpdateSchema,
  nudgeFocal,
  objectPosition,
  setCoverSchema,
  sniffCoverType,
} from "@/lib/media/cover";
import {
  assignToTeamSchema,
  filterPlayers,
  foldSearch,
  moveMembershipSchema,
  parseJersey,
  rosterErrorKey,
  rosterIssueKey,
  sortTeamsForPicker,
  updateMembershipSchema,
  type TeamPickerOption,
} from "@/lib/sportsops/roster-validation";
import { ageOn, attendanceStats, seasonStartFor } from "@/lib/people/player-stats";

const ORG = "00000000-0000-0000-0000-000000000001";
const OTHER_ORG = "10000000-0000-0000-0000-000000000002";
const ATH = "00000000-0000-0000-0000-000000000071";
const TEAM = "a1000000-0000-0000-0000-0000000000f1";

describe("focal point math", () => {
  it("clamps to integer percentages and defaults to the centre", () => {
    expect(clampFocal(-10)).toBe(0);
    expect(clampFocal(140)).toBe(100);
    expect(clampFocal(33.6)).toBe(34);
    expect(clampFocal(Number.NaN)).toBe(50);
    expect(clampFocal(undefined)).toBe(50);
    expect(clampFocal(null)).toBe(50);
  });

  it("builds a CSS object-position", () => {
    expect(objectPosition(20, 80)).toBe("20% 80%");
    expect(objectPosition(null, 999)).toBe("50% 100%");
  });

  it("maps a click on the preview to a focal point", () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    expect(focalFromPoint(rect, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(focalFromPoint(rect, 300, 150)).toEqual({ x: 50, y: 50 });
    expect(focalFromPoint(rect, 500, 250)).toEqual({ x: 100, y: 100 });
    expect(focalFromPoint(rect, 200, 100)).toEqual({ x: 25, y: 25 });
    // outside the box: clamped
    expect(focalFromPoint(rect, 0, 999)).toEqual({ x: 0, y: 100 });
    // empty box: centre
    expect(focalFromPoint({ left: 0, top: 0, width: 0, height: 0 }, 10, 10)).toEqual({ x: 50, y: 50 });
  });

  it("nudges with the arrow keys within bounds", () => {
    expect(nudgeFocal({ x: 50, y: 50 }, "ArrowLeft")).toEqual({ x: 45, y: 50 });
    expect(nudgeFocal({ x: 98, y: 50 }, "ArrowRight")).toEqual({ x: 100, y: 50 });
    expect(nudgeFocal({ x: 50, y: 2 }, "ArrowUp")).toEqual({ x: 50, y: 0 });
    expect(nudgeFocal({ x: 50, y: 50 }, "ArrowDown", 10)).toEqual({ x: 50, y: 60 });
    expect(nudgeFocal({ x: 50, y: 50 }, "Enter")).toEqual({ x: 50, y: 50 });
  });
});

describe("cover resize parameters", () => {
  it("never upscales", () => {
    expect(coverResizeParams(1200, 800)).toEqual({ width: 1200, height: 800, scale: 1 });
  });

  it("fits the long side into 2400 px and keeps the ratio", () => {
    const r = coverResizeParams(6000, 4000);
    expect(r.width).toBe(COVER_MAX_WIDTH);
    expect(r.height).toBe(1600);
    const tall = coverResizeParams(3000, 4500);
    expect(tall.height).toBe(2400);
    expect(tall.width).toBe(1600);
  });

  it("rounds to integer pixels and never returns 0 for a real image", () => {
    const r = coverResizeParams(10000, 3);
    expect(r.width).toBe(2400);
    expect(r.height).toBe(1);
  });

  it("returns 0x0 for undecodable sizes", () => {
    expect(coverResizeParams(0, 100)).toEqual({ width: 0, height: 0, scale: 0 });
    expect(coverResizeParams(Number.NaN, 100).width).toBe(0);
    expect(coverResizeParams(Infinity, 100).width).toBe(0);
  });

  it("checks type and size after the resize", () => {
    expect(checkCoverFile({ size: 1000, type: "image/webp" })).toBeNull();
    expect(checkCoverFile({ size: 1000, type: "image/gif" })).toBe("media.errors.type");
    expect(checkCoverFile({ size: COVER_MAX_BYTES + 1, type: "image/jpeg" })).toBe("media.errors.size");
    expect(checkCoverFile({ size: 0, type: "image/jpeg" })).toBe("media.errors.noFile");
    expect(checkCoverFile(null)).toBe("media.errors.noFile");
  });

  it("sniffs the real type from the bytes", () => {
    expect(sniffCoverType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffCoverType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffCoverType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(sniffCoverType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });
});

describe("cover paths", () => {
  it("builds library and private athlete keys", () => {
    expect(libraryObjectPath(ORG, "cover", "image/webp", "abc-123")).toBe(`${ORG}/covers/abc-123.webp`);
    expect(libraryObjectPath(ORG, "gallery", "image/jpeg", "../../x")).toBe(`${ORG}/gallery/x.jpg`);
    expect(athleteCoverObjectPath(ORG, ATH, "image/png", "r1")).toBe(`${ORG}/${ATH}/r1.png`);
    expect(() => libraryObjectPath("not-a-uuid", "cover", "image/webp", "r")).toThrow();
    expect(() => athleteCoverObjectPath(ORG, "nope", "image/webp", "r")).toThrow();
  });

  it("recognises library paths of the org only", () => {
    expect(isLibraryPath(`${ORG}/covers/a.webp`, ORG)).toBe(true);
    expect(isLibraryPath(`${ORG}/banners/a.webp`, ORG)).toBe(true);
    expect(isLibraryPath(`${OTHER_ORG}/covers/a.webp`, ORG)).toBe(false);
    expect(isLibraryPath(`${ORG}/products/a.webp`, ORG)).toBe(false);
    expect(isLibraryPath(`${ORG}/covers/../x.webp`, ORG)).toBe(false);
    expect(isLibraryPath(`${ORG}/covers/sub/a.webp`, ORG)).toBe(false);
    expect(isLibraryPath(null, ORG)).toBe(false);
  });

  it("recognises private athlete cover keys", () => {
    expect(isAthleteCoverPath(`${ORG}/${ATH}/c.webp`, ORG, ATH)).toBe(true);
    expect(isAthleteCoverPath(`${ORG}/${ATH}/c.webp`, OTHER_ORG, ATH)).toBe(false);
    expect(isAthleteCoverPath(`${ORG}/${TEAM}/c.webp`, ORG, ATH)).toBe(false);
  });

  it("marks public surfaces", () => {
    expect(isPublicCoverTarget("org")).toBe(true);
    expect(isPublicCoverTarget("program")).toBe(true);
    expect(isPublicCoverTarget("camp_edition")).toBe(true);
    expect(isPublicCoverTarget("team")).toBe(false);
    expect(isPublicCoverTarget("athlete")).toBe(false);
  });
});

describe("setCover input", () => {
  it("accepts every target and clamps the focal point", () => {
    const p = setCoverSchema.parse({ target: "camp_edition", id: TEAM, mode: "focal", focalX: "150", focalY: "-3" });
    expect(p.focalX).toBe(100);
    expect(p.focalY).toBe(0);
    expect(p.publicConsent).toBe(false);
  });

  it("rejects unknown targets and modes", () => {
    expect(setCoverSchema.safeParse({ target: "family", id: TEAM, mode: "remove" }).success).toBe(false);
    expect(setCoverSchema.safeParse({ target: "team", id: TEAM, mode: "delete" }).success).toBe(false);
    expect(setCoverSchema.safeParse({ target: "team", id: "x", mode: "remove" }).success).toBe(false);
  });

  it("round-trips through coverFormData", () => {
    const fd = coverFormData({ target: "org", id: ORG, mode: "asset", assetId: TEAM, focalX: 20, focalY: 70, publicConsent: true });
    expect(fd.get("target")).toBe("org");
    expect(fd.get("assetId")).toBe(TEAM);
    expect(fd.get("publicConsent")).toBe("true");
    const parsed = setCoverSchema.parse({
      target: fd.get("target"), id: fd.get("id"), mode: fd.get("mode"), assetId: fd.get("assetId"),
      focalX: fd.get("focalX"), focalY: fd.get("focalY"), publicConsent: fd.get("publicConsent") === "true",
    });
    expect(parsed).toMatchObject({ target: "org", focalX: 20, focalY: 70, publicConsent: true });
  });

  it("maps database errors to i18n keys", () => {
    expect(coverErrorKey("CONSENT_REQUIRED")).toBe("media.errors.consentRequired");
    expect(coverErrorKey("COVER_TARGET_UNSUPPORTED")).toBe("media.errors.unsupported");
    expect(coverErrorKey("MEDIA_IN_USE")).toBe("media.errors.inUse");
    expect(coverErrorKey("new row violates row-level security policy")).toBe("media.errors.forbidden");
    expect(coverErrorKey("boom")).toBe("media.errors.generic");
  });

  it("validates library edits", () => {
    expect(mediaAssetUpdateSchema.parse({ id: TEAM, altText: "  ", consentNote: "ok" })).toMatchObject({ altText: null, consentNote: "ok" });
    expect(mediaAssetUpdateSchema.safeParse({ id: TEAM, altText: "x".repeat(301) }).success).toBe(false);
    expect(mediaAssetUpdateSchema.safeParse({ id: TEAM, kind: "poster" }).success).toBe(false);
  });
});

describe("roster validation", () => {
  it("parses jersey numbers", () => {
    expect(parseJersey("")).toBeNull();
    expect(parseJersey(null)).toBeNull();
    expect(parseJersey("07")).toBe(7);
    expect(parseJersey("999")).toBe(999);
    expect(parseJersey("1000")).toBeUndefined();
    expect(parseJersey("-1")).toBeUndefined();
    expect(parseJersey("1.5")).toBeUndefined();
    expect(parseJersey(12)).toBe(12);
    expect(parseJersey(12.5)).toBeUndefined();
  });

  it("validates an assignment", () => {
    const ok = assignToTeamSchema.parse({ athleteId: ATH, teamId: TEAM, jerseyNumber: "23", position: "  Guard " });
    expect(ok).toEqual({ athleteId: ATH, teamId: TEAM, jerseyNumber: 23, position: "Guard" });
    const empty = assignToTeamSchema.parse({ athleteId: ATH, teamId: TEAM, jerseyNumber: "", position: "" });
    expect(empty.jerseyNumber).toBeNull();
    expect(empty.position).toBeNull();
    const bad = assignToTeamSchema.safeParse({ athleteId: ATH, teamId: TEAM, jerseyNumber: "abc" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(rosterIssueKey(bad.error)).toBe("media.roster.errors.jersey");
    const badId = assignToTeamSchema.safeParse({ athleteId: "x", teamId: TEAM });
    expect(badId.success).toBe(false);
    if (!badId.success) expect(rosterIssueKey(badId.error)).toBe("media.roster.errors.invalid");
    const long = updateMembershipSchema.safeParse({ membershipId: TEAM, position: "x".repeat(61) });
    expect(long.success).toBe(false);
    if (!long.success) expect(rosterIssueKey(long.error)).toBe("media.roster.errors.position");
    expect(moveMembershipSchema.safeParse({ membershipId: TEAM, toTeamId: "nope" }).success).toBe(false);
  });

  it("maps database errors", () => {
    expect(rosterErrorKey('duplicate key value violates unique constraint "team_memberships_jersey_uniq"')).toBe("media.roster.errors.jerseyTaken");
    expect(rosterErrorKey('duplicate key value violates unique constraint "team_memberships_team_id_athlete_id_key"')).toBe("media.roster.errors.alreadyOnTeam");
    expect(rosterErrorKey("new row violates row-level security policy")).toBe("media.errors.forbidden");
    expect(rosterErrorKey("x")).toBe("media.roster.errors.generic");
  });

  it("orders teams for the picker: current season first, inactive and joined teams left out", () => {
    const teams: TeamPickerOption[] = [
      { id: "1", name: "U14 B", seasonId: "s1", seasonName: "2026/27", isCurrentSeason: true, isActive: true },
      { id: "2", name: "Old U12", seasonId: "s0", seasonName: "2025/26", isCurrentSeason: false, isActive: true },
      { id: "3", name: "U14 A", seasonId: "s1", seasonName: "2026/27", isCurrentSeason: true, isActive: true },
      { id: "4", name: "Archived", seasonId: "s1", seasonName: "2026/27", isCurrentSeason: true, isActive: false },
      { id: "5", name: "Adults", seasonId: null, seasonName: null, isCurrentSeason: false, isActive: true },
      { id: "6", name: "U16", seasonId: "s1", seasonName: "2026/27", isCurrentSeason: true, isActive: true },
    ];
    expect(sortTeamsForPicker(teams, ["6"]).map((t) => t.id)).toEqual(["3", "1", "2", "5"]);
  });

  it("filters players type-ahead, accent- and case-insensitively", () => {
    const players = [
      { id: "a", name: "Zoé Müller" },
      { id: "b", name: "Noah Martin" },
      { id: "c", name: "Léa Dubois-Martin" },
      { id: "d", name: "Marta Rossi" },
    ];
    expect(foldSearch("  Zoé ")).toBe("zoe");
    expect(filterPlayers(players, "zoe").map((p) => p.id)).toEqual(["a"]);
    expect(filterPlayers(players, "mul").map((p) => p.id)).toEqual(["a"]);
    expect(filterPlayers(players, "mart").map((p) => p.id)).toEqual(["b", "c", "d"]);
    expect(filterPlayers(players, "lea mart").map((p) => p.id)).toEqual(["c"]);
    expect(filterPlayers(players, "mart", ["b"]).map((p) => p.id)).toEqual(["c", "d"]);
    expect(filterPlayers(players, "", [], 2)).toHaveLength(2);
    expect(filterPlayers(players, "xyz")).toEqual([]);
  });
});

describe("player-card stats", () => {
  it("finds the season start", () => {
    expect(seasonStartFor("2026-11-17")).toBe("2026-08-01");
    expect(seasonStartFor("2027-03-01")).toBe("2026-08-01");
    expect(seasonStartFor("2026-11-17", "2026-08-24")).toBe("2026-08-24");
    expect(seasonStartFor("2026-07-01", "2026-08-24")).toBe("2025-08-01");
  });

  it("computes the 30-day attendance rate (excused absences do not count)", () => {
    const rows = [
      { date: "2026-11-16", status: "present" },
      { date: "2026-11-10", status: "late" },
      { date: "2026-11-03", status: "absent" },
      { date: "2026-11-01", status: "excused" },
      { date: "2026-10-01", status: "absent" }, // older than 30 days
      { date: "2026-09-01", status: "present" },
      { date: "2026-07-20", status: "present" }, // last season
      { date: "2026-12-01", status: "present" }, // future: ignored
    ];
    const s = attendanceStats(rows, "2026-11-17", "2026-08-01");
    expect(s.counted30).toBe(3);
    expect(s.attended30).toBe(2);
    expect(s.rate30).toBe(67);
    expect(s.seasonSessions).toBe(3);
  });

  it("returns null without data", () => {
    expect(attendanceStats([], "2026-11-17", "2026-08-01")).toEqual({ rate30: null, attended30: 0, counted30: 0, seasonSessions: 0 });
  });

  it("computes ages", () => {
    expect(ageOn("2014-11-17", "2026-11-17")).toBe(12);
    expect(ageOn("2014-11-18", "2026-11-17")).toBe(11);
    expect(ageOn(null, "2026-11-17")).toBeNull();
    expect(ageOn("garbage", "2026-11-17")).toBeNull();
  });
});
