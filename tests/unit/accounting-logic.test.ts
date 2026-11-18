import { describe, expect, it } from "vitest";
import { matchCredit, matchCredits, namesOverlap, type OpenInvoice } from "@/lib/accounting/matching";
import { buildJournal, formatAmount, journalRows, toBexioCsv, trialBalance, type JournalSource, type Mapping } from "@/lib/accounting/journal";
import { DEFAULT_MAPPINGS, vatKey } from "@/lib/accounting/chart";
import { allowedResolutions, daysBetween, ibanLast4, isValidIban, quoteRefund, refundPercent, type RefundPolicy } from "@/lib/accounting/refunds";
import { DEFAULT_DUNNING, dunningDates, dunningFee, nextDunningLevel, validDunningSettings } from "@/lib/accounting/dunning";
import { computePrice, type DiscountDef } from "@/lib/pricing/discounts";

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------
const invoices: OpenInvoice[] = [
  { id: "i1", number: "INV-2026-0041", familyName: "Testeiro family", reference: "21 00000 00003 13947 14300 09017", currency: "CHF", balance: 1490 },
  { id: "i2", number: "INV-2026-0042", familyName: "Beispiel family", reference: "000000000000000000000012347", currency: "CHF", balance: 300 },
  { id: "i3", number: "INV-2026-0043", familyName: "Muster family", reference: "RF18539007547034", currency: "EUR", balance: 500, instalments: [125, 125, 250] },
  { id: "i4", number: "INV-2026-0044", familyName: "Other family", reference: null, currency: "CHF", balance: 300 },
];

describe("bank matching", () => {
  it("matches by structured reference first (spaces / case ignored)", () => {
    expect(matchCredit({ amount: 10, currency: "CHF", reference: "210000000003139471430009017", debtorName: null, remittance: null }, invoices))
      .toEqual({ invoiceId: "i1", kind: "reference", score: 100 });
    expect(matchCredit({ amount: 125, currency: "EUR", reference: "rf18 5390 0754 7034", debtorName: null, remittance: null }, invoices).invoiceId).toBe("i3");
  });
  it("does not match a reference in another currency", () => {
    expect(matchCredit({ amount: 1490, currency: "EUR", reference: "210000000003139471430009017", debtorName: null, remittance: null }, invoices).kind).toBe(null);
  });
  it("suggests by invoice number in the text", () => {
    expect(matchCredit({ amount: 300, currency: "CHF", reference: null, debtorName: "A. Beispiel", remittance: "Rechnung INV-2026-0042" }, invoices))
      .toMatchObject({ invoiceId: "i2", kind: "heuristic" });
  });
  it("suggests by amount + name, but not by amount alone when two invoices have that balance", () => {
    expect(matchCredit({ amount: 300, currency: "CHF", reference: null, debtorName: "BEISPIEL ANNA", remittance: null }, invoices).invoiceId).toBe("i2");
    expect(matchCredit({ amount: 300, currency: "CHF", reference: null, debtorName: "Someone Else", remittance: null }, invoices).invoiceId).toBe(null);
  });
  it("suggests an instalment amount with the family name", () => {
    expect(matchCredit({ amount: 125, currency: "EUR", reference: null, debtorName: "Max Muster", remittance: null }, invoices).invoiceId).toBe("i3");
  });
  it("one suggestion per invoice in a batch (best score wins)", () => {
    const r = matchCredits([
      { amount: 300, currency: "CHF", reference: null, debtorName: "Beispiel", remittance: null },
      { amount: 300, currency: "CHF", reference: null, debtorName: "Beispiel", remittance: "INV-2026-0042" },
    ], invoices);
    expect(r[0].invoiceId).toBe(null);
    expect(r[1].invoiceId).toBe("i2");
  });
  it("name tokens ignore accents, case and generic words", () => {
    expect(namesOverlap("Famille Müller", "MUELLER HANS")).toBe(false);
    expect(namesOverlap("Famille Müller", "muller hans")).toBe(true);
    expect(namesOverlap("Family", "family")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------
const mapping: Mapping = Object.fromEntries(DEFAULT_MAPPINGS.map((m) => [m.key, { account: m.account, vatCode: m.vatCode ?? null }]));
const range = { from: "2026-10-01", to: "2026-10-31" };
const src: JournalSource = {
  invoices: [
    { id: "a", number: "INV-1", date: "2026-10-02", status: "paid", total: 1490, tax_rate: 0, tax_amount: 0, currency: "CHF", family: "Testeiro", kind: "camp", description: "Camp" },
    { id: "b", number: "INV-2", date: "2026-10-05", status: "sent", total: 108.1, tax_rate: 8.1, tax_amount: 8.1, currency: "CHF", family: "Beispiel", kind: "shop", description: null },
    { id: "z", number: "INV-0", date: "2026-09-30", status: "sent", total: 99, tax_rate: 0, tax_amount: 0, currency: "CHF", family: null, kind: "other", description: null },
  ],
  adjustments: [
    { id: "c1", number: "INV-1-CN1", date: "2026-10-10", kind: "credit_note", amount: 200, tax_rate: 0, currency: "CHF", invoice_id: "a", invoice_number: "INV-1", family: "Testeiro", invoice_kind: "camp", reason: "refund:x", voided_on: null },
    { id: "d1", number: "INV-2-DN1", date: "2026-10-20", kind: "debit_note", amount: 20, tax_rate: 8.1, currency: "CHF", invoice_id: "b", invoice_number: "INV-2", family: "Beispiel", invoice_kind: "shop", reason: "dunning_fee:2", voided_on: null },
    { id: "w1", number: "INV-0-WO1", date: "2026-09-15", kind: "write_off", amount: 99, tax_rate: 0, currency: "CHF", invoice_id: "z", invoice_number: "INV-0", family: null, invoice_kind: "other", reason: "x", voided_on: "2026-10-25" },
  ],
  payments: [
    { id: "p1aaaaaa", date: "2026-10-03", amount: 1490, currency: "CHF", method: "qr_bill", method_detail: null, stripe: false, fee: null, invoice_id: "a", invoice_number: "INV-1", family: "Testeiro", reference: "21..." },
    { id: "p2bbbbbb", date: "2026-10-11", amount: -200, currency: "CHF", method: "manual", method_detail: "to_family_credit", stripe: false, fee: null, invoice_id: "a", invoice_number: "INV-1", family: "Testeiro", reference: null },
    { id: "p3cccccc", date: "2026-10-12", amount: 50, currency: "CHF", method: "card", method_detail: null, stripe: true, fee: 1.5, invoice_id: "b", invoice_number: "INV-2", family: "Beispiel", reference: null },
  ],
  expenses: [
    { id: "e1eeeeeeeeee", date: "2026-10-15", amount: 300, currency: "CHF", category_id: null, category: "Hall rent", description: null, status: "paid", method: "bank_transfer", supplier: "City" },
    { id: "e2ffffffffff", date: "2026-10-16", amount: 40, currency: "CHF", category_id: "11111111-1111-4111-8111-111111111111", category: "Balls", description: null, status: "unpaid", method: "bank_transfer", supplier: null },
  ],
};

describe("journal", () => {
  const j = buildJournal(src, { ...mapping, "expense.11111111-1111-4111-8111-111111111111": { account: "4000", vatCode: null } }, range);
  const byDoc = (d: string) => j.lines.filter((l) => l.docNo === d);

  it("books invoices, notes, payments, fees and expenses on the mapped accounts", () => {
    expect(byDoc("INV-1")[0]).toMatchObject({ debit: "1100", credit: "3400", amount: 1490, vatCode: null });
    expect(byDoc("INV-2")[0]).toMatchObject({ debit: "1100", credit: "3200", amount: 108.1, vatCode: "UN81" });
    expect(byDoc("INV-1-CN1")[0]).toMatchObject({ debit: "3400", credit: "1100", amount: 200 });
    expect(byDoc("INV-2-DN1")[0]).toMatchObject({ debit: "1100", credit: "3610", vatCode: null });
    expect(j.lines.find((l) => l.sourceId === "p1aaaaaa")).toMatchObject({ debit: "1020", credit: "1100", amount: 1490 });
    // negative payment to family credit: receivables / family credit liability
    expect(j.lines.find((l) => l.sourceId === "p2bbbbbb")).toMatchObject({ debit: "1100", credit: "2030", amount: 200, kind: "refund" });
    expect(j.lines.filter((l) => l.sourceId === "p3cccccc").map((l) => [l.debit, l.credit, l.amount]))
      .toEqual([["1090", "1100", 50], ["6840", "1090", 1.5]]);
    expect(j.lines.find((l) => l.sourceId === "e1eeeeeeeeee")).toMatchObject({ debit: "6500", credit: "1020" });
    expect(j.lines.find((l) => l.sourceId === "e2ffffffffff")).toMatchObject({ debit: "4000", credit: "2000" });
  });

  it("keeps the period: out-of-range records skipped, a void in range reverses", () => {
    expect(byDoc("INV-0")).toHaveLength(0);
    expect(byDoc("INV-0-WO1")).toEqual([expect.objectContaining({ kind: "adjustment_void", debit: "1100", credit: "3805", date: "2026-10-25" })]);
  });

  it("balances: debit = credit, account balances sum to zero, receivables of a settled invoice net out", () => {
    const tb = trialBalance(j.lines).get("CHF")!;
    expect(tb.debit).toBe(tb.credit);
    const sum = Array.from(tb.accounts.values()).reduce((s, v) => s + Math.round(v * 100), 0);
    expect(sum).toBe(0);
    // INV-1: 1490 issued, 200 credit, 1490 paid, 200 to family credit -> receivables 0 for this invoice
    const inv1 = buildJournal({ ...src, invoices: [src.invoices[0]], adjustments: [src.adjustments[0]], payments: src.payments.slice(0, 2), expenses: [] }, mapping, range);
    expect(trialBalance(inv1.lines).get("CHF")!.accounts.get("1100")).toBe(0);
  });

  it("reports unmapped keys instead of inventing accounts", () => {
    const partial = buildJournal(src, { receivables: { account: "1100", vatCode: null } }, range);
    expect(partial.issues.map((i) => i.key)).toEqual(expect.arrayContaining(["income.camp", "bank", "expense.default"]));
    expect(partial.lines.some((l) => l.debit === "" || l.credit === "")).toBe(true);
  });

  it("exports Bexio CSV (semicolon, CH dates, BOM) and generic rows", () => {
    const csv = toBexioCsv(j.lines.slice(0, 1));
    expect(csv.startsWith("﻿Datum;Beleg;Soll;Haben;Betrag;Währung;MWST-Code;Buchungstext\r\n")).toBe(true);
    expect(csv).toContain("02.10.2026;INV-1;1100;3400;1490.00;CHF;;");
    expect(journalRows(j.lines.slice(0, 1))[0].slice(0, 6)).toEqual(["2026-10-02", "INV-1", "1100", "3400", "1490.00", "CHF"]);
    expect(toBexioCsv([{ ...j.lines[0], text: "=HYPERLINK(1)" }])).toContain("'=HYPERLINK(1)");
  });

  it("formats amounts in the currency's minor units", () => {
    expect(formatAmount(1490, "CHF")).toBe("1490.00");
    expect(formatAmount(0.1 + 0.2, "EUR")).toBe("0.30");
    expect(formatAmount(1500, "JPY")).toBe("1500");
    expect(vatKey(8.1)).toBe("vat.8.1");
    expect(vatKey("8.100")).toBe("vat.8.1");
    expect(vatKey(0)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Refund policy
// ---------------------------------------------------------------------------
const policy: RefundPolicy = { fullUntilDays: 30, partialPercent: 50, partialUntilDays: 14, medicalMode: "credit", medicalPercent: 100 };

describe("refund policy", () => {
  it("full / partial / none by days before the start", () => {
    expect(refundPercent(policy, 30, false)).toBe(100);
    expect(refundPercent(policy, 29, false)).toBe(50);
    expect(refundPercent(policy, 14, false)).toBe(50);
    expect(refundPercent(policy, 13, false)).toBe(0);
    expect(refundPercent(policy, -2, false)).toBe(0);
    expect(refundPercent(null, 100, false)).toBe(0);
    expect(refundPercent(policy, null, false)).toBe(0);
  });
  it("medical with certificate", () => {
    expect(refundPercent(policy, 1, true)).toBe(100);
    expect(refundPercent({ ...policy, medicalMode: "none" }, 1, true)).toBe(0);
    expect(allowedResolutions(policy, true, true)).toEqual(["family_credit"]);
    expect(allowedResolutions({ ...policy, medicalMode: "choice" }, true, false)).toEqual(["family_credit", "bank_refund"]);
  });
  it("computes credit note, payout and what is still owed (minor units)", () => {
    const paid = quoteRefund({ policy, startsOn: "2026-07-06", on: "2026-06-20", medical: false, base: 1490, amountDue: 1490, paid: 1490, currency: "CHF" });
    expect(paid).toMatchObject({ daysBefore: 16, percent: 50, refund: 745, payout: 745, stillOwed: 0, needsReview: false });
    const unpaid = quoteRefund({ policy, startsOn: "2026-07-06", on: "2026-06-20", medical: false, base: 1490, amountDue: 1490, paid: 0, currency: "CHF" });
    expect(unpaid).toMatchObject({ refund: 745, payout: 0, stillOwed: 745 });
    const partly = quoteRefund({ policy, startsOn: "2026-07-06", on: "2026-06-20", medical: false, base: 1490, amountDue: 1490, paid: 1000, currency: "CHF" });
    expect(partly).toMatchObject({ payout: 255, stillOwed: 0 });
    const odd = quoteRefund({ policy: { ...policy, partialPercent: 33 }, startsOn: "2026-07-06", on: "2026-06-20", medical: false, base: 99.99, amountDue: 99.99, paid: 99.99, currency: "CHF" });
    expect(odd.refund).toBe(33);
    expect(quoteRefund({ policy, startsOn: null, on: "2026-06-20", medical: false, base: 10, amountDue: 10, paid: 10, currency: "CHF" }).needsReview).toBe(true);
  });
  it("counts calendar days across DST changes", () => {
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });
  it("validates IBANs (mod 97) and keeps only the last 4", () => {
    expect(isValidIban("CH93 0076 2011 6238 5295 7")).toBe(true);
    expect(isValidIban("CH93 0076 2011 6238 5295 8")).toBe(false);
    expect(isValidIban("DE89370400440532013000")).toBe(true);
    expect(isValidIban("nonsense")).toBe(false);
    expect(ibanLast4("CH93 0076 2011 6238 5295 7")).toBe("2957");
  });
});

// ---------------------------------------------------------------------------
// Dunning
// ---------------------------------------------------------------------------
describe("dunning schedule", () => {
  const s = { ...DEFAULT_DUNNING, enabled: true, level2Fee: 20, level3Fee: 30 };
  it("one level per run, thresholds from the due date", () => {
    expect(nextDunningLevel(s, 5, 0)).toBe(null);
    expect(nextDunningLevel(s, 10, 0)).toBe(1);
    expect(nextDunningLevel(s, 10, 1)).toBe(null);
    expect(nextDunningLevel(s, 30, 1)).toBe(2);
    expect(nextDunningLevel(s, 90, 0)).toBe(1); // friendly reminder first, even when very late
    expect(nextDunningLevel(s, 90, 2)).toBe(3);
    expect(nextDunningLevel(s, 79, 3)).toBe(null);
    expect(nextDunningLevel(s, 80, 3)).toBe(4);
    expect(nextDunningLevel(s, 200, 4)).toBe(null);
  });
  it("fees on levels 2 and 3 only; calendar preview; settings validation", () => {
    expect([1, 2, 3, 4].map((l) => dunningFee(s, l))).toEqual([0, 20, 30, 0]);
    expect(dunningDates(s, "2026-01-31").map((d) => d.date)).toEqual(["2026-02-10", "2026-03-02", "2026-03-22", "2026-04-21"]);
    expect(validDunningSettings(s)).toBe(true);
    expect(validDunningSettings({ ...s, level2Days: 5 })).toBe(false);
    expect(validDunningSettings({ ...s, level2Fee: -1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Family support in the shared discount model
// ---------------------------------------------------------------------------
describe("family_support discounts", () => {
  const support: DiscountDef = {
    id: "fs1", name: "Scholarship", kind: "percent", value: 50, currency: null, scope: "all", rule: "family_support",
    scopeFamilyId: "fam-1", maxAmount: 600, usedAmount: 500, supportReason: "scholarship", active: true,
  };
  const subject = { kind: "camp" as const, currency: "CHF", listAmount: 1490, familyId: "fam-1" };
  it("only applies where the caller opts in, for its own family, within the cap", () => {
    expect(computePrice(subject, [support], { now: new Date("2026-06-01") }).discountTotal).toBe(0);
    expect(computePrice({ ...subject, familyId: "fam-2" }, [support], { now: new Date("2026-06-01"), includeFamilySupport: true }).discountTotal).toBe(0);
    const q = computePrice(subject, [support], { now: new Date("2026-06-01"), includeFamilySupport: true });
    expect(q.discountTotal).toBe(100); // 745 capped at 600 - 500 already granted
    expect(computePrice(subject, [{ ...support, usedAmount: 600 }], { now: new Date("2026-06-01"), includeFamilySupport: true }).discountTotal).toBe(0);
    expect(computePrice(subject, [{ ...support, maxAmount: null }], { now: new Date("2026-06-01"), includeFamilySupport: true }).discountTotal).toBe(745);
  });
});
