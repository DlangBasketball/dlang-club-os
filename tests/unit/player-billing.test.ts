import { describe, expect, it } from "vitest";
import {
  autoAllocate, defaultFirstDueMonth, groupByCategory, installmentsSettled, matchesPaymentFilter, monthLabel, moneyStatus,
  parseAmount, parsePaymentFilter, parseProfileTab, payersPayload, scheduleDisplay, totalsByCategory, validateAllocations,
} from "@/lib/billing/player-billing";
import { clubInstallmentSchedule } from "@/lib/membership/schedule";
import { newRequestId } from "@/lib/billing/request-id";

describe("parseAmount", () => {
  it("reads Swiss, German, French and plain notations", () => {
    expect(parseAmount("1'250.50")).toBe(1250.5);
    expect(parseAmount("1 250,50")).toBe(1250.5);
    expect(parseAmount("1.250,50")).toBe(1250.5);
    expect(parseAmount("1,250.50")).toBe(1250.5);
    expect(parseAmount("90")).toBe(90);
    expect(parseAmount(12.3)).toBe(12.3);
  });
  it("returns null for empty and NaN for junk", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("   ")).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount("abc")).toBeNaN();
    expect(parseAmount("1.2.3")).toBeNaN();
  });
});

describe("groupByCategory / totalsByCategory", () => {
  const items = [
    { id: "a", c: "selection", amount: 100, cur: "CHF" },
    { id: "b", c: "club_membership", amount: 90.91, cur: "CHF" },
    { id: "c", c: "club_membership", amount: 90.9, cur: "CHF" },
    { id: "d", c: "bogus", amount: 5, cur: "CHF" },
    { id: "e", c: "club_membership", amount: 10, cur: "EUR" },
  ];
  it("groups in the fixed category order, unknown under other, keeps item order", () => {
    const g = groupByCategory(items, (x) => x.c);
    expect(g.map((x) => x.category)).toEqual(["club_membership", "selection", "other"]);
    expect(g[0].items.map((x) => x.id)).toEqual(["b", "c", "e"]);
    expect(g[2].items.map((x) => x.id)).toEqual(["d"]);
  });
  it("never adds two categories or two currencies together", () => {
    const t = totalsByCategory(items, (x) => x.c, (x) => x.amount, (x) => x.cur);
    expect(t).toEqual([
      { category: "club_membership", currency: "CHF", total: 181.81, count: 2 },
      { category: "club_membership", currency: "EUR", total: 10, count: 1 },
      { category: "selection", currency: "CHF", total: 100, count: 1 },
      { category: "other", currency: "CHF", total: 5, count: 1 },
    ]);
  });
});

describe("validateAllocations", () => {
  const invoices = [
    { id: "club", currency: "CHF", balance: 90.91 },
    { id: "eybl", currency: "CHF", balance: 300 },
    { id: "eur", currency: "EUR", balance: 50 },
  ];
  it("splits one receipt over invoices of different categories; the rest stays unallocated", () => {
    const r = validateAllocations({ receiptAmount: "400", currency: "CHF", invoices, drafts: [{ invoiceId: "club", amount: "90.91" }, { invoiceId: "eybl", amount: "300" }] });
    expect(r.ok).toBe(true);
    expect(r.allocations).toEqual([{ invoiceId: "club", amount: 90.91 }, { invoiceId: "eybl", amount: 300 }]);
    expect(r.allocated).toBe(390.91);
    expect(r.unallocated).toBe(9.09);
  });
  it("ignores empty rows and allows nothing allocated", () => {
    const r = validateAllocations({ receiptAmount: 50, currency: "CHF", invoices, drafts: [{ invoiceId: "club", amount: "" }, { invoiceId: "eybl", amount: "0" }] });
    expect(r.ok).toBe(true);
    expect(r.allocations).toEqual([]);
    expect(r.unallocated).toBe(50);
  });
  it("flags more than the balance, another currency, unknown invoice", () => {
    const r = validateAllocations({ receiptAmount: 1000, currency: "CHF", invoices, drafts: [
      { invoiceId: "club", amount: "91" }, { invoiceId: "eur", amount: "10" }, { invoiceId: "nope", amount: "1" }, { invoiceId: "eybl", amount: "-5" },
    ] });
    expect(r.ok).toBe(false);
    expect(r.rowErrors).toEqual({ club: "ALLOCATION_EXCEEDS_BALANCE", eur: "CURRENCY_MISMATCH", nope: "INVOICE_NOT_FOUND", eybl: "INVALID_AMOUNT" });
    expect(r.allocations).toEqual([]);
  });
  it("refuses allocating more than received, a bad receipt amount and duplicates", () => {
    expect(validateAllocations({ receiptAmount: 100, currency: "CHF", invoices, drafts: [{ invoiceId: "eybl", amount: "100.01" }] }).error).toBe("ALLOCATION_EXCEEDS_RECEIPT");
    expect(validateAllocations({ receiptAmount: "", currency: "CHF", invoices, drafts: [] }).error).toBe("INVALID_AMOUNT");
    expect(validateAllocations({ receiptAmount: 0, currency: "CHF", invoices, drafts: [] }).error).toBe("INVALID_AMOUNT");
    expect(validateAllocations({ receiptAmount: 500, currency: "CHF", invoices, drafts: [{ invoiceId: "eybl", amount: 1 }, { invoiceId: "eybl", amount: 2 }] }).error).toBe("DUPLICATE_ALLOCATION");
  });
  it("is exact in centimes (no float drift)", () => {
    const r = validateAllocations({ receiptAmount: "0.3", currency: "CHF", invoices: [{ id: "x", currency: "CHF", balance: 0.1 }, { id: "y", currency: "CHF", balance: 0.2 }],
      drafts: [{ invoiceId: "x", amount: "0.1" }, { invoiceId: "y", amount: "0.2" }] });
    expect(r.ok).toBe(true);
    expect(r.unallocated).toBe(0);
  });
});

describe("autoAllocate", () => {
  it("fills in the given order until the amount is used; skips other currencies", () => {
    expect(autoAllocate(150, "CHF", [
      { id: "a", currency: "CHF", balance: 100 }, { id: "x", currency: "EUR", balance: 100 }, { id: "b", currency: "CHF", balance: 100 }, { id: "c", currency: "CHF", balance: 100 },
    ])).toEqual([{ invoiceId: "a", amount: 100 }, { invoiceId: "b", amount: 50 }]);
    expect(autoAllocate(0, "CHF", [{ id: "a", currency: "CHF", balance: 1 }])).toEqual([]);
  });
});

describe("installmentsSettled", () => {
  const inst = [
    { id: "i3", seq: 3, dueDate: "2026-10-28", amount: 90.91, amountPaid: 0, status: "scheduled" },
    { id: "i1", seq: 1, dueDate: "2026-08-28", amount: 90.91, amountPaid: 90.91, status: "paid" },
    { id: "i2", seq: 2, dueDate: "2026-09-28", amount: 90.91, amountPaid: 40, status: "scheduled" },
    { id: "i4", seq: 4, dueDate: "2026-11-28", amount: 90.91, amountPaid: 0, status: "cancelled" },
  ];
  it("pays the oldest open instalments first, partial last", () => {
    expect(installmentsSettled(inst, 100, "CHF")).toEqual([
      { id: "i2", seq: 2, dueDate: "2026-09-28", covers: "full", amount: 50.91 },
      { id: "i3", seq: 3, dueDate: "2026-10-28", covers: "partial", amount: 49.09 },
    ]);
  });
  it("nothing for zero or junk", () => {
    expect(installmentsSettled(inst, 0, "CHF")).toEqual([]);
    expect(installmentsSettled(inst, Number.NaN, "CHF")).toEqual([]);
  });
});

describe("scheduleDisplay", () => {
  const sched = (total: number) => {
    const r = clubInstallmentSchedule({ total, count: 11, firstDueMonth: "2026-08-01", dueDay: 28, seasonEnd: "2027-07-31" });
    if (!r.ok) throw new Error(r.code);
    return r.installments.map((x) => ({ seq: x.seq, due_on: x.dueOn, amount: x.amount }));
  };
  it("one row per season month, the free month explicit, totals exactly the fee", () => {
    const d = scheduleDisplay({
      payers: [{ index: 0, name: "Parent A", kind: "guardian", amount: 600, schedule: sched(600) }, { index: 1, name: "Sponsor", kind: "sponsor", amount: 400, schedule: sched(400) }],
      monthsWithoutInstallment: ["2027-07-01"], agreedFee: 1000, currency: "CHF",
    });
    expect(d.rows).toHaveLength(12);
    expect(d.rows[0]).toMatchObject({ month: "2026-08-01", dueOn: "2026-08-28", noInstallment: false });
    expect(d.rows[11]).toMatchObject({ month: "2027-07-01", dueOn: null, noInstallment: true, total: 0 });
    expect(d.payerTotals).toEqual([600, 400]);
    expect(d.total).toBe(1000);
    expect(d.balanced).toBe(true);
    // 1000 / 11: the remainder goes to the first instalments, per payer.
    expect(d.rows[0].perPayer).toEqual([54.55, 36.37]);
  });
  it("detects a schedule that does not add up", () => {
    const d = scheduleDisplay({ payers: [{ index: 0, name: null, kind: "family", amount: 999, schedule: sched(1000) }], monthsWithoutInstallment: [], agreedFee: 999, currency: "CHF" });
    expect(d.balanced).toBe(false);
  });
});

describe("small helpers", () => {
  it("moneyStatus", () => {
    expect(moneyStatus(100, 0)).toBe("paid");
    expect(moneyStatus(100, 100)).toBe("unpaid");
    expect(moneyStatus(100, 0.01)).toBe("partial");
    expect(moneyStatus(0, 0)).toBe("none");
  });
  it("payment filter", () => {
    expect(parsePaymentFilter("overdue")).toBe("overdue");
    expect(parsePaymentFilter("x")).toBeNull();
    expect(matchesPaymentFilter({ status: "partial", overdue: true }, "overdue")).toBe(true);
    expect(matchesPaymentFilter({ status: "partial", overdue: false }, "paid")).toBe(false);
    expect(matchesPaymentFilter({ status: "paid", overdue: false }, null)).toBe(true);
  });
  it("profile tab param", () => {
    expect(parseProfileTab("membership")).toBe("membership");
    expect(parseProfileTab("../etc")).toBeNull();
  });
  it("default first instalment month", () => {
    expect(defaultFirstDueMonth("2026-08-01", null)).toBe("2026-08-01");
    expect(defaultFirstDueMonth("2026-08-01", 9)).toBe("2026-09-01");
    expect(defaultFirstDueMonth("2026-08-01", 1)).toBe("2027-01-01");
    expect(defaultFirstDueMonth("bad", 8)).toBe("");
  });
  it("month label is the calendar month in the locale", () => {
    expect(monthLabel("2026-08-28", "en-US")).toBe("August 2026");
    expect(monthLabel("2027-01-01", "de-CH")).toBe("Januar 2027");
  });
  it("payers payload maps 'other parent' to a guardian share without login", () => {
    const p = payersPayload([
      { kind: "family", profileId: null, name: "x", email: "y", shareKind: "percent", shareValue: "60" },
      { kind: "other_parent", profileId: "ignored", name: " Parent B ", email: "b@example.org", shareKind: "percent", shareValue: "40" },
      { kind: "sponsor", profileId: null, name: "Club Sponsor", email: "", shareKind: "fixed", shareValue: "1'000" },
    ], "fam-1");
    expect(p).toEqual([
      { kind: "family", profileId: null, familyId: "fam-1", name: null, email: null, shareKind: "percent", shareValue: 60 },
      { kind: "guardian", profileId: null, familyId: null, name: "Parent B", email: "b@example.org", shareKind: "percent", shareValue: 40 },
      { kind: "sponsor", profileId: null, familyId: null, name: "Club Sponsor", email: null, shareKind: "fixed", shareValue: 1000 },
    ]);
  });
  it("request ids are v4 uuids, unique", () => {
    const a = newRequestId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newRequestId()).not.toBe(a);
  });
});
