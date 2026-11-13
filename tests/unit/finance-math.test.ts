import { describe, expect, it } from "vitest";
import {
  computeCoachPayout, expensesByCategory, familyBalances, invoiceOutstanding, monthBounds, monthsBetween,
  paymentsRecorded, profitBy, profitTotals, projectedEarnings, reconciledEarnings, studentTrend, sumMoney,
  type ExpenseFact, type InvoiceFact, type PaymentFact,
} from "@/lib/finance/math";
import { expenseSchema, financeErrorKey, isReceiptPathFor, receiptObjectPath, sniffReceiptType } from "@/lib/finance/validation";

const R = { from: "2026-01-01", to: "2026-03-31" };
const inv = (o: Partial<InvoiceFact> & { id: string }): InvoiceFact => ({
  number: o.id.toUpperCase(), familyId: "f1", currency: "CHF", status: "pending", total: 100, adjustmentsTotal: 0,
  issuedDate: "2026-01-05", dueDate: "2026-02-01", programId: null, campEditionId: null, location: null, ...o,
});
const pay = (o: Partial<PaymentFact> & { id: string; amount: number }): PaymentFact => ({
  date: "2026-01-10", currency: "CHF", status: "succeeded", method: "bank_transfer", invoiceId: null, ...o,
});
const exp = (o: Partial<ExpenseFact> & { id: string; amount: number }): ExpenseFact => ({
  date: "2026-01-15", currency: "CHF", status: "paid", categoryId: "c1", programId: null, campEditionId: null, location: null, ...o,
});

describe("dates", () => {
  it("lists months and month bounds", () => {
    expect(monthsBetween({ from: "2025-11-20", to: "2026-02-03" })).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthBounds("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
  it("sums money without float drift", () => {
    expect(sumMoney([0.1, 0.2, 0.3], "CHF")).toBe(0.6);
  });
});

describe("payments recorded and reconciled earnings", () => {
  const payments = [
    pay({ id: "p1", amount: 100, invoiceId: "i1" }),
    pay({ id: "p2", amount: 50.05, method: "card", invoiceId: "i2", date: "2026-02-02" }),
    pay({ id: "p3", amount: 40, status: "pending", invoiceId: "i3" }),
    pay({ id: "p4", amount: -20, status: "refunded", invoiceId: "i2", date: "2026-02-10" }),
    pay({ id: "p5", amount: -100, isReversal: true, invoiceId: "i1", date: "2026-01-11" }),
    pay({ id: "p6", amount: 100, invoiceId: "i1", date: "2026-01-11" }),
    pay({ id: "p7", amount: 999, status: "failed" }),
    pay({ id: "p8", amount: 70, currency: "EUR" }),
    pay({ id: "p9", amount: 30, date: "2026-04-01" }),
  ];
  it("counts positive rows incl. pending, excluding failed / reversals / other currency / out of range", () => {
    const r = paymentsRecorded(payments, R, "CHF");
    expect(r.count).toBe(4);
    expect(r.amount).toBe(290.05);
    expect(r.pendingCount).toBe(1);
    expect(r.pendingAmount).toBe(40);
    expect(r.byMethod[0]).toEqual({ method: "bank_transfer", count: 3, amount: 240 });
  });
  it("reconciled = settled rows net of refunds and reversals", () => {
    const r = reconciledEarnings(payments, R, "CHF");
    expect(r.received).toBe(250.05);
    expect(r.refunded).toBe(20);
    expect(r.reversed).toBe(100);
    expect(r.amount).toBe(130.05);
  });
});

describe("expenses by category", () => {
  it("groups, tracks unpaid and shares", () => {
    const rows = expensesByCategory([
      exp({ id: "e1", amount: 300 }), exp({ id: "e2", amount: 100, status: "unpaid" }),
      exp({ id: "e3", amount: 100, categoryId: null }), exp({ id: "e4", amount: 50, currency: "EUR" }),
    ], R, "CHF");
    expect(rows).toEqual([
      { categoryId: "c1", count: 2, amount: 400, unpaid: 100, share: 0.8 },
      { categoryId: null, count: 1, amount: 100, unpaid: 0, share: 0.2 },
    ]);
  });
});

describe("profit", () => {
  const invoices = [inv({ id: "i1", programId: "pA", location: "Hall A" }), inv({ id: "i2", programId: "pB", campEditionId: "c1", location: "Hall B" })];
  const payments = [pay({ id: "p1", amount: 100, invoiceId: "i1" }), pay({ id: "p2", amount: 200, invoiceId: "i2", date: "2026-03-01" }), pay({ id: "p3", amount: -50, status: "refunded", invoiceId: "i2", date: "2026-03-05" })];
  const expenses = [exp({ id: "e1", amount: 80, programId: "pA", location: "Hall A" }), exp({ id: "e2", amount: 30.1, date: "2026-02-20" })];
  it("per month includes empty months and nets refunds", () => {
    const rows = profitBy("month", { payments, invoices, expenses }, R, "CHF");
    expect(rows.map((r) => [r.key, r.revenue, r.expenses, r.profit])).toEqual([
      ["2026-01", 100, 80, 20], ["2026-02", 0, 30.1, -30.1], ["2026-03", 150, 0, 150],
    ]);
    const t = profitTotals(rows, "CHF");
    expect(t.profit).toBe(139.9);
    expect(t.margin).toBeCloseTo(139.9 / 250);
  });
  it("per programme, camp edition and location (unassigned = null key)", () => {
    const byProgram = profitBy("program", { payments, invoices, expenses }, R, "CHF");
    expect(byProgram.find((r) => r.key === "pB")).toMatchObject({ revenue: 150, expenses: 0, profit: 150 });
    expect(byProgram.find((r) => r.key === "pA")).toMatchObject({ revenue: 100, expenses: 80, profit: 20 });
    expect(byProgram.find((r) => r.key === null)).toMatchObject({ revenue: 0, expenses: 30.1, profit: -30.1, margin: null });
    expect(profitBy("camp", { payments, invoices, expenses }, R, "CHF").find((r) => r.key === "c1")?.profit).toBe(150);
    expect(profitBy("location", { payments, invoices, expenses }, R, "CHF").find((r) => r.key === "Hall A")?.profit).toBe(20);
  });
});

describe("balances and projections", () => {
  it("open amount includes adjustments and never goes negative", () => {
    expect(invoiceOutstanding(inv({ id: "i", total: 100, adjustmentsTotal: -30 }), 50)).toBe(20);
    expect(invoiceOutstanding(inv({ id: "i", total: 100 }), 150)).toBe(0);
    expect(invoiceOutstanding(inv({ id: "i", status: "paid" }), 0)).toBe(0);
  });
  it("family balances: invoiced, paid, credits, outstanding", () => {
    const rows = familyBalances(
      [inv({ id: "i1", total: 200 }), inv({ id: "i2", total: 100, adjustmentsTotal: -100, status: "paid" }), inv({ id: "i3", status: "draft" }), inv({ id: "i4", familyId: "f2", total: 50 })],
      [pay({ id: "p1", amount: 120, invoiceId: "i1" }), pay({ id: "p2", amount: -20, status: "refunded", invoiceId: "i1" })],
      [{ familyId: "f1", amount: 25, currency: "CHF" }, { familyId: "f1", amount: -5, currency: "CHF" }],
    );
    expect(rows[0]).toEqual({ familyId: "f1", currency: "CHF", invoices: 2, invoiced: 200, paid: 100, credits: 20, outstanding: 100 });
    expect(rows[1]).toMatchObject({ familyId: "f2", outstanding: 50, paid: 0 });
  });
  it("projects open invoices by due month, overdue separately, plus upcoming bookings and camps", () => {
    const p = projectedEarnings({
      invoices: [
        inv({ id: "i1", dueDate: "2026-01-20", total: 100 }),
        inv({ id: "i2", dueDate: "2026-03-10", total: 300 }),
        inv({ id: "i3", dueDate: null, total: 40 }),
        inv({ id: "i4", dueDate: "2027-01-01", total: 999 }),
        inv({ id: "i5", dueDate: "2026-03-01", total: 80, status: "paid" }),
      ],
      payments: [pay({ id: "p1", amount: 100, invoiceId: "i2" })],
      upcoming: [
        { date: "2026-02-14", amount: 75, currency: "CHF", source: "training" },
        { date: "2026-03-30", amount: 490, currency: "CHF", source: "camp" },
        { date: "2026-01-01", amount: 75, currency: "CHF", source: "training" },
        { date: "2026-02-20", amount: 75, currency: "EUR", source: "training" },
      ],
    }, "2026-02-01", "2026-03-31", "CHF");
    expect(p.overdue).toBe(100);
    expect(p.rows).toEqual([
      { month: "2026-02", invoices: 40, training: 75, camps: 0, total: 115 },
      { month: "2026-03", invoices: 200, training: 0, camps: 490, total: 690 },
    ]);
    expect(p.total).toBe(905);
    expect(p.openInvoices).toBe(3);
  });
});

describe("coach payouts", () => {
  const act = { sessions: 3, sessionMinutes: 270, bookings: 2, bookingMinutes: 90 };
  it("per session pays every led session and completed booking", () => {
    expect(computeCoachPayout({ rateType: "per_session", amount: 80, currency: "CHF" }, act)).toEqual({ units: 5, minutes: 360, basis: "sessions", amount: 400 });
  });
  it("hourly pays scheduled minutes, rounded once", () => {
    expect(computeCoachPayout({ rateType: "hourly", amount: 45.5, currency: "CHF" }, { ...act, bookingMinutes: 95 })).toEqual({ units: 5, minutes: 365, basis: "minutes", amount: 276.79 });
  });
  it("hourly prefers clocked minutes from the staff module when present", () => {
    expect(computeCoachPayout({ rateType: "hourly", amount: 40, currency: "CHF" }, act, 450)).toMatchObject({ minutes: 450, basis: "clock", amount: 300 });
    expect(computeCoachPayout({ rateType: "hourly", amount: 40, currency: "CHF" }, act, 0)).toMatchObject({ basis: "minutes", amount: 240 });
  });
  it("zero-decimal currencies", () => {
    expect(computeCoachPayout({ rateType: "hourly", amount: 1000, currency: "JPY" }, { sessions: 1, sessionMinutes: 50, bookings: 0, bookingMinutes: 0 }).amount).toBe(833);
  });
});

describe("student trend", () => {
  it("counts athletes on the books at each month end", () => {
    const t = studentTrend([
      { createdDate: "2026-01-10", status: "active" }, { createdDate: "2026-02-03", status: "inactive" },
      { createdDate: "2026-02-28", status: "archived" }, { createdDate: "2026-03-01", status: "active" },
    ], ["2026-01", "2026-02", "2026-03"]);
    expect(t).toEqual([{ month: "2026-01", total: 1, active: 1 }, { month: "2026-02", total: 2, active: 1 }, { month: "2026-03", total: 3, active: 2 }]);
  });
});

describe("expense validation", () => {
  it("accepts a valid expense and normalises blanks", () => {
    const r = expenseSchema.safeParse({ date: "2026-02-01", amount: "120.50", currency: "chf", categoryId: "", method: "card", status: "paid", paidOn: "", description: "  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ amount: 120.5, currency: "CHF", categoryId: null, description: null, paidOn: null });
  });
  it("rejects a zero amount and a bad method with translated keys", () => {
    const r = expenseSchema.safeParse({ date: "2026-02-01", amount: 0, currency: "CHF", method: "card", status: "paid" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("finance.errors.amount");
    expect(expenseSchema.safeParse({ date: "2026-02-01", amount: 1, currency: "CHF", method: "barter", status: "paid" }).success).toBe(false);
  });
  it("maps database errors to keys", () => {
    expect(financeErrorKey("ALREADY_PAID")).toBe("finance.errors.alreadyPaid");
    expect(financeErrorKey('duplicate key value violates unique constraint "uq_expense_categories_name"')).toBe("finance.errors.duplicateName");
    expect(financeErrorKey("update or delete violates foreign key constraint")).toBe("finance.errors.inUse");
    expect(financeErrorKey("boom")).toBe("finance.errors.generic");
  });
  it("receipt keys and sniffing", () => {
    const p = receiptObjectPath("o", "e", "application/pdf", "r");
    expect(p).toBe("o/e/r.pdf");
    expect(isReceiptPathFor(p, "o", "e")).toBe(true);
    expect(isReceiptPathFor("x/e/r.pdf", "o", "e")).toBe(false);
    expect(sniffReceiptType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("application/pdf");
    expect(sniffReceiptType(new Uint8Array([0x00, 0x01]))).toBeNull();
  });
});
