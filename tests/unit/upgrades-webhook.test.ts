import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { fakeSupabase, type FakeDb } from "./fixtures/fake-supabase";

/**
 * Stripe Billing webhook -> add-on entitlements (synthetic data, no network).
 * The same subscription state applied twice changes nothing; removed items
 * cancel their grant; a pending request is attached, not duplicated; the plan
 * is the item without an add-on tag, wherever Stripe lists it.
 */

const ORG = "cccccccc-0000-4000-8000-0000000000c3";
const state: { db: FakeDb } = { db: fakeSupabase({}) };
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db.client }));

const { syncAddonItems, planItemOf, addonItemsOf } = await import("@/lib/upgrades/sync");
const { syncSubscription } = await import("@/lib/platform/billing");

type Item = { id: string; key?: string; amount: number; interval?: "month" | "year" };
function sub(items: Item[], over: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: "sub_test_1",
    object: "subscription",
    status: "active",
    currency: "chf",
    customer: "cus_test_1",
    metadata: { org_id: ORG, plan_code: "club" },
    trial_end: null,
    cancel_at_period_end: false,
    canceled_at: null,
    current_period_end: 1_800_000_000,
    items: {
      object: "list",
      data: items.map((i) => ({
        id: i.id,
        metadata: i.key ? { addon_key: i.key, org_id: ORG } : {},
        price: { id: `price_${i.id}`, currency: "chf", unit_amount: i.amount * 100, recurring: { interval: i.interval ?? "month" }, product: "prod_x" },
      })),
    },
    ...over,
  } as unknown as Stripe.Subscription;
}

function seed() {
  return {
    plans: [{ code: "club", name: "Club", sort_order: 20, features: {} }],
    plan_prices: [],
    subscriptions: [{ org_id: ORG, plan_code: "club", status: "active", currency: "CHF", last_stripe_event_at: null, stripe_subscription_id: "sub_test_1" }],
    org_feature_grants: [] as Record<string, unknown>[],
  };
}
const grants = () => state.db.tables.org_feature_grants as Record<string, unknown>[];
const snapshot = () => JSON.stringify(grants().map(({ updated_at: _u, ...g }) => g));

beforeEach(() => {
  state.db = fakeSupabase(seed());
});

describe("plan item vs add-on items", () => {
  it("the plan is the untagged item even when an add-on is listed first", () => {
    const s = sub([{ id: "si_addon", key: "bookings", amount: 79 }, { id: "si_plan", amount: 490 }]);
    expect(planItemOf(s)?.id).toBe("si_plan");
    expect(addonItemsOf(s).map((a) => a.key)).toEqual(["bookings"]);
  });

  it("ignores unknown and core keys in item metadata", () => {
    const s = sub([{ id: "si_plan", amount: 490 }, { id: "si_x", key: "free_money", amount: 1 }, { id: "si_core", key: "invoicing", amount: 1 }]);
    expect(addonItemsOf(s)).toEqual([]);
  });
});

describe("syncAddonItems", () => {
  it("records an add-on once; replaying the same state changes nothing", async () => {
    const s = sub([{ id: "si_plan", amount: 490 }, { id: "si_b", key: "bookings", amount: 79 }]);
    const first = await syncAddonItems(ORG, s);
    expect(first).toEqual({ upserted: 1, canceled: 0 });
    expect(grants()).toHaveLength(1);
    expect(grants()[0]).toMatchObject({ org_id: ORG, feature_key: "bookings", kind: "addon", status: "active", stripe_subscription_item_id: "si_b", amount: 79, currency: "CHF" });
    const before = snapshot();
    expect(await syncAddonItems(ORG, s)).toEqual({ upserted: 0, canceled: 0 });
    expect(snapshot()).toBe(before);
  });

  it("stores the monthly amount of a yearly add-on item", async () => {
    await syncAddonItems(ORG, sub([{ id: "si_plan", amount: 5880, interval: "year" }, { id: "si_s", key: "shop", amount: 468, interval: "year" }]));
    expect(grants()[0]).toMatchObject({ feature_key: "shop", amount: 39 });
  });

  it("attaches a pending request (created by the club admin) instead of duplicating it", async () => {
    grants().push({ id: "g-pending", org_id: ORG, feature_key: "accounting", kind: "addon", status: "pending", starts_at: "2026-11-20T00:00:00Z", ends_at: null, stripe_subscription_item_id: null });
    await syncAddonItems(ORG, sub([{ id: "si_plan", amount: 490 }, { id: "si_acc", key: "accounting", amount: 49 }]));
    expect(grants()).toHaveLength(1);
    expect(grants()[0]).toMatchObject({ id: "g-pending", status: "active", stripe_subscription_item_id: "si_acc" });
  });

  it("keeps a scheduled removal (canceling) while the item still bills", async () => {
    grants().push({ id: "g-c", org_id: ORG, feature_key: "shop", kind: "addon", status: "canceling", starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-12-01T00:00:00Z", stripe_subscription_item_id: "si_s" });
    await syncAddonItems(ORG, sub([{ id: "si_plan", amount: 490 }, { id: "si_s", key: "shop", amount: 39 }]));
    expect(grants()[0]).toMatchObject({ status: "canceling", ends_at: "2026-12-01T00:00:00Z" });
  });

  it("cancels the grant when the item disappears, idempotently", async () => {
    await syncAddonItems(ORG, sub([{ id: "si_plan", amount: 490 }, { id: "si_b", key: "bookings", amount: 79 }]));
    const removed = sub([{ id: "si_plan", amount: 490 }]);
    expect(await syncAddonItems(ORG, removed)).toEqual({ upserted: 0, canceled: 1 });
    expect(grants()[0]).toMatchObject({ status: "canceled" });
    const before = snapshot();
    expect(await syncAddonItems(ORG, removed)).toEqual({ upserted: 0, canceled: 0 });
    expect(snapshot()).toBe(before);
  });

  it("an ended subscription cancels every paid add-on", async () => {
    await syncAddonItems(ORG, sub([{ id: "si_plan", amount: 490 }, { id: "si_b", key: "bookings", amount: 79 }, { id: "si_s", key: "shop", amount: 39 }]));
    await syncAddonItems(ORG, sub([{ id: "si_plan", amount: 490 }, { id: "si_b", key: "bookings", amount: 79 }], { status: "canceled" }));
    expect(grants().every((g) => g.status === "canceled")).toBe(true);
  });

  it("only touches the given club's grants", async () => {
    grants().push({ id: "other", org_id: "dddddddd-0000-4000-8000-0000000000d4", feature_key: "bookings", kind: "addon", status: "active", starts_at: "2026-01-01T00:00:00Z", ends_at: null, stripe_subscription_item_id: "si_other" });
    await syncAddonItems(ORG, sub([{ id: "si_plan", amount: 490 }]));
    expect(grants().find((g) => g.id === "other")).toMatchObject({ status: "active" });
    expect(state.db.queries.filter((q) => q.table === "org_feature_grants" && q.op !== "insert").every((q) => q.filters.some(([k, v]) => k === "org_id" && v === ORG))).toBe(true);
  });
});

describe("billing webhook: syncSubscription replays", () => {
  it("applies plan + add-ons; the same event twice yields the same state; older events are ignored", async () => {
    const s = sub([{ id: "si_b", key: "bookings", amount: 79 }, { id: "si_plan", amount: 490 }]);
    await syncSubscription(s, { eventCreated: 1_790_000_000 });
    const subRow = state.db.tables.subscriptions[0];
    expect(subRow).toMatchObject({ plan_code: "club", stripe_price_id: "price_si_plan", status: "active" });
    const before = JSON.stringify(state.db.tables);
    await syncSubscription(s, { eventCreated: 1_790_000_000 });
    expect(JSON.stringify(state.db.tables)).toBe(before);
    const stale = await syncSubscription(sub([{ id: "si_plan", amount: 490 }]), { eventCreated: 1_780_000_000 });
    expect(stale.skipped).toBe("stale event");
    expect(grants().filter((g) => g.status === "active")).toHaveLength(1);
  });
});
