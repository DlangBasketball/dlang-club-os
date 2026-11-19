import { describe, expect, it } from "vitest";
import { computePrice, inScope, type DiscountDef } from "@/lib/pricing/discounts";
import { applyDiscount, noDiscount, sharedDiscountResolver } from "@/lib/training/pricing";

const now = new Date("2026-11-13T10:00:00Z");
const d = (over: Partial<DiscountDef>): DiscountDef => ({
  id: over.id ?? "d", name: over.name ?? "Discount", kind: "percent", value: 10, currency: null, scope: "all", rule: "promo_code",
  code: null, active: true, stackable: true, ...over,
});

describe("shared discounts on the shop", () => {
  it("scope shop applies to shop items only", () => {
    expect(inScope({ scope: "shop" }, { kind: "shop", currency: "CHF", listAmount: 10 })).toBe(true);
    expect(inScope({ scope: "shop" }, { kind: "training", currency: "CHF", listAmount: 10 })).toBe(false);
    expect(inScope({ scope: "all" }, { kind: "shop", currency: "CHF", listAmount: 10 })).toBe(true);
    expect(inScope({ scope: "camps" }, { kind: "shop", currency: "CHF", listAmount: 10 })).toBe(false);
  });

  it("applies a shop promo on the order subtotal (mirrors the SQL evaluator)", () => {
    const q = computePrice({ kind: "shop", currency: "CHF", listAmount: 90 }, [d({ id: "s", scope: "shop", code: "SHOP10" })], { now, promoCode: "shop10" });
    expect(q.discountTotal).toBe(9);
    expect(q.total).toBe(81);
    expect(q.promoRejection).toBeNull();
  });

  it("rejects a camps-only code in the shop and a used-up code", () => {
    const camps = computePrice({ kind: "shop", currency: "CHF", listAmount: 90 }, [d({ id: "c", scope: "camps", code: "CAMP50", value: 50 })], { now, promoCode: "CAMP50" });
    expect(camps.promoRejection).toBe("OUT_OF_SCOPE");
    expect(camps.discountTotal).toBe(0);
    const used = computePrice({ kind: "shop", currency: "CHF", listAmount: 90 }, [d({ id: "u", scope: "shop", code: "ONCE", maxRedemptions: 1, redemptions: 1 })], { now, promoCode: "ONCE" });
    expect(used.promoRejection).toBe("LIMIT_REACHED");
  });

  it("never discounts more than the subtotal", () => {
    const q = computePrice({ kind: "shop", currency: "CHF", listAmount: 15 }, [d({ id: "f", scope: "shop", rule: "early_bird", kind: "fixed_amount", value: 20, currency: "CHF", validUntil: "2027-01-01T00:00:00Z" })], { now });
    expect(q.discountTotal).toBe(15);
    expect(q.total).toBe(0);
  });
});

describe("training discounts (applyDiscount resolver)", () => {
  const discounts: DiscountDef[] = [
    d({ id: "eb", name: "Autumn early bird", scope: "training", rule: "early_bird", kind: "fixed_amount", value: 20, currency: "CHF", validUntil: "2026-12-13T00:00:00Z" }),
    d({ id: "fr", name: "Coach friend", scope: "service", scopeServiceId: "svc", rule: "promo_code", code: "FRIEND10", value: 10 }),
    d({ id: "sib", name: "Sibling", scope: "all", rule: "sibling", value: 50 }),
    d({ id: "man", name: "Staff kid", scope: "all", rule: "manual", value: 50 }),
    d({ id: "shop", name: "Shop only", scope: "shop", rule: "early_bird", value: 30, validUntil: "2027-01-01T00:00:00Z" }),
  ];

  it("keeps the no-discount default", () => {
    expect(applyDiscount(100, "CHF", { serviceId: "svc", packageId: null }, noDiscount)).toEqual({ discountTotal: 0, discountIds: [], amount: 100 });
  });

  it("applies the early bird automatically, never sibling / shop discounts", () => {
    const p = applyDiscount(400, "CHF", { serviceId: "svc", packageId: "pkg" }, sharedDiscountResolver(discounts, { now }));
    expect(p).toEqual({ discountTotal: 20, discountIds: ["eb"], amount: 380 });
  });

  it("stacks the promo code of the service with the early bird (same as the database test)", () => {
    const p = applyDiscount(400, "CHF", { serviceId: "svc", packageId: "pkg" }, sharedDiscountResolver(discounts, { now, promoCode: "friend10" }));
    expect(p.discountTotal).toBe(60);
    expect(p.amount).toBe(340);
    expect(p.discountIds.sort()).toEqual(["eb", "fr"]);
  });

  it("ignores a service code on another service; manual only when picked", () => {
    expect(applyDiscount(100, "CHF", { serviceId: "other", packageId: null }, sharedDiscountResolver(discounts, { now, promoCode: "FRIEND10" })).discountTotal).toBe(20);
    expect(applyDiscount(400, "CHF", { serviceId: "svc", packageId: null }, sharedDiscountResolver(discounts, { now, manualDiscountIds: ["man"] })).discountTotal).toBe(220);
  });

  it("early birds with 'N days before' need the booking day", () => {
    const rel = [d({ id: "rel", scope: "training", rule: "early_bird", kind: "percent", value: 10, earlyBirdDaysBefore: 7 })];
    expect(applyDiscount(100, "CHF", { serviceId: "svc", packageId: null }, sharedDiscountResolver(rel, { now })).discountTotal).toBe(0);
    expect(applyDiscount(100, "CHF", { serviceId: "svc", packageId: null }, sharedDiscountResolver(rel, { now, startsOn: "2026-12-01" })).discountTotal).toBe(10);
    expect(applyDiscount(100, "CHF", { serviceId: "svc", packageId: null }, sharedDiscountResolver(rel, { now, startsOn: "2026-11-15" })).discountTotal).toBe(0);
  });
});
