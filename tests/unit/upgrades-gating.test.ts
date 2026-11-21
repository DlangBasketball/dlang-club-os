import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPlanFeatures, PLAN_TIERS } from "@/lib/upgrades/catalog";
import { DEFAULT_BRANDING, DEFAULT_TERMINOLOGY } from "@/lib/tenant/defaults";
import type { Tenant } from "@/lib/tenant/types";
import { fakeSupabase, type FakeDb } from "./fixtures/fake-supabase";

/**
 * Server-side enforcement, end to end through the real resolver
 * (src/lib/upgrades/server.ts) over an in-memory database (synthetic data):
 * three representative modules refuse when the club does not have them and
 * work again once the module is on (data untouched in between).
 *   1. accounting export route        -> 404
 *   2. operations equipment check-out -> server action throws FEATURE_NOT_AVAILABLE
 *   3. website public API             -> 404 when the website connection is off
 */

const ORG_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const ORG_B = "bbbbbbbb-0000-4000-8000-0000000000b2";

const plans = PLAN_TIERS.map((code, i) => ({
  code, name: code, sort_order: (i + 1) * 10, is_public: true, is_active: true, is_custom: code === "federation", features: defaultPlanFeatures(code),
}));

function seed(planA: string, planB: string) {
  const sub = (org: string, plan: string) => ({
    org_id: org, plan_code: plan, status: "active", currency: "CHF", billing_interval: "month", trial_ends_at: null,
    feature_overrides: {}, limit_overrides: {}, stripe_subscription_id: null, current_period_end: null,
  });
  return {
    plans,
    subscriptions: [sub(ORG_A, planA), sub(ORG_B, planB)],
    organizations: [
      { id: ORG_A, suspended_at: null, currency: "CHF", slug: "club-a" },
      { id: ORG_B, suspended_at: null, currency: "CHF", slug: "club-b" },
    ],
    org_feature_grants: [] as Record<string, unknown>[],
    feature_addon_prices: [],
    ai_assistant_addons: [],
    app_settings: [],
    website_settings: [
      { org_id: ORG_A, enabled: true, allowed_origins: ["https://www.club-a.example"], public_sections: {}, embed_theme: "club", roster_public: false },
      { org_id: ORG_B, enabled: true, allowed_origins: ["https://www.club-b.example"], public_sections: {}, embed_theme: "club", roster_public: false },
    ],
    programs: [], camp_editions: [], camp_price_options: [], registrations: [], venues: [],
  };
}

const state: { db: FakeDb; user: { id: string; orgId: string; roles: string[] } | null; host: Tenant | null } = {
  db: fakeSupabase(seed("club", "academy")),
  user: null,
  host: null,
};

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db.client }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.db.client }));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: async () =>
    state.user ? { ...state.user, email: null, fullName: null, onboardingCompleted: true } : null,
}));
vi.mock("@/lib/i18n/server", () => ({
  getI18n: async () => ({ t: Object.assign((k: string) => k, { dynamic: (k: string) => k }), f: {}, ctx: {} }),
  getTranslations: async () => Object.assign((k: string) => k, { dynamic: (k: string) => k }),
  getLocaleContext: async () => ({ currency: "CHF" }),
}));
function tenant(id: string, slug: string): Tenant {
  return {
    id, slug, name: slug, appName: "Club OS", customDomain: null, branding: DEFAULT_BRANDING, terminology: DEFAULT_TERMINOLOGY, sport: null,
    country: "CH", defaultLocale: "en", supportedLocales: ["en"], currency: "CHF", timezone: "Europe/Zurich", status: "active", source: "default",
  } as Tenant;
}
vi.mock("@/lib/tenant/server", () => ({
  tenantMatchesOrg: async () => true,
  getTenant: async () => state.host,
  resolveTenant: async ({ slug }: { slug: string }) =>
    slug === "club-a" ? tenant(ORG_A, "club-a") : slug === "club-b" ? tenant(ORG_B, "club-b") : { ...tenant("", slug), id: null, source: "unknown" },
}));
// Operations module internals: once past the feature gate, the role gate refuses (no club role in this fake).
vi.mock("@/lib/operations/server", () => ({
  gate: async () => ({ me: null, t: (k: string) => k }),
  gateCommittee: async () => ({ me: null, t: (k: string) => k }),
  fail: (_t: unknown, key: string) => ({ ok: false, error: key }),
  dbFail: (_t: unknown, m: string) => ({ ok: false, error: m }),
  parseInput: () => ({ ok: false, error: "invalid" }),
  writeAudit: async () => undefined,
}));

const accountingExport = await import("@/app/(admin)/admin/accounting/export/route");
const equipment = await import("@/lib/actions/operations-equipment");
const { handlePublicApi, resetPublicApiRateLimit } = await import("@/lib/website/public-api");
const { FeatureNotAvailableError, orgsWithFeature } = await import("@/lib/upgrades/server");

beforeEach(() => {
  state.db = fakeSupabase(seed("club", "academy"));
  state.user = null;
  state.host = tenant("", "app");
  resetPublicApiRateLimit?.();
});

describe("accounting export route (Academy module)", () => {
  it("is a 404 for a Club-plan club and works once the add-on is active", async () => {
    state.user = { id: "u-a", orgId: ORG_A, roles: ["finance"] };
    const res = await accountingExport.GET(new Request("https://app.example/admin/accounting/export?kind=nope"));
    expect(res.status).toBe(404);

    state.db.tables.org_feature_grants.push({ id: "g1", org_id: ORG_A, feature_key: "accounting", kind: "addon", status: "active", starts_at: "2026-01-01T00:00:00Z", ends_at: null });
    const ok = await accountingExport.GET(new Request("https://app.example/admin/accounting/export?kind=nope"));
    expect(ok.status).toBe(400); // past the feature gate: unknown export kind
  });

  it("the Academy club next door is not affected (decided per org, server-side)", async () => {
    state.user = { id: "u-b", orgId: ORG_B, roles: ["admin"] };
    const res = await accountingExport.GET(new Request("https://app.example/admin/accounting/export?kind=nope"));
    expect(res.status).toBe(400);
  });
});

describe("operations equipment check-out (server action)", () => {
  it("refuses when the club does not have equipment & kit", async () => {
    state.user = { id: "u-a", orgId: ORG_A, roles: ["coach"] };
    await expect(equipment.checkOutEquipment({ itemId: "x", quantity: 1 })).rejects.toBeInstanceOf(FeatureNotAvailableError);
    await expect(equipment.saveEquipmentItem(null, {})).rejects.toThrow(/FEATURE_NOT_AVAILABLE:ops_equipment/);
  });

  it("passes the feature gate on a trial (then the normal role check applies)", async () => {
    state.user = { id: "u-a", orgId: ORG_A, roles: ["coach"] };
    state.db.tables.org_feature_grants.push({
      id: "t1", org_id: ORG_A, feature_key: "ops_equipment", kind: "trial", status: "active",
      starts_at: new Date(Date.now() - 86_400_000).toISOString(), ends_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await expect(equipment.checkOutEquipment({ itemId: "x", quantity: 1 })).resolves.toEqual({ ok: false, error: "operations.errors.forbidden" });
  });

  it("refuses again after the trial expired (data kept, nothing deleted)", async () => {
    state.user = { id: "u-a", orgId: ORG_A, roles: ["coach"] };
    state.db.tables.org_feature_grants.push({
      id: "t2", org_id: ORG_A, feature_key: "ops_equipment", kind: "trial", status: "active",
      starts_at: new Date(Date.now() - 20 * 86_400_000).toISOString(), ends_at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    });
    await expect(equipment.checkOutEquipment({ itemId: "x", quantity: 1 })).rejects.toBeInstanceOf(FeatureNotAvailableError);
    expect(state.db.tables.org_feature_grants).toHaveLength(1);
  });

  it("a club platform block wins over the plan", async () => {
    state.user = { id: "u-b", orgId: ORG_B, roles: ["admin"] };
    await expect(equipment.checkOutEquipment({ itemId: "x", quantity: 1 })).resolves.toMatchObject({ ok: false });
    state.db.tables.org_feature_grants.push({ id: "b1", org_id: ORG_B, feature_key: "ops_equipment", kind: "block", status: "active", starts_at: "2026-01-01T00:00:00Z", ends_at: null });
    await expect(equipment.checkOutEquipment({ itemId: "x", quantity: 1 })).rejects.toBeInstanceOf(FeatureNotAvailableError);
  });
});

describe("website public API", () => {
  const get = (q: string) =>
    handlePublicApi(new Request(`https://app.example/api/public/v1/camps?${q}`, { headers: { "x-forwarded-for": "198.51.100.9" } }), "camps");

  it("is a 404 when the club does not have the website connection", async () => {
    state.db = fakeSupabase(seed("starter", "club"));
    expect((await get("club=club-a")).status).toBe(404);
    expect((await get("club=club-b")).status).toBe(200);
  });

  it("is a 404 when the platform blocked the module, even on a plan that includes it", async () => {
    state.db = fakeSupabase(seed("club", "club"));
    state.db.tables.org_feature_grants.push({ id: "b2", org_id: ORG_B, feature_key: "website_connect", kind: "block", status: "active", starts_at: "2026-01-01T00:00:00Z", ends_at: null });
    expect((await get("club=club-a")).status).toBe(200);
    expect((await get("club=club-b")).status).toBe(404);
  });
});

describe("scheduled jobs", () => {
  it("only clubs with the module are picked up by its cron", async () => {
    state.db = fakeSupabase(seed("starter", "academy"));
    const set = await orgsWithFeature("ops_equipment");
    expect(set.ids).toEqual([ORG_B]);
    expect(set.has(ORG_A)).toBe(false);
    expect((await orgsWithFeature("invoicing")).ids.sort()).toEqual([ORG_A, ORG_B].sort());
  });
});
