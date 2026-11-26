import { describe, expect, it } from "vitest";
import {
  adjustmentEffect,
  adjustmentTax,
  adjustmentsTotal,
  applicableCredit,
  checkAdjustment,
  creditBalance,
  draftTotals,
  invoiceMoney,
  lineAmount,
  netPaid,
  trainingCreditChange,
} from "@/lib/payments/adjustments";

describe("draft invoice totals", () => {
  it("matches update_draft_invoice: 3×120.10 + round(45.555) − 20.50 = 385.36", () => {
    const t = draftTotals(
      [
        { quantity: 3, unitPrice: 120.1 },
        { quantity: 1, unitPrice: 45.555 },
      ],
      20.5,
      "CHF",
    );
    expect(t).toEqual({ subtotal: 405.86, discount: 20.5, total: 385.36, valid: true });
  });

  it("has no float drift on 0.1 + 0.2 style sums", () => {
    expect(draftTotals([{ quantity: 1, unitPrice: 0.1 }, { quantity: 1, unitPrice: 0.2 }], 0, "CHF").total).toBe(0.3);
    expect(lineAmount(3, 0.1, "CHF")).toBe(0.3);
  });

  it("rounds fractional quantities once, in the currency's minor unit", () => {
    expect(lineAmount(1.5, 33.33, "CHF")).toBe(50);
    expect(lineAmount(2, 1000.4, "JPY")).toBe(2000);
    expect(lineAmount(1, 1.2345, "KWD")).toBe(1.235);
  });

  it("is invalid when the discount makes the total negative or a quantity is zero", () => {
    expect(draftTotals([{ quantity: 1, unitPrice: 10 }], 11, "CHF").valid).toBe(false);
    expect(draftTotals([{ quantity: 0, unitPrice: 10 }], 0, "CHF").valid).toBe(false);
    expect(draftTotals([], 0, "CHF").valid).toBe(false);
  });
});

describe("credit / debit notes", () => {
  const adjs = [
    { kind: "credit_note", amount: 200 },
    { kind: "debit_note", amount: 50 },
    { kind: "credit_note", amount: 99.99, voided: true },
  ];

  it("credit notes reduce, debit notes raise, voided ones are ignored", () => {
    expect(adjustmentEffect("credit_note", 10)).toBe(-10);
    expect(adjustmentEffect("write_off", 10)).toBe(-10);
    expect(adjustmentEffect("cancellation", 10)).toBe(-10);
    expect(adjustmentEffect("debit_note", 10)).toBe(10);
    expect(adjustmentsTotal(adjs, "CHF")).toBe(-150);
  });

  it("keeps the issued total and derives the amount due", () => {
    const m = invoiceMoney({ total: 1490, adjustmentsTotal: adjustmentsTotal(adjs, "CHF"), paid: 0, currency: "CHF" });
    expect(m.total).toBe(1490);
    expect(m.amountDue).toBe(1340);
    expect(m.outstanding).toBe(1340);
    expect(m.overpaid).toBe(0);
  });

  it("validates credit-note amounts like the RPC", () => {
    const unpaid = invoiceMoney({ total: 100, adjustmentsTotal: 0, paid: 0, currency: "CHF" });
    expect(checkAdjustment("credit_note", 20.004, unpaid, "CHF")).toEqual({ ok: true, amount: 20 });
    expect(checkAdjustment("credit_note", 100.01, unpaid, "CHF")).toEqual({ ok: false, code: "CREDIT_EXCEEDS_AMOUNT_DUE" });
    expect(checkAdjustment("credit_note", 100, unpaid, "CHF")).toEqual({ ok: false, code: "USE_CANCEL" });
    expect(checkAdjustment("credit_note", 0, unpaid, "CHF")).toEqual({ ok: false, code: "INVALID_AMOUNT" });
    expect(checkAdjustment("debit_note", 5000, unpaid, "CHF")).toEqual({ ok: true, amount: 5000 });

    // Crediting a paid invoice in full is allowed: the excess becomes an overpayment.
    const paid = invoiceMoney({ total: 100, adjustmentsTotal: 0, paid: 100, currency: "CHF" });
    expect(checkAdjustment("credit_note", 100, paid, "CHF")).toEqual({ ok: true, amount: 100 });
  });

  it("write-off always covers exactly the open balance", () => {
    const part = invoiceMoney({ total: 100, adjustmentsTotal: 0, paid: 60, currency: "CHF" });
    expect(checkAdjustment("write_off", 1, part, "CHF")).toEqual({ ok: true, amount: 40 });
    const settled = invoiceMoney({ total: 100, adjustmentsTotal: 0, paid: 100, currency: "CHF" });
    expect(checkAdjustment("write_off", 1, settled, "CHF")).toEqual({ ok: false, code: "NOTHING_TO_WRITE_OFF" });
  });

  it("extracts the VAT contained in a gross credit note", () => {
    expect(adjustmentTax(108.1, 8.1, "CHF")).toBe(8.1);
    expect(adjustmentTax(100, 0, "CHF")).toBe(0);
  });
});

describe("payments and overpayments", () => {
  const payments = [
    { amount: 1340, status: "succeeded" },
    { amount: 60, status: "succeeded" },
    { amount: -30, status: "succeeded" }, // reversal of a voided manual payment
    { amount: 30, status: "succeeded" },
    { amount: 25, status: "pending" },
    { amount: 10, status: "failed" },
  ];

  it("net paid follows invoice_net_paid (reversals count, pending/failed do not)", () => {
    expect(netPaid(payments, "CHF")).toBe(1400);
    expect(netPaid([{ amount: 100, status: "succeeded" }, { amount: -40, status: "partially_refunded" }], "CHF")).toBe(60);
  });

  it("flags an overpayment and the transfer to credit settles it", () => {
    const before = invoiceMoney({ total: 1490, adjustmentsTotal: -150, paid: 1400, currency: "CHF" });
    expect(before.overpaid).toBe(60);
    expect(before.outstanding).toBe(0);
    expect(before.balance).toBe(-60);
    // transfer_overpayment_to_credit appends a −60 row
    const after = invoiceMoney({ total: 1490, adjustmentsTotal: -150, paid: netPaid([...payments, { amount: -60, status: "succeeded" }], "CHF"), currency: "CHF" });
    expect(after.overpaid).toBe(0);
    expect(after.balance).toBe(0);
  });

  it("applies family credit up to the smaller of credit and open balance", () => {
    expect(applicableCredit(100, 60, "CHF")).toBe(60);
    expect(applicableCredit(40, 60, "CHF")).toBe(40);
    expect(applicableCredit(100, 60, "CHF", 25.555)).toBe(25.56);
    expect(applicableCredit(100, 60, "CHF", 80)).toBe(60);
    expect(applicableCredit(0, 60, "CHF")).toBe(0);
  });

  it("sums a family credit ledger per currency without float drift", () => {
    const ledger = [
      { amount: 60, currency: "CHF" },
      { amount: -59.9, currency: "CHF" },
      { amount: 0.1, currency: "chf" },
      { amount: 10, currency: "EUR" },
    ];
    expect(creditBalance(ledger, "CHF")).toBe(0.2);
    expect(creditBalance(ledger, "EUR")).toBe(10);
  });
});

describe("training credit changes", () => {
  it("grants, revokes and sets totals but never below the credits used", () => {
    expect(trainingCreditChange({ total: 2, used: 1 }, { delta: 3 })).toEqual({ ok: true, delta: 3, total: 5, balance: 4 });
    expect(trainingCreditChange({ total: 5, used: 1 }, { newTotal: 1 })).toEqual({ ok: true, delta: -4, total: 1, balance: 0 });
    expect(trainingCreditChange({ total: 5, used: 1 }, { newTotal: 0 })).toEqual({ ok: false, code: "BELOW_USED" });
    expect(trainingCreditChange({ total: 5, used: 1 }, { delta: 0 })).toEqual({ ok: false, code: "NO_CHANGE" });
    expect(trainingCreditChange({ total: 5, used: 1 }, {})).toEqual({ ok: false, code: "INVALID_CREDITS" });
    expect(trainingCreditChange({ total: 5, used: 1 }, { delta: 1, newTotal: 2 })).toEqual({ ok: false, code: "INVALID_CREDITS" });
  });
});
