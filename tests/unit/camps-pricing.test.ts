import { describe, expect, it } from "vitest";
import {
  computeBatch, computePrice, discountAmount, discountRejection, inScope, type DiscountDef, type PricingSubject,
} from "@/lib/pricing/discounts";
import { ageFits, ageOn, csvCell, defaultDays, editionDays, fridayBefore, isRegistrationOpen, rowsForEdition, spotsLeft, validDaySelection } from "@/lib/camps/logic";
import { buildCampQuote } from "@/lib/camps/quote";
import { campErrorKey, discountSchema, editionSchema, priceOptionSchema } from "@/lib/camps/validation";
import type { PublicCamp } from "@/lib/camps/data";

const NOW = new Date("2027-03-01T10:00:00Z");
const camp: PricingSubject = { kind: "camp", programId: "p1", currency: "CHF", listAmount: 550, startsOn: "2027-04-05", siblingPosition: 1 };

const d = (over: Partial<DiscountDef>): DiscountDef => ({
  id: over.id ?? "d", name: over.name ?? "Discount", kind: "percent", value: 10, currency: null, scope: "all", rule: "manual",
  active: true, stackable: true, ...over,
});

describe("discount amounts and rounding", () => {
  it("percent of the list price, rounded half away from zero per currency", () => {
    expect(discountAmount({ kind: "percent", value: 10 }, 550, "CHF")).toBe(55);
    expect(discountAmount({ kind: "percent", value: 15 }, 333.33, "CHF")).toBe(50); // 49.9995 -> 50.00
    expect(discountAmount({ kind: "percent", value: 12.5 }, 0.1, "CHF")).toBe(0.01); // 0.0125 -> 0.01
    expect(discountAmount({ kind: "percent", value: 10 }, 1005, "JPY")).toBe(101); // 100.5 -> 101
    expect(discountAmount({ kind: "percent", value: 33.33 }, 1, "KWD")).toBe(0.333);
  });
  it("fixed amounts never exceed the list price", () => {
    expect(discountAmount({ kind: "fixed_amount", value: 50 }, 200, "CHF")).toBe(50);
    expect(discountAmount({ kind: "fixed_amount", value: 500 }, 200, "CHF")).toBe(200);
    expect(discountAmount({ kind: "percent", value: 150 }, 200, "CHF")).toBe(200);
  });
});

describe("scope and rules", () => {
  it("scope all / camps / training / program / service", () => {
    expect(inScope({ scope: "all" }, camp)).toBe(true);
    expect(inScope({ scope: "camps" }, camp)).toBe(true);
    expect(inScope({ scope: "training" }, camp)).toBe(false);
    expect(inScope({ scope: "program", scopeProgramId: "p1" }, camp)).toBe(true);
    expect(inScope({ scope: "program", scopeProgramId: "p2" }, camp)).toBe(false);
    expect(inScope({ scope: "service", scopeServiceId: "s1" }, { ...camp, kind: "training", serviceId: "s1" })).toBe(true);
  });
  it("validity window and inactive", () => {
    expect(discountRejection(d({ active: false }), camp, { now: NOW, manualDiscountIds: ["d"] })).toBe("INACTIVE");
    expect(discountRejection(d({ validFrom: "2027-03-02T00:00:00Z" }), camp, { now: NOW, manualDiscountIds: ["d"] })).toBe("NOT_YET_VALID");
    expect(discountRejection(d({ validUntil: "2027-02-28T00:00:00Z" }), camp, { now: NOW, manualDiscountIds: ["d"] })).toBe("EXPIRED");
  });
  it("fixed amounts only in their currency", () => {
    expect(discountRejection(d({ kind: "fixed_amount", value: 20, currency: "EUR" }), camp, { now: NOW, manualDiscountIds: ["d"] })).toBe("CURRENCY_MISMATCH");
    expect(discountRejection(d({ kind: "fixed_amount", value: 20, currency: "CHF" }), camp, { now: NOW, manualDiscountIds: ["d"] })).toBeNull();
  });
  it("manual discounts only when selected", () => {
    expect(discountRejection(d({}), camp, { now: NOW })).toBe("NOT_SELECTED");
  });
});

describe("sibling discount", () => {
  const sib = d({ id: "sib", name: "Sibling", rule: "sibling", siblingMinPosition: 2, scope: "camps" });
  it("applies from the configured child on", () => {
    expect(computePrice({ ...camp, siblingPosition: 1 }, [sib], { now: NOW }).discountTotal).toBe(0);
    expect(computePrice({ ...camp, siblingPosition: 2 }, [sib], { now: NOW }).discountTotal).toBe(55);
    const third = d({ ...sib, siblingMinPosition: 3 });
    expect(computePrice({ ...camp, siblingPosition: 2 }, [third], { now: NOW }).discountTotal).toBe(0);
    expect(computePrice({ ...camp, siblingPosition: 3 }, [third], { now: NOW }).discountTotal).toBe(55);
  });
  it("batch: first child full price, the next ones discounted", () => {
    const q = computeBatch([
      { ...camp, key: "a", siblingPosition: 1 }, { ...camp, key: "b", listAmount: 200, siblingPosition: 2 }, { ...camp, key: "c", listAmount: 350, siblingPosition: 3 },
    ], [sib], { now: NOW });
    expect(q.items.map((i) => i.total)).toEqual([550, 180, 315]);
    expect(q.listTotal).toBe(1100);
    expect(q.discountTotal).toBe(55);
    expect(q.total).toBe(1045);
  });
});

describe("early bird", () => {
  it("until a date", () => {
    const eb = d({ rule: "early_bird", validUntil: "2027-03-15T23:59:59Z" });
    expect(computePrice(camp, [eb], { now: NOW }).discountTotal).toBe(55);
    expect(computePrice(camp, [eb], { now: new Date("2027-03-16T00:00:00Z") }).discountTotal).toBe(0);
  });
  it("N days before the start (inclusive day)", () => {
    const eb = d({ rule: "early_bird", earlyBirdDaysBefore: 30 }); // start 2027-04-05 -> last day 2027-03-06
    expect(computePrice(camp, [eb], { now: new Date("2027-03-06T22:00:00Z") }).discountTotal).toBe(55);
    expect(computePrice(camp, [eb], { now: new Date("2027-03-07T00:00:01Z") }).discountTotal).toBe(0);
    expect(discountRejection(eb, { ...camp, startsOn: null }, { now: NOW })).toBe("OUT_OF_SCOPE");
  });
});

describe("promo codes", () => {
  const promo = d({ id: "pr", name: "Spring", rule: "promo_code", code: "SPRING27", kind: "fixed_amount", value: 30, currency: "CHF", maxRedemptions: 3, maxRedemptionsPerFamily: 1 });
  it("case-insensitive code match", () => {
    const q = computePrice(camp, [promo], { now: NOW, promoCode: " spring27 " });
    expect(q.discountTotal).toBe(30);
    expect(q.discounts[0].code).toBe("SPRING27");
    expect(q.promoRejection).toBeNull();
  });
  it("unknown and wrong codes are reported", () => {
    expect(computePrice(camp, [promo], { now: NOW, promoCode: "NOPE" }).promoRejection).toBe("UNKNOWN_CODE");
    expect(computePrice(camp, [promo], { now: NOW }).promoRejection).toBeNull();
  });
  it("total usage limit", () => {
    const q = computePrice(camp, [{ ...promo, redemptions: 3 }], { now: NOW, promoCode: "SPRING27" });
    expect(q.discountTotal).toBe(0);
    expect(q.promoRejection).toBe("LIMIT_REACHED");
  });
  it("per-family limit counts the batch", () => {
    const q = computeBatch([{ ...camp, key: "a" }, { ...camp, key: "b", siblingPosition: 2 }], [promo], { now: NOW, promoCode: "SPRING27" });
    expect(q.items[0].discountTotal).toBe(30);
    expect(q.items[1].discountTotal).toBe(0); // family limit 1
    expect(q.promoRejection).toBeNull(); // applied to at least one item
    const fam = computePrice(camp, [{ ...promo, familyRedemptions: 1 }], { now: NOW, promoCode: "SPRING27" });
    expect(fam.promoRejection).toBe("FAMILY_LIMIT_REACHED");
  });
  it("total limit counts the batch", () => {
    const q = computeBatch(["a", "b", "c"].map((key) => ({ ...camp, key })), [{ ...promo, maxRedemptionsPerFamily: null, redemptions: 1 }], { now: NOW, promoCode: "SPRING27" });
    expect(q.items.map((i) => i.discountTotal)).toEqual([30, 30, 0]);
  });
});

describe("stacking and caps", () => {
  const sib = d({ id: "s", name: "Sibling", rule: "sibling", value: 10 });
  const eb = d({ id: "e", name: "Early", rule: "early_bird", value: 5, validUntil: "2027-12-31T00:00:00Z" });
  it("stackable discounts add up on the list price (no compounding)", () => {
    const q = computePrice({ ...camp, siblingPosition: 2 }, [sib, eb], { now: NOW });
    expect(q.discounts.map((l) => l.name)).toEqual(["Early", "Sibling"]);
    expect(q.discountTotal).toBe(82.5);
    expect(q.total).toBe(467.5);
  });
  it("a non-stackable discount is used alone only when worth more", () => {
    const big = d({ id: "b", name: "Big", rule: "promo_code", code: "BIG", value: 20, stackable: false });
    const q = computePrice({ ...camp, siblingPosition: 2 }, [sib, eb, big], { now: NOW, promoCode: "BIG" });
    expect(q.discounts.map((l) => l.name)).toEqual(["Big"]);
    expect(q.discountTotal).toBe(110);
    const small = d({ ...big, value: 12 });
    const q2 = computePrice({ ...camp, siblingPosition: 2 }, [sib, eb, small], { now: NOW, promoCode: "BIG" });
    expect(q2.discountTotal).toBe(82.5);
    expect(q2.promoRejection).toBe("NOT_COMBINABLE");
  });
  it("never below zero", () => {
    const f1 = d({ id: "f1", name: "A", rule: "early_bird", kind: "fixed_amount", value: 400, currency: "CHF", validUntil: "2027-12-31T00:00:00Z" });
    const f2 = d({ id: "f2", name: "B", rule: "sibling", kind: "fixed_amount", value: 400, currency: "CHF" });
    const q = computePrice({ ...camp, siblingPosition: 2 }, [f1, f2], { now: NOW });
    expect(q.total).toBe(0);
    expect(q.discountTotal).toBe(550);
    expect(q.discounts.map((l) => l.amount)).toEqual([400, 150]);
  });
});

describe("camp logic", () => {
  it("edition days, ages, selections", () => {
    expect(editionDays("2027-04-05", "2027-04-09")).toEqual(["2027-04-05", "2027-04-06", "2027-04-07", "2027-04-08", "2027-04-09"]);
    expect(editionDays("2027-04-09", "2027-04-05")).toEqual([]);
    expect(ageOn("2015-04-06", "2027-04-05")).toBe(11);
    expect(ageOn("2015-04-05", "2027-04-05")).toBe(12);
    expect(ageFits(12, 8, 12)).toBe(true);
    expect(ageFits(13, 8, 12)).toBe(false);
    expect(validDaySelection(["2027-04-05", "2027-04-07"], 2, "2027-04-05", "2027-04-09")).toBe(true);
    expect(validDaySelection(["2027-04-05", "2027-04-05"], 2, "2027-04-05", "2027-04-09")).toBe(false);
    expect(validDaySelection(["2027-04-05", "2027-04-10"], 2, "2027-04-05", "2027-04-09")).toBe(false);
    expect(defaultDays(5, "2027-04-05", "2027-04-09")).toHaveLength(5);
    expect(defaultDays(3, "2027-04-05", "2027-04-09")).toEqual([]);
    expect(fridayBefore("2027-04-05")).toBe("2027-04-02");
    expect(spotsLeft(20, 25)).toBe(0);
    expect(spotsLeft(null, 3)).toBeNull();
  });
  it("registration window", () => {
    const e = { status: "published" as const, startsOn: "2027-04-05", endsOn: "2027-04-09", registrationOpensAt: "2027-01-01T00:00:00Z", registrationClosesAt: "2027-04-02T21:59:00Z" };
    expect(isRegistrationOpen(e, NOW)).toBe(true);
    expect(isRegistrationOpen({ ...e, status: "draft" }, NOW)).toBe(false);
    expect(isRegistrationOpen(e, new Date("2027-04-03T00:00:00Z"))).toBe(false);
    expect(isRegistrationOpen({ ...e, registrationClosesAt: null }, new Date("2027-04-05T12:00:00Z"))).toBe(true);
    expect(isRegistrationOpen({ ...e, registrationClosesAt: null }, new Date("2027-04-06T12:00:00Z"))).toBe(false);
  });
  it("edition-specific rows override camp-wide rows", () => {
    const rows = [
      { id: "a", editionId: null, sort: 2 }, { id: "b", editionId: null, sort: 1 },
      { id: "c", editionId: "e2", sort: 1 }, { id: "d", editionId: "e2", sort: 0, isActive: false },
    ];
    expect(rowsForEdition(rows, "e1").map((r) => r.id)).toEqual(["b", "a"]);
    expect(rowsForEdition(rows, "e2").map((r) => r.id)).toEqual(["c"]);
  });
  it("csv cells are quoted and formula-safe", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell(-10)).toBe("-10");
  });
});

// ---------------------------------------------------------------------------
// Quote = what the invoice will contain (DLang reference prices)
// ---------------------------------------------------------------------------
const OPTIONS = [[2, true, 250], [2, false, 200], [3, true, 350], [3, false, 300], [4, true, 450], [4, false, 400], [5, true, 550], [5, false, 500]] as const;
const publicCamp: PublicCamp = {
  program: { id: "p1", orgId: "o1", slug: "camp", name: "Skills Camp", description: null, currency: "CHF", isPublic: true },
  editions: [{
    id: "e1", programId: "p1", name: "Easter", startsOn: "2027-04-05", endsOn: "2027-04-09", venueId: null, venue: null, locationName: null, address: null,
    city: "Lausanne", capacity: 2, taken: 0, spotsLeft: 2, registrationOpensAt: null, registrationClosesAt: "2027-04-02T21:59:00Z",
    status: "published", notes: null, registrations: 0, open: true,
  }],
  options: OPTIONS.map(([days, lunch, price], i) => ({ id: `o${days}${lunch ? "l" : "n"}`, editionId: null, label: `${days}d`, daysCount: days, includesLunch: lunch, price, currency: null, isActive: true, sort: i })),
  ageGroups: [
    { id: "g1", label: "8–12", minAge: 8, maxAge: 12, timeSlotId: null, isActive: true, sort: 1, editionId: null },
    { id: "g2", label: "12–17", minAge: 12, maxAge: 17, timeSlotId: null, isActive: true, sort: 2, editionId: null },
  ],
  timeSlots: [],
  consents: [],
};
const all5 = editionDays("2027-04-05", "2027-04-09");

describe("camp quote", () => {
  it("prices options by days and lunch (reference price table)", () => {
    for (const [days, lunch, price] of OPTIONS) {
      const q = buildCampQuote({ camp: publicCamp, editionId: "e1", discounts: [], now: NOW,
        children: [{ key: "a", priceOptionId: `o${days}${lunch ? "l" : "n"}`, ageGroupId: "g1", days: all5.slice(0, days), dob: "2016-01-01" }] });
      expect(q.ok && q.quote.total).toBe(price);
    }
  });
  it("applies the sibling discount to the second child", () => {
    const sib = d({ id: "sib", name: "Sibling", rule: "sibling", scope: "camps", siblingMinPosition: 2 });
    const q = buildCampQuote({ camp: publicCamp, editionId: "e1", discounts: [sib], now: NOW, children: [
      { key: "0", priceOptionId: "o5l", ageGroupId: "g1", days: all5, dob: "2016-01-01" },
      { key: "1", priceOptionId: "o3n", ageGroupId: "g2", days: all5.slice(0, 3), dob: "2013-01-01" },
    ] });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.quote.items.map((i) => i.total)).toEqual([550, 270]);
    expect(q.quote.total).toBe(820);
  });
  it("counts siblings already registered (parent app)", () => {
    const sib = d({ id: "sib", name: "Sibling", rule: "sibling", scope: "camps" });
    const q = buildCampQuote({ camp: publicCamp, editionId: "e1", discounts: [sib], now: NOW, existingSiblings: 1,
      children: [{ key: "0", priceOptionId: "o2n", ageGroupId: "g1", days: all5.slice(0, 2), dob: "2016-01-01" }] });
    expect(q.ok && q.quote.total).toBe(180);
  });
  it("rejects wrong days, ages, full editions", () => {
    const base = { camp: publicCamp, editionId: "e1", discounts: [], now: NOW };
    expect(buildCampQuote({ ...base, children: [{ key: "0", priceOptionId: "o3n", ageGroupId: "g1", days: all5.slice(0, 2), dob: "2016-01-01" }] })).toMatchObject({ ok: false, error: "INVALID_DAYS" });
    expect(buildCampQuote({ ...base, children: [{ key: "0", priceOptionId: "o2n", ageGroupId: "g1", days: all5.slice(0, 2), dob: "2010-01-01" }] })).toMatchObject({ ok: false, error: "AGE_OUT_OF_RANGE" });
    const three = ["0", "1", "2"].map((key) => ({ key, priceOptionId: "o2n", ageGroupId: "g1", days: all5.slice(0, 2), dob: "2016-01-01" }));
    expect(buildCampQuote({ ...base, children: three })).toMatchObject({ ok: false, error: "EDITION_FULL" });
    expect(buildCampQuote({ ...base, children: [{ key: "0", priceOptionId: "nope", ageGroupId: "g1", days: [], dob: null }] })).toMatchObject({ ok: false, error: "PRICE_OPTION_NOT_FOUND" });
  });
});

describe("validation", () => {
  it("editions", () => {
    expect(editionSchema.safeParse({ startsOn: "2027-04-05", endsOn: "2027-04-09", status: "published" }).success).toBe(true);
    expect(editionSchema.safeParse({ startsOn: "2027-04-09", endsOn: "2027-04-05" }).success).toBe(false);
    expect(editionSchema.safeParse({ startsOn: "2027-04-05", endsOn: "2027-04-09", registrationOpensAt: "2027-04-02T00:00:00Z", registrationClosesAt: "2027-04-01T00:00:00Z" }).success).toBe(false);
  });
  it("price options", () => {
    expect(priceOptionSchema.safeParse({ label: "5 days", daysCount: 5, price: 550 }).success).toBe(true);
    expect(priceOptionSchema.safeParse({ label: "5 days", daysCount: 0, price: 550 }).success).toBe(false);
    expect(priceOptionSchema.safeParse({ label: "", daysCount: 5, price: 550 }).success).toBe(false);
    expect(priceOptionSchema.safeParse({ label: "x", daysCount: 5, price: -1 }).success).toBe(false);
  });
  it("discounts", () => {
    expect(discountSchema.safeParse({ name: "Sib", kind: "percent", value: 10, rule: "sibling" }).success).toBe(true);
    expect(discountSchema.safeParse({ name: "P", kind: "percent", value: 110, rule: "manual" }).success).toBe(false);
    expect(discountSchema.safeParse({ name: "P", kind: "fixed_amount", value: 10, rule: "manual" }).success).toBe(false);
    expect(discountSchema.safeParse({ name: "P", kind: "fixed_amount", value: 10, currency: "chf", rule: "manual" }).success).toBe(true);
    expect(discountSchema.safeParse({ name: "P", kind: "percent", value: 10, rule: "promo_code", code: "x" }).success).toBe(false);
    const ok = discountSchema.safeParse({ name: "P", kind: "percent", value: 10, rule: "promo_code", code: "spring-27" });
    expect(ok.success && ok.data.code).toBe("SPRING-27");
    expect(discountSchema.safeParse({ name: "E", kind: "percent", value: 10, rule: "early_bird" }).success).toBe(false);
    expect(discountSchema.safeParse({ name: "S", kind: "percent", value: 10, rule: "manual", scope: "program" }).success).toBe(false);
  });
  it("maps database errors to catalog keys", () => {
    expect(campErrorKey("EDITION_FULL")).toBe("camps.errors.db.EDITION_FULL");
    expect(campErrorKey("new row violates row-level security policy")).toBe("camps.errors.notPermitted");
    expect(campErrorKey("boom")).toBe("camps.errors.generic");
  });
});
