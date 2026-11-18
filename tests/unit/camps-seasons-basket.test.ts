import { describe, expect, it } from "vitest";
import type { DiscountDef } from "@/lib/pricing/discounts";
import { computePrice, discountRejection } from "@/lib/pricing/discounts";
import {
  addWeeks, autoAgeGroup, checkBasket, copyLineToChild, emptyBasket, nextLineKey, priceBasket, removeLine, resolveOption,
  sanitizeBasket, siblingPositions, storableBasket, upsertChild, weekPositions, type Basket, type PricedLine,
} from "@/lib/camps/basket";
import { campSeason, groupBySeason, nextYearName, nextYearSlug, planSeasonSplit, seasonOf } from "@/lib/camps/seasons";
import { editionDays } from "@/lib/camps/logic";
import { campErrorKey, discountSchema } from "@/lib/camps/validation";
import type { PublicCamp } from "@/lib/camps/data";

const NOW = new Date("2027-03-01T10:00:00Z");
const d = (over: Partial<DiscountDef>): DiscountDef => ({
  id: over.id ?? "d", name: over.name ?? "Discount", kind: "percent", value: 10, currency: null, scope: "all", rule: "manual",
  active: true, stackable: true, ...over,
});

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------
describe("seasons", () => {
  it("season of a day mirrors camp_season_of / camp_season_year_of", () => {
    expect(seasonOf("2027-04-05")).toEqual({ season: "spring", year: 2027 });
    expect(seasonOf("2027-07-12")).toEqual({ season: "summer", year: 2027 });
    expect(seasonOf("2027-08-31")).toEqual({ season: "summer", year: 2027 });
    expect(seasonOf("2027-10-04")).toEqual({ season: "fall", year: 2027 });
    expect(seasonOf("2027-12-27")).toEqual({ season: "winter", year: 2027 });
    expect(seasonOf("2028-02-14")).toEqual({ season: "winter", year: 2027 });
    expect(seasonOf("not a date")).toBeNull();
  });
  it("an explicit season wins, otherwise it is derived from the first week", () => {
    expect(campSeason({ season: "summer", seasonYear: 2027, firstStart: "2027-04-05" })).toEqual({ season: "summer", year: 2027 });
    expect(campSeason({ season: "summer", seasonYear: null, firstStart: "2028-07-01" })).toEqual({ season: "summer", year: 2028 });
    expect(campSeason({ season: null, firstStart: "2027-10-04" })).toEqual({ season: "fall", year: 2027 });
    expect(campSeason({ season: "bogus", firstStart: null })).toBeNull();
  });
  it("groups camps chronologically (Spring, Summer, Fall 2027, then 2028), no season last", () => {
    const camps = [
      { n: "fall27", s: seasonOf("2027-10-04") }, { n: "none", s: null }, { n: "spring28", s: seasonOf("2028-04-01") },
      { n: "summer27a", s: seasonOf("2027-07-12") }, { n: "spring27", s: seasonOf("2027-04-05") }, { n: "summer27b", s: seasonOf("2027-08-02") },
      { n: "winter27", s: seasonOf("2028-01-10") },
    ];
    const g = groupBySeason(camps, (c) => c.s);
    expect(g.map((x) => x.key)).toEqual(["spring-2027", "summer-2027", "fall-2027", "winter-2027", "spring-2028", "none"]);
    expect(g[1].items.map((x) => x.n)).toEqual(["summer27a", "summer27b"]);
  });
  it("split plan: the camp keeps the season with the most weeks (DLang 2027)", () => {
    const plan = planSeasonSplit([
      { id: "apr", startsOn: "2027-04-05" }, { id: "jul1", startsOn: "2027-07-12" }, { id: "jul2", startsOn: "2027-07-19" },
      { id: "aug", startsOn: "2027-08-02" }, { id: "oct", startsOn: "2027-10-04" },
    ]);
    expect(plan?.keep).toEqual({ season: "summer", year: 2027, editionIds: ["jul1", "jul2", "aug"] });
    expect(plan?.create.map((c) => [c.season, c.year, c.editionIds])).toEqual([["spring", 2027, ["apr"]], ["fall", 2027, ["oct"]]]);
  });
  it("split plan: ties keep the earliest season; one season = nothing to split", () => {
    const plan = planSeasonSplit([{ id: "o", startsOn: "2027-10-04" }, { id: "a", startsOn: "2027-04-05" }]);
    expect(plan?.keep.season).toBe("spring");
    expect(plan?.create.map((c) => c.season)).toEqual(["fall"]);
    expect(planSeasonSplit([{ id: "a", startsOn: "2027-07-12" }, { id: "b", startsOn: "2027-08-02" }])).toBeNull();
  });
  it("next year's name and slug", () => {
    expect(nextYearName("Summer Camp 2027")).toBe("Summer Camp 2028");
    expect(nextYearName("Skills Camp")).toBe("Skills Camp");
    expect(nextYearSlug("dlang-summer-camp-2027", 2028)).toBe("dlang-summer-camp-2028");
    expect(nextYearSlug("skills", 2028)).toBe("skills-2028");
    expect(nextYearSlug(null, 2028)).toBe("camp-2028");
  });
});

// ---------------------------------------------------------------------------
// Multi-week rule (shared discounts model)
// ---------------------------------------------------------------------------
describe("multi_week discount rule", () => {
  const mw = d({ id: "mw", name: "Multi-week", rule: "multi_week", scope: "camps", multiWeekMinPosition: 2 });
  const subject = { kind: "camp" as const, programId: "p1", currency: "CHF", listAmount: 550, startsOn: "2027-07-12" };
  it("applies from the configured week of the same child", () => {
    expect(discountRejection(mw, { ...subject, weekPosition: 1 }, { now: NOW })).toBe("NOT_A_REPEAT_WEEK");
    expect(discountRejection(mw, { ...subject, weekPosition: 2 }, { now: NOW })).toBeNull();
    expect(discountRejection({ ...mw, multiWeekMinPosition: 3 }, { ...subject, weekPosition: 2 }, { now: NOW })).toBe("NOT_A_REPEAT_WEEK");
    expect(discountRejection(mw, { ...subject }, { now: NOW })).toBe("NOT_A_REPEAT_WEEK"); // single registration flow: never
  });
  it("never applies outside camps when scoped to camps (training / shop unaffected)", () => {
    expect(discountRejection(mw, { kind: "training", currency: "CHF", listAmount: 100, weekPosition: 5 }, { now: NOW })).toBe("OUT_OF_SCOPE");
  });
  it("admin validation accepts multi_week with a position 2–20", () => {
    const base = { name: "MW", kind: "percent", value: 10, rule: "multi_week", scope: "camps" } as const;
    expect(discountSchema.safeParse({ ...base, multiWeekMinPosition: 2 }).success).toBe(true);
    expect(discountSchema.safeParse({ ...base, multiWeekMinPosition: 1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Basket pricing
// ---------------------------------------------------------------------------
const line = (key: string, childRef: string, startsOn: string, listAmount = 550, programId = "p1"): PricedLine =>
  ({ key, childRef, programId, startsOn, listAmount, currency: "CHF" });

describe("basket positions", () => {
  it("week position per child and calendar year, by start date then key (mirrors register_camp_basket)", () => {
    const lines = [line("l002", "c1", "2027-07-19"), line("l000", "c1", "2027-07-12"), line("l001", "c2", "2027-07-12"), line("l003", "c1", "2028-04-03")];
    expect(weekPositions(lines)).toEqual({ l000: 1, l002: 2, l001: 1, l003: 1 });
    expect(weekPositions(lines, { "c1|2027": 2 })).toEqual({ l000: 3, l002: 4, l001: 1, l003: 1 });
    // same start date: the line key decides
    expect(weekPositions([line("l001", "c1", "2027-07-12", 1, "p2"), line("l000", "c1", "2027-07-12")])).toEqual({ l001: 2, l000: 1 });
  });
  it("sibling position: children already on a camp first, then basket order", () => {
    expect(siblingPositions(["c2", "c1"])).toEqual({ c2: 1, c1: 2 });
    expect(siblingPositions(["c1"], 1)).toEqual({ c1: 2 });
  });
});

describe("basket pricing (sibling + multi-week + promo, shared stacking rules)", () => {
  const sib = d({ id: "sib", name: "Sibling", rule: "sibling", scope: "camps", siblingMinPosition: 2 });
  const mw = d({ id: "mw", name: "Multi-week", rule: "multi_week", scope: "camps", multiWeekMinPosition: 2 });
  const promo = d({ id: "pr", name: "Promo", rule: "promo_code", code: "SUMMER", kind: "fixed_amount", value: 30, currency: "CHF", scope: "camps" });

  it("one child, three weeks: the 2nd and 3rd week get 10%", () => {
    const q = priceBasket({ lines: [line("l000", "c1", "2027-07-12"), line("l001", "c1", "2027-07-19", 200), line("l002", "c1", "2027-08-02", 200)], discounts: [mw], now: NOW });
    expect(q.items.map((i) => i.total)).toEqual([550, 180, 180]);
    expect(q.total).toBe(910);
    expect(q.discountTotal).toBe(40);
  });
  it("two children: sibling on the 2nd child, multi-week on each child's 2nd week; both stack on the list price", () => {
    const q = priceBasket({
      lines: [line("l000", "c1", "2027-07-12"), line("l001", "c2", "2027-07-12"), line("l002", "c2", "2027-07-19")],
      discounts: [sib, mw], now: NOW,
    });
    expect(q.items.map((i) => i.discounts.map((x) => x.name))).toEqual([[], ["Sibling"], ["Sibling", "Multi-week"]]);
    expect(q.items.map((i) => i.total)).toEqual([550, 495, 440]); // 550 − 55 − 55 (no compounding)
    expect(q.total).toBe(1485);
  });
  it("a non-stackable rule is used alone, and only when worth more", () => {
    const solo = d({ id: "solo", name: "Solo 15%", rule: "multi_week", scope: "camps", value: 15, stackable: false });
    const q = priceBasket({ lines: [line("l000", "c2", "2027-07-12"), line("l001", "c2", "2027-07-19")], discounts: [sib, solo], existingSiblings: 1, now: NOW });
    // week 1: sibling only (55); week 2: sibling 55 vs solo 82.50 -> solo alone
    expect(q.items.map((i) => i.discounts.map((x) => x.discountId))).toEqual([["sib"], ["solo"]]);
    expect(q.items[1].total).toBe(467.5);
  });
  it("promo counts its usage limit across basket lines and stacks with multi-week", () => {
    const once = { ...promo, maxRedemptions: 1 };
    const q = priceBasket({ lines: [line("l000", "c1", "2027-07-12"), line("l001", "c1", "2027-07-19")], discounts: [mw, once], promoCode: "summer", now: NOW });
    expect(q.items[0].discounts.map((x) => x.discountId)).toEqual(["pr"]);
    expect(q.items[1].discounts.map((x) => x.discountId)).toEqual(["mw"]); // promo used up by the first line
    expect(q.total).toBe(550 - 30 + 550 - 55);
    expect(q.promoRejection).toBeNull();
  });
  it("existing weeks of the child count (a second checkout later in the year)", () => {
    const q = priceBasket({ lines: [line("l000", "c1", "2027-10-04", 200)], discounts: [mw], existingWeeks: { "c1|2027": 1 }, now: NOW });
    expect(q.total).toBe(180);
  });
  it("rounds per line in the currency's precision", () => {
    const pct = d({ id: "x", name: "7.5%", rule: "multi_week", scope: "camps", value: 7.5 });
    const q = priceBasket({ lines: [line("l000", "c1", "2027-07-12", 333.33), line("l001", "c1", "2027-07-19", 333.33)], discounts: [pct], now: NOW });
    expect(q.items[1].discounts[0].amount).toBe(25); // 24.99975 -> 25.00
    expect(q.total).toBe(641.66);
    expect(computePrice({ kind: "camp", currency: "CHF", listAmount: 333.33, weekPosition: 2 }, [pct], { now: NOW }).total).toBe(308.33);
  });
});

// ---------------------------------------------------------------------------
// Basket state + checks
// ---------------------------------------------------------------------------
const OPTIONS = [[2, true, 250], [2, false, 200], [3, true, 350], [3, false, 300], [4, true, 450], [4, false, 400], [5, true, 550], [5, false, 500]] as const;
const camp = (id: string, editions: { id: string; startsOn: string; endsOn: string; spotsLeft?: number | null; open?: boolean }[]): PublicCamp => ({
  program: { id, orgId: "o1", slug: id, name: `Camp ${id}`, description: null, currency: "CHF", isPublic: true },
  editions: editions.map((e) => ({
    id: e.id, programId: id, name: null, startsOn: e.startsOn, endsOn: e.endsOn, venueId: null, venue: null, locationName: null, address: null,
    city: "Lausanne", capacity: e.spotsLeft ?? null, taken: 0, spotsLeft: e.spotsLeft ?? null, registrationOpensAt: null, registrationClosesAt: null,
    status: "published", notes: null, registrations: 0, open: e.open ?? true,
  })),
  options: OPTIONS.map(([days, lunch, price], i) => ({ id: `${id}-o${days}${lunch ? "l" : "n"}`, editionId: null, label: `${days}d`, daysCount: days, includesLunch: lunch, price, currency: null, isActive: true, sort: i })),
  ageGroups: [
    { id: `${id}-g1`, label: "8–12", minAge: 8, maxAge: 12, timeSlotId: null, isActive: true, sort: 1, editionId: null },
    { id: `${id}-g2`, label: "12–17", minAge: 12, maxAge: 17, timeSlotId: null, isActive: true, sort: 2, editionId: null },
  ],
  timeSlots: [],
  consents: [],
});

describe("basket state", () => {
  it("adds weeks once per child, copies to a sibling, removes lines", () => {
    let b: Basket = emptyBasket();
    const a = upsertChild(b, { firstName: "A", lastName: "X", dob: "2016-03-14" });
    b = a.basket;
    const s = upsertChild(b, { firstName: "B", lastName: "X", dob: "2013-01-01" });
    b = s.basket;
    expect([a.ref, s.ref]).toEqual(["c1", "c2"]);
    b = addWeeks(b, a.ref, [{ programId: "p", editionId: "e1" }, { programId: "p", editionId: "e2" }, { programId: "p", editionId: "e1" }], { ageGroupId: "g", daysCount: 5, lunch: "yes" });
    expect(b.lines.map((l) => l.key)).toEqual(["l000", "l001"]);
    b = copyLineToChild(b, "l001", s.ref);
    expect(b.lines.map((l) => [l.key, l.childRef, l.editionId])).toEqual([["l000", "c1", "e1"], ["l001", "c1", "e2"], ["l002", "c2", "e2"]]);
    expect(copyLineToChild(b, "l001", s.ref)).toBe(b); // already there
    b = removeLine(b, "l002");
    expect(b.children.map((c) => c.ref)).toEqual(["c1"]); // public child without a week is dropped
    expect(nextLineKey(b.lines)).toBe("l002");
  });
  it("an existing athlete is added once", () => {
    const b1 = upsertChild(emptyBasket(), { athleteId: "ath-1", firstName: "Mateo", lastName: "", dob: "2016-03-14" });
    const b2 = upsertChild(b1.basket, { athleteId: "ath-1", firstName: "Mateo", lastName: "", dob: "2016-03-14" });
    expect(b2.ref).toBe(b1.ref);
    expect(b2.basket.children).toHaveLength(1);
  });
  it("stored basket: shape checked, health notes never written to the device", () => {
    const raw = { children: [{ ref: "c1", firstName: "A", lastName: "B", dob: "2016-01-01", allergies: "nuts", medicalNotes: "x" }, { ref: 5 }],
      lines: [{ key: "l000", childRef: "c1", programId: "p", editionId: "e", ageGroupId: "g", daysCount: 99, lunch: "maybe", days: ["2027-07-12", 3] },
        { key: "l001", childRef: "nobody", programId: "p", editionId: "e" }], promo: "X" };
    const b = sanitizeBasket(raw);
    expect(b.children).toHaveLength(1);
    expect(b.lines).toEqual([{ key: "l000", childRef: "c1", programId: "p", editionId: "e", ageGroupId: "g", daysCount: null, lunch: "", days: ["2027-07-12"] }]);
    const stored = storableBasket(b);
    expect(stored.children[0]).not.toHaveProperty("allergies");
    expect(stored.children[0]).not.toHaveProperty("medicalNotes");
    expect(sanitizeBasket("garbage")).toEqual(emptyBasket());
  });
  it("auto age group from the child's age on the first day", () => {
    const c = camp("p1", [{ id: "e1", startsOn: "2027-07-12", endsOn: "2027-07-16" }]);
    expect(autoAgeGroup(c, "2027-07-12", "2016-03-14")).toBe("p1-g1"); // 11
    expect(autoAgeGroup(c, "2027-07-12", "2014-01-01")).toBe("p1-g2"); // 13
  });
});

describe("basket checks", () => {
  const A = camp("pa", [{ id: "e1", startsOn: "2027-07-12", endsOn: "2027-07-16", spotsLeft: 1 }, { id: "e2", startsOn: "2027-07-19", endsOn: "2027-07-23", open: false }]);
  const B = camp("pb", [{ id: "e3", startsOn: "2027-08-02", endsOn: "2027-08-06" }]);
  const camps = new Map([["pa", A], ["pb", B]]);
  const days = editionDays("2027-08-02", "2027-08-06");
  const base = {
    children: [{ ref: "c1", firstName: "A", lastName: "X", dob: "2016-03-14" }, { ref: "c2", firstName: "B", lastName: "X", dob: "2016-05-01" }],
    lines: [] as Basket["lines"],
  };
  const ln = (key: string, childRef: string, programId: string, editionId: string, extra: Partial<Basket["lines"][number]> = {}): Basket["lines"][number] =>
    ({ key, childRef, programId, editionId, ageGroupId: `${programId}-g1`, daysCount: 5, lunch: "yes", days: { e1: editionDays("2027-07-12", "2027-07-16"), e2: editionDays("2027-07-19", "2027-07-23"), e3: editionDays("2027-08-02", "2027-08-06") }[editionId] ?? [], ...extra });

  it("resolves the option from days count + lunch", () => {
    expect(resolveOption(B, "e3", 2, "no")?.price).toBe(200);
    expect(resolveOption(B, "e3", 5, "yes")?.price).toBe(550);
    expect(resolveOption(B, "e3", null, "yes")).toBeUndefined();
  });
  it("reports every problem on its own line", () => {
    const r = checkBasket({ camps, strict: true, basket: { ...base, lines: [
      ln("l000", "c1", "pa", "e1"), ln("l001", "c2", "pa", "e1"), // capacity 1 for 2 lines
      ln("l002", "c1", "pa", "e2"), // closed
      ln("l003", "c1", "pb", "e3", { daysCount: 2, lunch: "no", days: days.slice(0, 3) }), // wrong days
      ln("l004", "c1", "pb", "e3"), // duplicate child-week
      ln("l005", "c9", "pb", "e3"), // unknown child
      ln("l006", "c2", "pb", "e3", { ageGroupId: "pb-g2" }), // too young for 12–17
    ] } });
    expect(Object.fromEntries(r.errors.map((e) => [e.key, e.code]))).toEqual({
      l000: "EDITION_FULL", l001: "EDITION_FULL", l002: "EDITION_NOT_OPEN", l003: "INVALID_DAYS", l004: "DUPLICATE_LINE", l005: "CHILD_NOT_FOUND", l006: "AGE_OUT_OF_RANGE",
    });
  });
  it("valid basket resolves each line's option and list price", () => {
    const r = checkBasket({ camps, strict: true, basket: { ...base, lines: [ln("l000", "c1", "pa", "e1"), ln("l001", "c1", "pb", "e3", { daysCount: 2, lunch: "no", days: days.slice(0, 2) })] } });
    expect(r.errors).toEqual([]);
    expect(r.lines.map((l) => [l.optionId, l.listAmount])).toEqual([["pa-o5l", 550], ["pb-o2n", 200]]);
  });
  it("admin may book a closed (not full) week; already-booked weeks are refused", () => {
    const r = checkBasket({ camps, strict: true, ignoreWindow: true, already: new Set(["c2|e3"]), basket: { ...base, lines: [ln("l000", "c1", "pa", "e2"), ln("l001", "c2", "pb", "e3")] } });
    expect(r.errors).toEqual([{ key: "l001", code: "ALREADY_REGISTERED" }]);
  });
  it("RPC error codes of the basket map to translated keys", () => {
    expect(campErrorKey("DUPLICATE_LINE")).toBe("camps.errors.db.DUPLICATE_LINE");
    expect(campErrorKey("NOTHING_TO_SPLIT")).toBe("camps.errors.db.NOTHING_TO_SPLIT");
    expect(campErrorKey("EDITION_HAS_REGISTRATIONS")).toBe("camps.errors.db.EDITION_HAS_REGISTRATIONS");
  });
});
