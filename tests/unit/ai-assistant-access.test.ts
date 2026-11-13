import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_ASSISTANT_ROLES,
  assistantActiveForClub,
  clubOptedIn,
  evaluateAssistantAccess,
  isAssistantConfigured,
  addonEntitlement,
  addonEntitlesAssistant,
  type AddonRow,
} from "@/lib/ai/access";
import { FEATURES, isFeatureKey } from "@/lib/platform/catalog";

const on = { configured: true, entitled: true, enabled: true };
const NOW = new Date("2026-11-12T12:00:00Z");
const live = { live: true, suspended: false };
const lapsed = { live: false, suspended: false };
const row = (o: Partial<AddonRow> = {}): AddonRow => ({
  scope: "org",
  source: "paid_addon",
  status: "active",
  starts_at: "2026-01-01T00:00:00Z",
  ends_at: null,
  ...o,
});

describe("isAssistantConfigured (platform switch)", () => {
  it("needs both the key and the model", () => {
    expect(isAssistantConfigured("k", "m")).toBe(true);
    expect(isAssistantConfigured("k", undefined)).toBe(false);
    expect(isAssistantConfigured(undefined, "m")).toBe(false);
    expect(isAssistantConfigured("  ", "m")).toBe(false);
    expect(isAssistantConfigured("k", "")).toBe(false);
  });
});

describe("clubOptedIn (per-club switch, default OFF)", () => {
  it("is off when unset", () => {
    expect(clubOptedIn({})).toBe(false);
    expect(clubOptedIn(null)).toBe(false);
    expect(clubOptedIn(undefined)).toBe(false);
    expect(clubOptedIn([])).toBe(false);
  });
  it("is on only for an explicit true", () => {
    expect(clubOptedIn({ ai_assistant_enabled: true })).toBe(true);
    expect(clubOptedIn({ ai_assistant_enabled: false })).toBe(false);
    expect(clubOptedIn({ ai_assistant_enabled: "true" })).toBe(false);
    expect(clubOptedIn({ ai_assistant_enabled: 1 })).toBe(false);
  });
});

describe("AI assistant is not a plan feature (founder decision 12 Nov 2026)", () => {
  it("is not listed among the plan features in the catalog", () => {
    expect(Object.prototype.hasOwnProperty.call(FEATURES, "ai_assistant")).toBe(false);
    expect(isFeatureKey("ai_assistant")).toBe(false);
  });
  it("no plan price includes it: a live Club subscription without the add-on is not entitled", () => {
    expect(addonEntitlesAssistant([], live, NOW)).toBe(false);
    expect(addonEntitlesAssistant(null, live, NOW)).toBe(false);
  });
});

describe("addonEntitlement (mirrors org_ai_assistant_entitled)", () => {
  it("entitles a club with an active paid add-on on a live subscription", () => {
    expect(addonEntitlement([row()], live, NOW)).toBe("paid_addon");
  });
  it("does not entitle a paid add-on when the subscription lapsed", () => {
    expect(addonEntitlement([row()], lapsed, NOW)).toBe(null);
  });
  it("entitles a complimentary add-on even without a live subscription", () => {
    expect(addonEntitlement([row({ source: "complimentary" })], lapsed, NOW)).toBe("complimentary");
  });
  it("never entitles a suspended club, complimentary or not", () => {
    expect(addonEntitlement([row({ source: "complimentary" })], { live: false, suspended: true }, NOW)).toBe(null);
    expect(addonEntitlement([row()], { live: true, suspended: true }, NOW)).toBe(null);
  });
  it("ignores paused or canceled add-ons", () => {
    expect(addonEntitlement([row({ status: "paused" })], live, NOW)).toBe(null);
    expect(addonEntitlement([row({ status: "canceled", source: "complimentary" })], live, NOW)).toBe(null);
  });
  it("respects the add-on period", () => {
    expect(addonEntitlement([row({ starts_at: "2026-12-01T00:00:00Z" })], live, NOW)).toBe(null);
    expect(addonEntitlement([row({ ends_at: "2026-11-01T00:00:00Z" })], live, NOW)).toBe(null);
    expect(addonEntitlement([row({ ends_at: "2026-12-31T00:00:00Z" })], live, NOW)).toBe("paid_addon");
  });
  it("a family-scope add-on (reserved for a future parent add-on) grants nothing to the club", () => {
    expect(addonEntitlement([row({ scope: "family", source: "complimentary" })], live, NOW)).toBe(null);
  });
  it("ignores unknown sources", () => {
    expect(addonEntitlement([row({ source: "trial" })], live, NOW)).toBe(null);
  });
});

describe("evaluateAssistantAccess", () => {
  it("allows admin and finance once everything is on", () => {
    expect(evaluateAssistantAccess(on, ["admin"])).toEqual({ allowed: true, reason: null });
    expect(evaluateAssistantAccess(on, ["finance"])).toEqual({ allowed: true, reason: null });
  });
  it("denies coaches and parents (staff-only feature)", () => {
    expect(evaluateAssistantAccess(on, ["coach"])).toEqual({ allowed: false, reason: "role" });
    expect(evaluateAssistantAccess(on, ["parent"])).toEqual({ allowed: false, reason: "role" });
    expect(evaluateAssistantAccess(on, [])).toEqual({ allowed: false, reason: "role" });
    expect(AI_ASSISTANT_ROLES).toEqual(["admin", "finance"]);
  });
  it("reports the first missing condition, in order", () => {
    expect(evaluateAssistantAccess({ configured: false, entitled: false, enabled: false }, ["admin"]).reason).toBe("unconfigured");
    expect(evaluateAssistantAccess({ configured: true, entitled: false, enabled: true }, ["admin"]).reason).toBe("not_entitled");
    expect(evaluateAssistantAccess({ configured: true, entitled: true, enabled: false }, ["admin"]).reason).toBe("disabled");
  });
  it("is never on just because the env is configured (regression: default was ON)", () => {
    const state = { configured: true, entitled: addonEntitlesAssistant([row()], live, NOW), enabled: clubOptedIn({}) };
    expect(evaluateAssistantAccess(state, ["admin"]).allowed).toBe(false);
    expect(assistantActiveForClub(state)).toBe(false);
  });
  it("is never on without the add-on, even if a club flag is set", () => {
    const state = {
      configured: true,
      entitled: addonEntitlesAssistant([], live, NOW),
      enabled: clubOptedIn({ ai_assistant_enabled: true }),
    };
    expect(evaluateAssistantAccess(state, ["admin"])).toEqual({ allowed: false, reason: "not_entitled" });
    expect(assistantActiveForClub(state)).toBe(false);
  });
});

describe("assistant context (data minimisation)", () => {
  const src = readFileSync(path.resolve(__dirname, "../../src/lib/ai/context.ts"), "utf8");
  it("never reads medical tables or columns", () => {
    expect(src).not.toMatch(/athlete_medical/);
    expect(src).not.toMatch(/\.select\([^)]*medical/);
  });
  it("the server action only builds the aggregate staff context", () => {
    const action = readFileSync(path.resolve(__dirname, "../../src/lib/actions/ai.ts"), "utf8");
    expect(action).toMatch(/buildAdminContext\(\)/);
    expect(action).not.toMatch(/buildParentContext|buildCoachContext/);
    expect(action).toMatch(/getAssistantAccess\(/);
  });
});

describe("no per-customer code paths", () => {
  it("entitlement code never branches on an org slug or id", () => {
    for (const f of ["../../src/lib/ai/access.ts", "../../src/lib/ai/settings.ts"]) {
      const src = readFileSync(path.resolve(__dirname, f), "utf8");
      expect(src).not.toMatch(/dlang/i);
      expect(src).not.toMatch(/00000000-0000-0000-0000-000000000001/);
      expect(src).not.toMatch(/founding/);
    }
  });
});
