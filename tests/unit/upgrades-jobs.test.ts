import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeAddonMrr, type AddonRevenueRow } from "@/lib/platform/mrr";
import { fakeSupabase, type FakeDb } from "./fixtures/fake-supabase";

/** Period-end housekeeping (no Stripe configured: test mode off) and add-on MRR. */

const ORG = "eeeeeeee-0000-4000-8000-0000000000e5";
const OTHER = "ffffffff-0000-4000-8000-0000000000f6";
const state: { db: FakeDb } = { db: fakeSupabase({}) };
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db.client }));
vi.mock("@/lib/log", () => ({ logError: () => "x" }));

const { processDueUpgradeChanges } = await import("@/lib/upgrades/jobs");
const NOW = new Date("2026-12-01T04:00:00Z");

beforeEach(() => {
  delete process.env.STRIPE_BILLING_SECRET_KEY;
  state.db = fakeSupabase({
    org_feature_grants: [
      { id: "a1", org_id: ORG, feature_key: "shop", kind: "addon", status: "canceling", starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-11-30T23:00:00Z", stripe_subscription_item_id: null },
      { id: "a2", org_id: ORG, feature_key: "bookings", kind: "addon", status: "canceling", starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-12-31T00:00:00Z", stripe_subscription_item_id: null },
      { id: "t1", org_id: OTHER, feature_key: "accounting", kind: "trial", status: "active", starts_at: "2026-11-01T00:00:00Z", ends_at: "2026-11-15T00:00:00Z" },
      { id: "c1", org_id: OTHER, feature_key: "*", kind: "complimentary_all", status: "active", starts_at: "2026-01-01T00:00:00Z", ends_at: null },
    ],
    subscriptions: [
      { org_id: ORG, plan_code: "academy", status: "active", currency: "CHF", billing_interval: "month", stripe_subscription_id: null, pending_plan_code: "club", pending_plan_effective_at: "2026-11-30T00:00:00Z" },
      { org_id: OTHER, plan_code: "club", status: "active", currency: "EUR", billing_interval: "month", stripe_subscription_id: null, pending_plan_code: "academy", pending_plan_effective_at: null },
    ],
    platform_audit_log: [],
  });
});

describe("processDueUpgradeChanges", () => {
  it("ends due add-ons and trials, applies due downgrades, leaves the rest", async () => {
    const r = await processDueUpgradeChanges(NOW);
    expect(r).toEqual({ removed: 1, expired: 1, plans: 1, errors: 0 });
    const g = Object.fromEntries((state.db.tables.org_feature_grants as { id: string; status: string }[]).map((x) => [x.id, x.status]));
    expect(g).toEqual({ a1: "canceled", a2: "canceling", t1: "expired", c1: "active" });
    const subs = state.db.tables.subscriptions as { org_id: string; plan_code: string; pending_plan_code: string | null }[];
    expect(subs.find((s) => s.org_id === ORG)).toMatchObject({ plan_code: "club", pending_plan_code: null });
    // a request without a date waits for the platform team
    expect(subs.find((s) => s.org_id === OTHER)).toMatchObject({ plan_code: "club", pending_plan_code: "academy" });
    // nothing deleted
    expect(state.db.tables.org_feature_grants).toHaveLength(4);
  });

  it("is idempotent", async () => {
    await processDueUpgradeChanges(NOW);
    const before = JSON.stringify(state.db.tables.org_feature_grants);
    expect(await processDueUpgradeChanges(NOW)).toEqual({ removed: 0, expired: 0, plans: 0, errors: 0 });
    expect(JSON.stringify(state.db.tables.org_feature_grants)).toBe(before);
  });
});

describe("add-on MRR", () => {
  const row = (r: Partial<AddonRevenueRow>): AddonRevenueRow => ({
    org_id: ORG, feature_key: "bookings", kind: "addon", status: "active", amount: 79, currency: "CHF", starts_at: "2026-01-01T00:00:00Z", ends_at: null, ...r,
  });
  it("sums active and canceling add-ons per currency, never complimentary grants", () => {
    const s = summarizeAddonMrr([
      row({}),
      row({ feature_key: "shop", amount: 39, status: "canceling", ends_at: "2026-12-31T00:00:00Z" }),
      row({ org_id: OTHER, amount: 79, currency: "EUR" }),
      row({ status: "pending" }),
      row({ status: "canceled" }),
      row({ status: "canceling", ends_at: "2026-11-01T00:00:00Z" }), // already ended
      row({ kind: "complimentary", amount: null }),
      row({ kind: "trial", feature_key: "accounting", ends_at: "2026-12-10T00:00:00Z", amount: null }),
    ], NOW);
    expect(s.byCurrency).toEqual([
      { currency: "CHF", mrr: 118, arr: 1416, addons: 2 },
      { currency: "EUR", mrr: 79, arr: 948, addons: 1 },
    ]);
    expect(s.byFeature[0]).toEqual({ feature: "bookings", count: 2, mrr: { CHF: 79, EUR: 79 } });
    expect(s).toMatchObject({ pending: 1, canceling: 1, trials: 1 });
  });
});
