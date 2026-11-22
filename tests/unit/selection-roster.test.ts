import { describe, expect, it } from "vitest";
import {
  arrangementSchedule, athleteAgeGroup, divisionFits, filterRoster, moneySummary, packageForTournamentCount,
  parseRosterFilters, programDivisionLabel, programShortName, rosterFiltersActive, seriesKey, tryArrangementSchedule,
} from "@/lib/selection/arrangement";

describe("fee arrangement schedule", () => {
  it("3000 at 300 a month -> 10 instalments", () => {
    const s = arrangementSchedule(3000, "monthly", 300, "2026-09-15");
    expect(s).toHaveLength(10);
    expect(s.every((r) => r.amount === 300)).toBe(true);
    expect(s[0].dueOn).toBe("2026-09-15");
    expect(s[9].dueOn).toBe("2027-06-15");
  });
  it("1500 at 300 -> 5; 4500 at 450 -> 10", () => {
    expect(arrangementSchedule(1500, "monthly", 300, "2026-09-01")).toHaveLength(5);
    expect(arrangementSchedule(4500, "monthly", 450, "2026-09-01")).toHaveLength(10);
  });
  it("3100 at 300 -> 10 x 300 + a smaller last one of 100", () => {
    const s = arrangementSchedule(3100, "monthly", 300, "2026-09-01");
    expect(s).toHaveLength(11);
    expect(s.slice(0, 10).every((r) => r.amount === 300)).toBe(true);
    expect(s[10].amount).toBe(100);
    expect(s.reduce((a, r) => a + r.amount, 0)).toBe(3100);
  });
  it("first due date on a month end is clamped in shorter months", () => {
    const s = arrangementSchedule(900, "monthly", 300, "2026-01-31");
    expect(s.map((r) => r.dueOn)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });
  it("pay in full: one amount on the first due date", () => {
    expect(arrangementSchedule(3000, "full", null, "2026-10-01")).toEqual([{ seq: 1, dueOn: "2026-10-01", amount: 3000 }]);
  });
  it("rejects bad input with the SQL error codes", () => {
    expect(tryArrangementSchedule(3000, "monthly", 0, "2026-10-01")).toEqual({ ok: false, code: "INVALID_MONTHLY_AMOUNT" });
    expect(tryArrangementSchedule(3000, "monthly", 10, "2026-10-01")).toEqual({ ok: false, code: "TOO_MANY_INSTALLMENTS" });
    expect(tryArrangementSchedule(0, "full", null, "2026-10-01")).toEqual({ ok: false, code: "INVALID_AMOUNT" });
    expect(tryArrangementSchedule(3000, "full", null, "bad")).toEqual({ ok: false, code: "INVALID_DATE" });
  });
});

describe("payment status derivation", () => {
  const plan = arrangementSchedule(3000, "monthly", 300, "2026-09-01").map((r) => ({ dueOn: r.dueOn, amount: r.amount }));
  it("unpaid", () => {
    const m = moneySummary({ amountDue: 3000, received: 0, installments: plan, invoiceDueOn: null, today: "2026-08-20" });
    expect(m).toMatchObject({ status: "unpaid", balance: 3000, nextDueOn: "2026-09-01", overdueAmount: 0 });
  });
  it("300 received on 3000 -> partial, balance 2700, next instalment", () => {
    const m = moneySummary({ amountDue: 3000, received: 300, installments: plan, invoiceDueOn: null, today: "2026-09-10" });
    expect(m).toMatchObject({ status: "partial", received: 300, balance: 2700, nextDueOn: "2026-10-01", overdueAmount: 0 });
  });
  it("overdue is flagged separately from the status", () => {
    const m = moneySummary({ amountDue: 3000, received: 300, installments: plan, invoiceDueOn: null, today: "2026-11-15" });
    expect(m.status).toBe("partial");
    expect(m.overdueAmount).toBe(600); // Oct + Nov unpaid
  });
  it("paid in full", () => {
    const m = moneySummary({ amountDue: 3000, received: 3000, installments: plan, invoiceDueOn: null, today: "2027-01-01" });
    expect(m).toMatchObject({ status: "paid", balance: 0, nextDueOn: null, overdueAmount: 0 });
  });
  it("no plan: the invoice due date", () => {
    expect(moneySummary({ amountDue: 1500, received: 0, installments: [], invoiceDueOn: "2026-09-01", today: "2026-09-02" }))
      .toMatchObject({ status: "unpaid", overdueAmount: 1500, nextDueOn: "2026-09-01" });
  });
  it("cancelled invoice -> none", () => {
    expect(moneySummary({ amountDue: 1500, received: 0, installments: [], invoiceDueOn: null, today: "2026-09-02", cancelled: true }).status).toBe("none");
  });
});

describe("divisions and labels", () => {
  const u14 = { minBirthYear: 2013, maxBirthYear: null, ageUnder: null, ageCutoff: null };
  const u16 = { minBirthYear: 2011, maxBirthYear: 2012, ageUnder: null, ageCutoff: null };
  it("division fit", () => {
    expect(divisionFits(u16, "2012-05-01", "2026-11-22")).toBe(true);
    expect(divisionFits(u16, "2014-05-01", "2026-11-22")).toBe(false);
    expect(divisionFits(u14, "2010-05-01", "2026-11-22")).toBe(false);
    expect(divisionFits({ minBirthYear: null, maxBirthYear: null, ageUnder: null, ageCutoff: null }, "2012-05-01", "2026-11-22")).toBeNull();
    expect(divisionFits({ minBirthYear: null, maxBirthYear: null, ageUnder: 14, ageCutoff: "2026-12-31" }, "2013-05-01", "2026-11-22")).toBe(true);
  });
  it("athlete age group from licence category or birth year", () => {
    expect(athleteAgeGroup("2021-03-01", 2026, "u6")).toBe("U6");
    expect(athleteAgeGroup("2013-03-01", 2026, null)).toBe("U14");
    expect(athleteAgeGroup(null, 2026, null)).toBeNull();
  });
  it("programme + division label", () => {
    expect(programShortName("EYBL 2026-27")).toBe("EYBL");
    expect(programShortName("Elite squad (2027)")).toBe("Elite squad");
    expect(programDivisionLabel("EYBL 2026-27", "U14")).toBe("EYBL U14");
    expect(programDivisionLabel("EYBL 2026-27", "EYBL U16")).toBe("EYBL U16");
    expect(seriesKey({ slug: "eybl-2027", name: "EYBL 2027-28" })).toBe(seriesKey({ slug: "eybl", name: "EYBL 2026-27" }));
    expect(seriesKey({ series: "Roster", name: "x" })).toBe("roster");
  });
  it("default package from the tournament count", () => {
    const pk = [{ id: "a", tournamentCount: 1 }, { id: "b", tournamentCount: 2 }, { id: "c", tournamentCount: 3, isActive: false }];
    expect(packageForTournamentCount(pk, 2)?.id).toBe("b");
    expect(packageForTournamentCount(pk, 3)).toBeNull();
  });
});

describe("roster filters", () => {
  const rows = [
    { name: "Zoé Synthétique", divisionId: "d1", status: "enrolled", paymentStatus: "partial" as const, overdue: true, tournaments: [{ id: "t1", status: "covered" }] },
    { name: "Max Test", divisionId: "d2", status: "accepted", paymentStatus: "unpaid" as const, overdue: false, tournaments: [] },
    { name: "Old Player", divisionId: "d1", status: "withdrawn", paymentStatus: "paid" as const, overdue: false, tournaments: [] },
  ];
  it("defaults: active only", () => {
    const f = parseRosterFilters({});
    expect(rosterFiltersActive(f)).toBe(false);
    expect(filterRoster(rows, f).map((r) => r.name)).toEqual(["Zoé Synthétique", "Max Test"]);
  });
  it("withdrawn history, overdue, payment, search (accents ignored), tournaments", () => {
    expect(filterRoster(rows, parseRosterFilters({ status: "withdrawn" })).map((r) => r.name)).toEqual(["Old Player"]);
    expect(filterRoster(rows, parseRosterFilters({ overdue: "1" })).map((r) => r.name)).toEqual(["Zoé Synthétique"]);
    expect(filterRoster(rows, parseRosterFilters({ payment: "unpaid" })).map((r) => r.name)).toEqual(["Max Test"]);
    expect(filterRoster(rows, parseRosterFilters({ q: "zoe synth" })).map((r) => r.name)).toEqual(["Zoé Synthétique"]);
    expect(filterRoster(rows, parseRosterFilters({ tournament: "none" })).map((r) => r.name)).toEqual(["Max Test"]);
  });
  it("ignores invalid filter values", () => {
    const f = parseRosterFilters({ status: "bogus", payment: "x", division: "drop table" });
    expect(f).toMatchObject({ status: "active", payment: "all", division: "" });
  });
});
