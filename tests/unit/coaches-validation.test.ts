import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import {
  COACH_ERR,
  COACH_PHOTO_BUCKET,
  USAGE_KINDS,
  canHardDelete,
  coachDbErrorKey,
  coachIdSchema,
  coachIssueKey,
  coachSchema,
  matchesCoachSearch,
  parseStatusFilter,
  parseUsage,
  quickCoachSchema,
  usageTotal,
} from "@/lib/coaches/validation";
import { isPhotoPathFor, photoObjectPath } from "@/lib/people/validation";

const ORG = "00000000-0000-0000-0000-000000000001";
const COACH = "00000000-0000-0000-0000-000000000012";

function lookup(key: string): unknown {
  return key.split(".").reduce<unknown>((n, p) => (n && typeof n === "object" ? (n as Record<string, unknown>)[p] : undefined), en);
}

describe("coachSchema", () => {
  it("accepts a full coach and normalises optional text", () => {
    const r = coachSchema.parse({ displayName: "  Alex Martin ", roleTitle: " ", bio: "", isActive: false, serves: ["pt", "shoot", "pt"] });
    expect(r).toEqual({ displayName: "Alex Martin", roleTitle: null, bio: null, isActive: false, serves: ["pt", "shoot"] });
  });

  it("defaults to active with no services", () => {
    const r = coachSchema.parse({ displayName: "Sam" });
    expect(r.isActive).toBe(true);
    expect(r.serves).toEqual([]);
  });

  it("requires a name", () => {
    const r = coachSchema.safeParse({ displayName: "   " });
    expect(r.success).toBe(false);
    if (!r.success) expect(coachIssueKey(r.error)).toBe(COACH_ERR.required);
    const missing = coachSchema.safeParse({});
    expect(missing.success).toBe(false);
    if (!missing.success) expect(coachIssueKey(missing.error)).toBe(COACH_ERR.required);
  });

  it("limits lengths", () => {
    const long = coachSchema.safeParse({ displayName: "x".repeat(121) });
    expect(long.success).toBe(false);
    if (!long.success) expect(coachIssueKey(long.error)).toBe(COACH_ERR.tooLong);
    expect(coachSchema.safeParse({ displayName: "A", bio: "b".repeat(1001) }).success).toBe(false);
    expect(coachSchema.safeParse({ displayName: "A", roleTitle: "t".repeat(121) }).success).toBe(false);
  });

  it("rejects malformed service slugs", () => {
    const r = coachSchema.safeParse({ displayName: "A", serves: ["Bad Slug!"] });
    expect(r.success).toBe(false);
    if (!r.success) expect(coachIssueKey(r.error)).toBe(COACH_ERR.invalidService);
  });

  it("ignores client-supplied org or profile ids", () => {
    const r = coachSchema.parse({ displayName: "A", org_id: ORG, profileId: COACH } as unknown as { displayName: string });
    expect(r).not.toHaveProperty("org_id");
    expect(r).not.toHaveProperty("profileId");
  });
});

describe("quickCoachSchema", () => {
  it("takes a name and optional title", () => {
    expect(quickCoachSchema.parse({ displayName: "Coach Lea", roleTitle: "" })).toEqual({ displayName: "Coach Lea", roleTitle: null });
    expect(quickCoachSchema.safeParse({ displayName: "" }).success).toBe(false);
  });
});

describe("coachIdSchema", () => {
  it("accepts uuids only", () => {
    expect(coachIdSchema.safeParse(COACH).success).toBe(true);
    expect(coachIdSchema.safeParse("12").success).toBe(false);
    expect(coachIdSchema.safeParse("../etc").success).toBe(false);
  });
});

describe("usage", () => {
  it("parses the RPC jsonb defensively", () => {
    const u = parseUsage({ teams: 2, sessions: "1", attendance: -3, bookings: null, extra: 9 });
    expect(u).toEqual({ teams: 2, sessions: 1, attendance: 0, availability: 0, bookings: 0 });
    expect(parseUsage(null)).toEqual(Object.fromEntries(USAGE_KINDS.map((k) => [k, 0])));
  });

  it("allows a hard delete only without references", () => {
    expect(canHardDelete(parseUsage({}))).toBe(true);
    expect(canHardDelete(parseUsage({ bookings: 1 }))).toBe(false);
    expect(usageTotal(parseUsage({ teams: 1, availability: 2 }))).toBe(3);
  });
});

describe("search and filters", () => {
  const coach = { name: "Zoé Müller", title: "Head coach U14", teams: ["DL Cheetah U14"] };
  it("matches every word, case and accent insensitive", () => {
    expect(matchesCoachSearch(coach, "")).toBe(true);
    expect(matchesCoachSearch(coach, "zoe")).toBe(true);
    expect(matchesCoachSearch(coach, "MULLER head")).toBe(true);
    expect(matchesCoachSearch(coach, "cheetah")).toBe(true);
    expect(matchesCoachSearch(coach, "zoe shooting")).toBe(false);
  });

  it("parses the status filter", () => {
    expect(parseStatusFilter("active")).toBe("active");
    expect(parseStatusFilter("inactive")).toBe("inactive");
    expect(parseStatusFilter("drop table")).toBe("all");
    expect(parseStatusFilter(undefined)).toBe("all");
  });
});

describe("photos", () => {
  it("uses a private coach bucket and org/coach scoped keys", () => {
    expect(COACH_PHOTO_BUCKET).toBe("coach-photos");
    const key = photoObjectPath(ORG, COACH, "image/webp", "abc");
    expect(key).toBe(`${ORG}/${COACH}/abc.webp`);
    expect(isPhotoPathFor(key, ORG, COACH)).toBe(true);
    expect(isPhotoPathFor(key, "10000000-0000-0000-0000-000000000002", COACH)).toBe(false);
  });
});

describe("error keys", () => {
  it("maps database errors to translated keys", () => {
    expect(coachDbErrorKey("COACH_IN_USE")).toBe("coaches.errors.inUse");
    expect(coachDbErrorKey("NOT_FOUND")).toBe("coaches.errors.notFound");
    expect(coachDbErrorKey("new row violates row-level security policy")).toBe("coaches.errors.forbidden");
    expect(coachDbErrorKey("violates check constraint \"coaches_photo_path_scope\"")).toBe("coaches.errors.photoPath");
    expect(coachDbErrorKey(undefined)).toBe("coaches.errors.generic");
  });

  it("every error key exists in the English catalog", () => {
    const keys = [
      ...Object.values(COACH_ERR),
      ...["COACH_IN_USE", "NOT_FOUND", "FORBIDDEN", "INVALID_PATH", ""].map(coachDbErrorKey),
    ];
    for (const k of keys) expect(typeof lookup(k), k).toBe("string");
  });
});
