import { describe, expect, it } from "vitest";
import {
  inSponsorshipWindow,
  isSponsorshipLine,
  parseSeasonParam,
  parseSponsoredFilter,
  scopeCovers,
  seasonFor,
  seasonOptions,
  splitSponsoredFee,
  sponsorshipDbErrorKey,
  sponsorshipFromRow,
  sponsorshipPercent,
  sponsorshipSchema,
  sponsorshipToRow,
  type Sponsorship,
} from "@/lib/people/sponsorship";
import { summarizeSponsorships, type SponsorshipEntry } from "@/lib/people/sponsorship-report";
import { DEFAULT_DUNNING, dunnableBalance, dunningLevelFor } from "@/lib/accounting/dunning";

const full: Sponsorship = { kind: "full", percent: 100, scope: ["season", "recurring", "membership"], sponsorName: "Club", reason: null, from: null, until: null };
const half: Sponsorship = { ...full, kind: "partial", percent: 50, sponsorName: "Synthetic Company SA" };

describe("sponsorship discount math", () => {
  it("full sponsorship covers the whole fee", () => {
    expect(splitSponsoredFee(290, "CHF", full, "season", "2026-09-01")).toEqual({ currency: "CHF", amount: 290, sponsored: 290, net: 0, percent: 100 });
  });
  it("partial sponsorship covers its share, the family pays the rest", () => {
    expect(splitSponsoredFee(180, "CHF", half, "season", "2026-09-01")).toMatchObject({ sponsored: 90, net: 90, percent: 50 });
  });
  it("rounds once in the currency's minor unit (half away from zero)", () => {
    const third: Sponsorship = { ...half, percent: 33.33 };
    // 33.33 % of 100.05 = 33.346665 -> 33.35
    expect(splitSponsoredFee(100.05, "CHF", third, "season", "2026-09-01")).toMatchObject({ sponsored: 33.35, net: 66.7 });
    // zero-decimal currency
    expect(splitSponsoredFee(1001, "JPY", half, "season", "2026-09-01")).toMatchObject({ sponsored: 501, net: 500 });
  });
  it("no sponsorship or out of scope leaves the fee unchanged", () => {
    expect(splitSponsoredFee(120, "CHF", null, "membership", "2026-09-01")).toMatchObject({ sponsored: 0, net: 120, percent: 0 });
    expect(splitSponsoredFee(120, "CHF", full, "camp", "2026-09-01")).toMatchObject({ sponsored: 0, net: 120 });
  });
  it("never sponsors more than the fee", () => {
    expect(splitSponsoredFee(0, "CHF", full, "season", "2026-09-01")).toMatchObject({ sponsored: 0, net: 0 });
    expect(splitSponsoredFee(-5, "CHF", full, "season", "2026-09-01")).toMatchObject({ sponsored: 0, net: 0 });
  });
});

describe("scope matching", () => {
  it("matches listed fees and 'all'", () => {
    expect(scopeCovers(["season", "recurring"], "season")).toBe(true);
    expect(scopeCovers(["season", "recurring"], "shop")).toBe(false);
    expect(scopeCovers(["all"], "shop")).toBe(true);
    expect(sponsorshipPercent({ ...half, scope: ["all"] }, "training", "2026-09-01")).toBe(50);
  });
  it("none is never sponsored", () => {
    expect(sponsorshipPercent({ ...full, kind: "none", percent: null }, "season", "2026-09-01")).toBe(0);
  });
});

describe("date window", () => {
  const windowed: Sponsorship = { ...full, from: "2026-08-01", until: "2027-07-31" };
  it("is inclusive at both ends", () => {
    expect(inSponsorshipWindow(windowed, "2026-08-01")).toBe(true);
    expect(inSponsorshipWindow(windowed, "2027-07-31")).toBe(true);
    expect(inSponsorshipWindow(windowed, "2026-07-31")).toBe(false);
    expect(inSponsorshipWindow(windowed, "2027-08-01")).toBe(false);
  });
  it("open ends", () => {
    expect(inSponsorshipWindow({ from: null, until: null }, "1999-01-01")).toBe(true);
    expect(inSponsorshipWindow({ from: "2026-01-01", until: null }, "2040-01-01")).toBe(true);
  });
  it("outside the window nothing is sponsored", () => {
    expect(sponsorshipPercent(windowed, "season", "2027-09-01")).toBe(0);
    expect(sponsorshipPercent(windowed, "season", "2027-01-15")).toBe(100);
  });
});

describe("rows and form validation", () => {
  it("reads database rows (full forces 100, unknown scope values dropped)", () => {
    const s = sponsorshipFromRow({ sponsorship_kind: "full", sponsorship_percent: "40", sponsorship_scope: ["season", "lunch"], sponsor_name: "X" });
    expect(s).toMatchObject({ kind: "full", percent: 100, scope: ["season"], sponsorName: "X" });
    expect(sponsorshipFromRow({}).kind).toBe("none");
    expect(sponsorshipFromRow({ sponsorship_kind: "partial", sponsorship_percent: "12.50" }).percent).toBe(12.5);
  });
  it("partial needs a share between 1 and 100", () => {
    expect(sponsorshipSchema.safeParse({ kind: "partial", percent: "", scope: ["season"] }).error?.issues[0].message).toBe("sponsorship.errors.percentRequired");
    expect(sponsorshipSchema.safeParse({ kind: "partial", percent: "0", scope: ["season"] }).error?.issues[0].message).toBe("sponsorship.errors.invalidPercent");
    expect(sponsorshipSchema.safeParse({ kind: "partial", percent: "101", scope: ["season"] }).error?.issues[0].message).toBe("sponsorship.errors.invalidPercent");
    expect(sponsorshipSchema.parse({ kind: "partial", percent: "37,5%", scope: ["season"] }).percent).toBe(37.5);
  });
  it("full is 100 %, scope required, dates ordered, lengths checked", () => {
    expect(sponsorshipSchema.parse({ kind: "full", percent: "12", scope: ["season", "camp", "season"] })).toMatchObject({ percent: 100, scope: ["camp", "season"] });
    expect(sponsorshipSchema.safeParse({ kind: "full", scope: [] }).error?.issues[0].message).toBe("sponsorship.errors.scopeRequired");
    expect(sponsorshipSchema.safeParse({ kind: "full", scope: ["season"], from: "2026-09-01", until: "2026-08-01" }).error?.issues[0].message).toBe("sponsorship.errors.untilBeforeFrom");
    expect(sponsorshipSchema.safeParse({ kind: "full", scope: ["season"], sponsorName: "x".repeat(121) }).error?.issues[0].message).toBe("sponsorship.errors.tooLong");
    expect(sponsorshipSchema.safeParse({ kind: "full", scope: ["lunch"] }).success).toBe(false);
    expect(sponsorshipSchema.safeParse({ kind: "gift", scope: ["season"] }).success).toBe(false);
  });
  it("none clears everything", () => {
    const d = sponsorshipSchema.parse({ kind: "none", percent: "50", scope: [], sponsorName: "X", reason: "Y", from: "2026-01-01" });
    expect(sponsorshipToRow(d)).toEqual({
      sponsorship_kind: "none", sponsorship_percent: null, sponsorship_scope: ["season", "recurring", "membership"],
      sponsor_name: null, sponsorship_reason: null, sponsorship_from: null, sponsorship_until: null,
    });
  });
  it("maps database errors to messages", () => {
    expect(sponsorshipDbErrorKey("SPONSORSHIP_STAFF_ONLY")).toBe("sponsorship.errors.forbidden");
    expect(sponsorshipDbErrorKey("NOT_SPONSORED")).toBe("sponsorship.errors.notSponsored");
    expect(sponsorshipDbErrorKey("boom")).toBe("sponsorship.errors.saveFailed");
  });
  it("list filter", () => {
    expect(parseSponsoredFilter("yes")).toBe("yes");
    expect(parseSponsoredFilter(["no"])).toBe("no");
    expect(parseSponsoredFilter("maybe")).toBeNull();
  });
  it("recognises the database line labels", () => {
    expect(isSponsorshipLine("Sponsored (Club – coach's child)")).toBe(true);
    expect(isSponsorshipLine("Sponsorisé (Synthetic SA)")).toBe(true);
    expect(isSponsorshipLine("Gesponsert")).toBe(true);
    expect(isSponsorshipLine("Sibling discount")).toBe(false);
  });
});

describe("dunning never chases a sponsored amount", () => {
  const s = { ...DEFAULT_DUNNING, enabled: true };
  it("a fully sponsored invoice settled by a credit note has nothing to chase", () => {
    const inv = { status: "paid", total: 290, adjustments: -290, paid: 0 };
    expect(dunnableBalance(inv)).toBe(0);
    expect(dunningLevelFor(s, inv, 60, 0)).toBeNull();
    // even if the status were still open, the balance is zero
    expect(dunningLevelFor(s, { ...inv, status: "overdue" }, 60, 0)).toBeNull();
  });
  it("a cancelled (sponsored) invoice is skipped", () => {
    expect(dunningLevelFor(s, { status: "cancelled", total: 290, adjustments: -290, paid: 0 }, 60, 0)).toBeNull();
  });
  it("a partially sponsored invoice is chased for the family share only", () => {
    const inv = { status: "overdue", total: 180, adjustments: -90, paid: 0 };
    expect(dunnableBalance(inv)).toBe(90);
    expect(dunningLevelFor(s, inv, 15, 0)).toBe(1);
    expect(dunnableBalance({ ...inv, paid: 90 })).toBe(0);
  });
  it("respects the minimum balance, pauses and the disabled switch", () => {
    const inv = { status: "overdue", total: 100, adjustments: -95, paid: 0 };
    expect(dunningLevelFor({ ...s, minBalance: 10 }, inv, 60, 0)).toBeNull();
    expect(dunningLevelFor(s, { ...inv, remindersPaused: true }, 60, 0)).toBeNull();
    expect(dunningLevelFor({ ...s, enabled: false }, inv, 60, 0)).toBeNull();
  });
});

describe("sponsorship report", () => {
  const e = (over: Partial<SponsorshipEntry>): SponsorshipEntry => ({
    id: Math.random().toString(36), athleteId: "a1", playerName: "Synthetic One", sponsorName: null, scope: "season", method: "credit_note",
    percent: 100, listAmount: 100, amount: 100, currency: "CHF", date: "2026-09-01", invoiceId: null, invoiceNumber: null, ...over,
  });
  it("totals per player, per sponsor and overall, per currency", () => {
    const r = summarizeSponsorships([
      e({ amount: 0.1 }), e({ amount: 0.2 }),
      e({ athleteId: "a2", playerName: "Synthetic Two", sponsorName: "Synthetic Company SA", amount: 50 }),
      e({ athleteId: "a2", playerName: "Synthetic Two", sponsorName: "Synthetic Company SA", amount: 30, currency: "EUR" }),
    ]);
    expect(r.players).toBe(2);
    expect(r.totals).toEqual([{ currency: "CHF", amount: 50.3, count: 3 }, { currency: "EUR", amount: 30, count: 1 }]);
    expect(r.byPlayer[0]).toMatchObject({ athleteId: "a2", amount: 50, currency: "CHF", count: 1 });
    expect(r.byPlayer.find((x) => x.athleteId === "a1")).toMatchObject({ amount: 0.3, count: 2 });
    expect(r.bySponsor.find((x) => x.label === null)).toMatchObject({ amount: 0.3 });
  });
  it("seasons", () => {
    expect(seasonFor("2026-11-21")).toEqual({ label: "2026-27", from: "2026-08-01", to: "2027-07-31" });
    expect(seasonFor("2027-03-01")).toMatchObject({ label: "2026-27" });
    expect(seasonFor("2026-05-10", 1)).toEqual({ label: "2026", from: "2026-01-01", to: "2026-12-31" });
    expect(parseSeasonParam("2025-26")).toMatchObject({ from: "2025-08-01", to: "2026-07-31" });
    expect(parseSeasonParam("2025-27")).toBeNull();
    expect(parseSeasonParam("x")).toBeNull();
    expect(seasonOptions("2026-11-21").map((x) => x.label)).toEqual(["2026-27", "2025-26", "2024-25", "2023-24", "2022-23"]);
  });
});
