import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  clubInstallmentSchedule,
  clubSeasonBounds,
  defaultFirstDueMonth,
  membershipShares,
  seasonMonthsWithoutInstallment,
} from "@/lib/membership/schedule";
import { toMinorUnits } from "@/lib/payments/currency";

/**
 * Same fixtures as tests/db/billing_foundation.sql (section D), so the TS
 * mirror and public.club_installment_schedule() provably agree.
 */
type Fixture = {
  name: string;
  total: number;
  count: number;
  firstDueMonth: string;
  dueDay: number;
  seasonStart: string | null;
  seasonEnd: string | null;
  currency: string;
  installments?: [number, string, string][];
  monthsWithout?: string[];
  error?: string;
};
const fixtures = JSON.parse(
  readFileSync(path.resolve(__dirname, "fixtures/club-installment-schedule.json"), "utf8"),
) as Fixture[];

describe("club instalment schedule (shared SQL fixtures)", () => {
  it("has fixtures", () => expect(fixtures.length).toBeGreaterThan(5));

  for (const f of fixtures) {
    it(f.name, () => {
      const r = clubInstallmentSchedule({
        total: f.total, count: f.count, firstDueMonth: f.firstDueMonth, dueDay: f.dueDay, seasonEnd: f.seasonEnd, currency: f.currency,
      });
      if (f.error) {
        expect(r).toEqual({ ok: false, code: f.error });
        return;
      }
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // Same rows as SQL (amounts compared as the SQL text rendering).
      const decimals = f.currency === "JPY" ? 0 : 2;
      expect(r.installments.map((i) => [i.seq, i.dueOn, i.amount.toFixed(decimals)])).toEqual(f.installments);
      // Exact sum in minor units.
      const sum = r.installments.reduce((s, i) => s + toMinorUnits(i.amount, f.currency), 0);
      expect(sum).toBe(toMinorUnits(f.total, f.currency));
      expect(seasonMonthsWithoutInstallment(f.firstDueMonth, f.count, f.seasonStart, f.seasonEnd)).toEqual(f.monthsWithout);
    });
  }
});

describe("club season helpers", () => {
  it("season bounds follow the start month", () => {
    expect(clubSeasonBounds("2026-11-22", 8)).toEqual({ startsOn: "2026-08-01", endsOn: "2027-07-31" });
    expect(clubSeasonBounds("2027-07-31", 8)).toEqual({ startsOn: "2026-08-01", endsOn: "2027-07-31" });
    expect(clubSeasonBounds("2027-08-01", 8)).toEqual({ startsOn: "2027-08-01", endsOn: "2028-07-31" });
    expect(clubSeasonBounds("2026-03-01", 1)).toEqual({ startsOn: "2026-01-01", endsOn: "2026-12-31" });
    expect(clubSeasonBounds("2026-02-10", 3)).toEqual({ startsOn: "2025-03-01", endsOn: "2026-02-28" });
    expect(clubSeasonBounds("nope", 8)).toBeNull();
  });

  it("default first instalment month is on or after the season start", () => {
    expect(defaultFirstDueMonth("2026-08-01", 8)).toBe("2026-08-01");
    expect(defaultFirstDueMonth("2026-08-01", 9)).toBe("2026-09-01");
    expect(defaultFirstDueMonth("2026-08-01", 1)).toBe("2027-01-01");
  });
});

describe("membership payer shares (mirror of membership_plan_internal)", () => {
  it("fixed first, percent of the rest, last percent payer absorbs the centime", () => {
    expect(membershipShares(1500.01, [
      { shareKind: "fixed", shareValue: 300 },
      { shareKind: "percent", shareValue: 50 },
      { shareKind: "percent", shareValue: 50 },
    ])).toEqual({ ok: true, amounts: [300, 600.01, 600] });
  });

  it("percent thirds sum exactly", () => {
    const r = membershipShares(100, [
      { shareKind: "percent", shareValue: 33.33 },
      { shareKind: "percent", shareValue: 33.33 },
      { shareKind: "percent", shareValue: 33.34 },
    ]);
    expect(r).toEqual({ ok: true, amounts: [33.33, 33.33, 33.34] });
  });

  it("fixed shares must equal the fee", () => {
    expect(membershipShares(1000, [{ shareKind: "fixed", shareValue: 900 }])).toEqual({ ok: false, code: "SHARES_MISMATCH" });
    expect(membershipShares(1000, [{ shareKind: "fixed", shareValue: 600 }, { shareKind: "fixed", shareValue: 400 }]))
      .toEqual({ ok: true, amounts: [600, 400] });
  });

  it("percent shares must total 100", () => {
    expect(membershipShares(1000, [{ shareKind: "percent", shareValue: 60 }, { shareKind: "percent", shareValue: 30 }]))
      .toEqual({ ok: false, code: "SHARES_MISMATCH" });
  });

  it("validates shares and payers", () => {
    expect(membershipShares(1000, [])).toEqual({ ok: false, code: "PAYERS_REQUIRED" });
    expect(membershipShares(0, [])).toEqual({ ok: true, amounts: [] });
    expect(membershipShares(0, [{ shareKind: "percent", shareValue: 100 }])).toEqual({ ok: false, code: "SHARES_MISMATCH" });
    expect(membershipShares(1000, [{ shareKind: "percent", shareValue: 120 }])).toEqual({ ok: false, code: "INVALID_SHARE" });
    expect(membershipShares(1000, [{ shareKind: "fixed", shareValue: 1000 }, { shareKind: "percent", shareValue: 100 }]))
      .toEqual({ ok: false, code: "ZERO_SHARE" });
    expect(membershipShares(-1, [])).toEqual({ ok: false, code: "INVALID_AMOUNT" });
  });

  it("each payer's own schedule sums to the payer amount", () => {
    const shares = membershipShares(1500.01, [
      { shareKind: "fixed", shareValue: 300 },
      { shareKind: "percent", shareValue: 50 },
      { shareKind: "percent", shareValue: 50 },
    ]);
    expect(shares.ok).toBe(true);
    if (!shares.ok) return;
    for (const amount of shares.amounts) {
      const r = clubInstallmentSchedule({ total: amount, count: 11, firstDueMonth: "2027-08-01", dueDay: 28, seasonEnd: "2028-07-31" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.installments.reduce((s, i) => s + toMinorUnits(i.amount, "CHF"), 0)).toBe(toMinorUnits(amount, "CHF"));
    }
  });
});
