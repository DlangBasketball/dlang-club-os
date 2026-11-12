import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_ASSISTANT_ROLES,
  assistantActiveForClub,
  clubOptedIn,
  evaluateAssistantAccess,
  isAssistantConfigured,
  planEntitlesAssistant,
} from "@/lib/ai/access";

const on = { configured: true, entitled: true, enabled: true };
const ent = (o: Partial<{ planCode: string | null; live: boolean; suspended: boolean; features: Record<string, boolean> }> = {}) => ({
  planCode: "club",
  live: true,
  suspended: false,
  features: { ai_assistant: true },
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

describe("planEntitlesAssistant (mirrors org_ai_assistant_entitled)", () => {
  it("allows a live plan that includes the feature (Club tier)", () => {
    expect(planEntitlesAssistant(ent(), "starter")).toBe(true);
  });
  it("denies a plan without the feature (Starter)", () => {
    expect(planEntitlesAssistant(ent({ planCode: "starter", features: { ai_assistant: false } }), "starter")).toBe(false);
  });
  it("denies a lapsed subscription even with the feature", () => {
    expect(planEntitlesAssistant(ent({ live: false }), "club")).toBe(false);
  });
  it("allows a founding club without a subscription", () => {
    expect(planEntitlesAssistant(ent({ planCode: null, live: false, features: {} }), "founding")).toBe(true);
  });
  it("allows a founding club with a live subscription on any plan", () => {
    expect(planEntitlesAssistant(ent({ planCode: "starter", features: { ai_assistant: false } }), "founding")).toBe(true);
  });
  it("denies a founding club whose subscription lapsed", () => {
    expect(planEntitlesAssistant(ent({ planCode: "starter", live: false, features: {} }), "founding")).toBe(false);
  });
  it("denies a club with no subscription that is not founding", () => {
    expect(planEntitlesAssistant(ent({ planCode: null, live: false, features: {} }), "starter")).toBe(false);
    expect(planEntitlesAssistant(ent({ planCode: null, live: false, features: {} }), null)).toBe(false);
  });
  it("denies a suspended club, founding or not", () => {
    expect(planEntitlesAssistant(ent({ suspended: true }), "club")).toBe(false);
    expect(planEntitlesAssistant(ent({ planCode: null, suspended: true }), "founding")).toBe(false);
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
    expect(evaluateAssistantAccess({ configured: true, entitled: false, enabled: true }, ["admin"]).reason).toBe("not_in_plan");
    expect(evaluateAssistantAccess({ configured: true, entitled: true, enabled: false }, ["admin"]).reason).toBe("disabled");
  });
  it("is never on just because the env is configured (regression: default was ON)", () => {
    const state = { configured: true, entitled: planEntitlesAssistant(ent(), "club"), enabled: clubOptedIn({}) };
    expect(evaluateAssistantAccess(state, ["admin"]).allowed).toBe(false);
    expect(assistantActiveForClub(state)).toBe(false);
  });
  it("is never on without the plan feature, even if a club flag is set", () => {
    const state = {
      configured: true,
      entitled: planEntitlesAssistant(ent({ planCode: "starter", features: { ai_assistant: false } }), "starter"),
      enabled: clubOptedIn({ ai_assistant_enabled: true }),
    };
    expect(evaluateAssistantAccess(state, ["admin"])).toEqual({ allowed: false, reason: "not_in_plan" });
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
