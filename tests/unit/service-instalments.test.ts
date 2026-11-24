import { describe, expect, it } from "vitest";
import {
  SERVICE_MAX_INSTALMENTS, firstDueDate, instalmentChoiceSchema, instalmentChoices, instalmentDatesError, instalmentSchedule,
  serviceInstalmentDates, serviceInstalmentSplit, toInstalmentRpc,
} from "@/lib/booking/instalments";
import { planDueDates, splitInstalments } from "@/lib/payments/plans";

/*
 * Service instalments: the TS mirror gives the same results as the SQL
 * (tests/db/service_instalments.sql, section A), and the club / EYBL helpers it
 * builds on are unchanged.
 */
describe("serviceInstalmentSplit (mirror of service_instalment_split)", () => {
  it.each([
    [450, 1, [450]],
    [450, 2, [225, 225]],
    [450, 3, [150, 150, 150]],
    [450, 4, [112.5, 112.5, 112.5, 112.5]],
    [550, 3, [183.33, 183.33, 183.34]],
    [100, 3, [33.33, 33.33, 33.34]],
    [275, 3, [91.66, 91.66, 91.68]],
    [95, 2, [47.5, 47.5]],
    [0.05, 4, [0.01, 0.01, 0.01, 0.02]],
  ])("%s in %s payments", (total, count, expected) => {
    expect(serviceInstalmentSplit(total, count, "CHF")).toEqual(expected);
  });

  it("always sums exactly to the total (in centimes)", () => {
    for (const total of [0.01, 1, 99.99, 100, 450, 550, 1280, 1234.57]) {
      for (let n = 1; n <= 4; n++) {
        const cents = serviceInstalmentSplit(total, n, "CHF").reduce((s, x) => s + Math.round(x * 100), 0);
        expect(cents).toBe(Math.round(total * 100));
      }
    }
  });

  it("refuses 0 and 5 payments", () => {
    expect(() => serviceInstalmentSplit(100, 0, "CHF")).toThrow("INSTALMENTS_OUT_OF_RANGE");
    expect(() => serviceInstalmentSplit(100, 5, "CHF")).toThrow("INSTALMENTS_OUT_OF_RANGE");
    expect(SERVICE_MAX_INSTALMENTS).toBe(4);
  });

  it("uses the currency minor unit (JPY has none)", () => {
    expect(serviceInstalmentSplit(1000, 3, "JPY")).toEqual([333, 333, 334]);
  });
});

describe("due dates", () => {
  it("first, then +1 month each, clamped to the month end (mirror of service_instalment_dates)", () => {
    expect(serviceInstalmentDates("2027-01-31", 4)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
    expect(serviceInstalmentDates("2026-12-15", 3)).toEqual(["2026-12-15", "2027-01-15", "2027-02-15"]);
  });
  it("first due date = today + the booking invoice term", () => {
    expect(firstDueDate("2026-11-24", 14)).toBe("2026-12-08");
    expect(firstDueDate("2026-11-24", null)).toBe("2026-11-24");
  });
  it("staff dates: ascending, from today, within 12 months (mirror of service_instalment_dates_error)", () => {
    const today = "2027-01-01";
    expect(instalmentDatesError(["2027-01-10", "2027-02-10"], 2, today)).toBeNull();
    expect(instalmentDatesError(["2027-02-10", "2027-01-10"], 2, today)).toBe("INSTALMENT_DATES_INVALID");
    expect(instalmentDatesError(["2027-01-10", "2027-01-10"], 2, today)).toBe("INSTALMENT_DATES_INVALID");
    expect(instalmentDatesError(["2026-12-31", "2027-01-10"], 2, today)).toBe("INSTALMENT_DATES_INVALID");
    expect(instalmentDatesError(["2027-01-10", "2028-01-02"], 2, today)).toBe("INSTALMENT_DATES_INVALID");
    expect(instalmentDatesError(["2027-01-10", "2028-01-01"], 2, today)).toBeNull();
    expect(instalmentDatesError(["2027-01-10"], 2, today)).toBe("INSTALMENT_DATES_INVALID");
  });
});

describe("schedule preview", () => {
  it("default dates", () => {
    expect(instalmentSchedule({ total: 550, count: 3, currency: "CHF", firstDue: "2026-12-08" })).toEqual([
      { seq: 1, dueDate: "2026-12-08", amount: 183.33 },
      { seq: 2, dueDate: "2027-01-08", amount: 183.33 },
      { seq: 3, dueDate: "2027-02-08", amount: 183.34 },
    ]);
  });
  it("custom dates when one per payment", () => {
    expect(instalmentSchedule({ total: 100, count: 2, currency: "CHF", firstDue: "2026-12-08", customDates: ["2026-12-01", "2027-03-01"] })
      .map((r) => r.dueDate)).toEqual(["2026-12-01", "2027-03-01"]);
  });
});

describe("choice", () => {
  it("offers 1..min(max, 4)", () => {
    expect(instalmentChoices(4)).toEqual([1, 2, 3, 4]);
    expect(instalmentChoices(1)).toEqual([1]);
    expect(instalmentChoices(9)).toEqual([1, 2, 3, 4]);
    expect(instalmentChoices(null)).toEqual([1]);
  });
  it("validates the payload", () => {
    expect(instalmentChoiceSchema.safeParse({ count: 5 }).success).toBe(false);
    expect(instalmentChoiceSchema.safeParse({ count: 2, dates: ["2027-01-01"] }).success).toBe(false);
    expect(instalmentChoiceSchema.parse({ count: 2, dates: [] })).toEqual({ count: 2, dates: null });
    expect(toInstalmentRpc(instalmentChoiceSchema.parse({ count: 1 }))).toEqual({ instalments: 1 });
    expect(toInstalmentRpc(instalmentChoiceSchema.parse({ count: 3, dates: ["2027-01-01", "2027-02-01", "2027-03-01"] })))
      .toEqual({ instalments: 3, instalment_dates: ["2027-01-01", "2027-02-01", "2027-03-01"] });
  });
});

describe("club / EYBL helpers are unchanged (regression)", () => {
  it("splitInstalments keeps the remainder on the last payment for any count", () => {
    expect(splitInstalments(1000, 3, "CHF")).toEqual([333.33, 333.33, 333.34]);
    expect(splitInstalments(1000, 12, "CHF")).toEqual([...Array(11).fill(83.33), 83.37]);
  });
  it("planDueDates keeps the club schedule", () => {
    expect(planDueDates({ today: "2026-01-15", count: 3, firstAtSignup: false, kind: "monthly", dayOfMonth: 1, customDates: [] }))
      .toEqual(["2026-02-01", "2026-03-01", "2026-04-01"]);
  });
});
