import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currencyExponent, toMinorUnits, fromMinorUnits, formatMoney, normalizeCurrency, roundMoney,
} from "../currency";
import { computeTax, defaultTaxProfile } from "../tax";
import {
  availableMethods, supportedMethodsForCountry, regionForCountry, stripeMethodTypes, methodFromStripe,
  defaultCurrencyForCountry, defaultEnabledMethods, PAYMENT_METHOD_KEYS,
} from "../methods";
import { buildInstallmentSchedule, addPeriods } from "../schedule";
import { applicationFeeMinor, feeRuleForPlan } from "../fees";
import { buildEpcQrPayload } from "../epc-qr";
import { expressCapabilities, twintCapabilityEnabled, TWINT_CAPABILITY } from "../connect-capabilities";

test("currency minor units", () => {
  assert.equal(currencyExponent("chf"), 2);
  assert.equal(currencyExponent("JPY"), 0);
  assert.equal(currencyExponent("KWD"), 3);
  assert.equal(toMinorUnits(12.5, "CHF"), 1250);
  assert.equal(toMinorUnits(0.1 + 0.2, "EUR"), 30);
  assert.equal(toMinorUnits(1.005, "USD"), 101); // half away from zero after float snap
  assert.equal(toMinorUnits(-2.5, "JPY"), -3);
  assert.equal(toMinorUnits(1500, "JPY"), 1500);
  assert.equal(fromMinorUnits(1999, "CHF"), 19.99);
  assert.equal(fromMinorUnits(1234, "KWD"), 1.234);
  assert.equal(roundMoney(10.004, "EUR"), 10);
  assert.throws(() => normalizeCurrency("EURO"));
  assert.throws(() => fromMinorUnits(1.5, "CHF"));
  assert.match(formatMoney(1490, "CHF", "de-CH"), /1.490\.00/);
  assert.match(formatMoney(12, "USD", "en-US"), /^\$12\.00$/);
  assert.match(formatMoney(1500, "JPY", "ja-JP"), /1,500/);
});

test("tax: inclusive / exclusive / reverse charge", () => {
  assert.deepEqual(computeTax({ base: 108.1, rate: 8.1, inclusive: true, currency: "CHF" }),
    { net: 100, tax: 8.1, gross: 108.1, effectiveRate: 8.1 });
  assert.deepEqual(computeTax({ base: 100, rate: 19, inclusive: false, currency: "EUR" }),
    { net: 100, tax: 19, gross: 119, effectiveRate: 19 });
  assert.deepEqual(computeTax({ base: 100, rate: 21, inclusive: false, reverseCharge: true, currency: "EUR" }),
    { net: 100, tax: 0, gross: 100, effectiveRate: 0 });
  // net + tax always equals gross exactly
  for (const base of [0.01, 9.99, 33.33, 149.95, 1234.56]) {
    const t = computeTax({ base, rate: 7.7, inclusive: true, currency: "CHF" });
    assert.equal(toMinorUnits(t.net, "CHF") + toMinorUnits(t.tax, "CHF"), toMinorUnits(t.gross, "CHF"));
    assert.equal(t.gross, base);
  }
  assert.throws(() => computeTax({ base: 1, rate: 101, inclusive: true, currency: "CHF" }));
  assert.equal(defaultTaxProfile("CH", "fr").label, "TVA");
  assert.equal(defaultTaxProfile("CH", "de").label, "MWST");
  assert.equal(defaultTaxProfile("DE").standardRate, 19);
  assert.equal(defaultTaxProfile("US").label, "Sales tax");
  assert.equal(defaultTaxProfile("NL").applies, false);
});

test("method matrix per country", () => {
  assert.equal(regionForCountry("ch"), "CH");
  assert.equal(regionForCountry("LI"), "CH");
  assert.equal(regionForCountry("NL"), "EU");
  assert.equal(regionForCountry("US"), "US");
  assert.equal(regionForCountry("JP"), "INTL");
  assert.deepEqual(supportedMethodsForCountry("CH").slice(0, 4), ["card", "twint", "qr_bill", "bank_transfer"]);
  assert.ok(supportedMethodsForCountry("NL").includes("ideal"));
  assert.ok(!supportedMethodsForCountry("DE").includes("ideal"));
  assert.ok(supportedMethodsForCountry("BE").includes("bancontact"));
  assert.ok(supportedMethodsForCountry("US").includes("ach"));
  assert.ok(!supportedMethodsForCountry("US").includes("sepa_debit"));
  assert.equal(defaultCurrencyForCountry("FR"), "EUR");
  assert.equal(defaultCurrencyForCountry("CH"), "CHF");
  assert.equal(defaultCurrencyForCountry("US"), "USD");
  for (const cc of ["CH", "DE", "NL", "BE", "US", "GB"]) {
    for (const m of defaultEnabledMethods(cc)) assert.ok((PAYMENT_METHOD_KEYS as readonly string[]).includes(m));
  }
});

test("available methods honour config, currency and Stripe readiness", () => {
  const ch = availableMethods({
    country: "CH", currency: "CHF", stripeReady: true, twintOnline: true,
    enabled: ["card", "twint", "qr_bill", "bank_transfer"], iban: "CH93 0076 2011 6238 5295 7", qrIban: "CH44 3199 9123 0008 8901 2",
  });
  assert.deepEqual(ch.map((m) => `${m.key}:${m.via}`),
    ["card:stripe", "twint:stripe", "qr_bill:offline", "bank_transfer:offline", "apple_pay:stripe", "google_pay:stripe"]);
  assert.deepEqual(stripeMethodTypes(ch), ["card", "twint"]);

  // No Stripe: manual TWINT to the club number, still QR-bill/bank
  const chOffline = availableMethods({ country: "CH", currency: "CHF", stripeReady: false, twintNumber: "+41 79 000 00 00", iban: "CH93..." });
  assert.deepEqual(chOffline.map((m) => m.key), ["twint", "qr_bill", "bank_transfer", "manual"]);
  assert.ok(chOffline.every((m) => m.via === "offline"));

  // TWINT never offered for EUR invoices
  const chEur = availableMethods({ country: "CH", currency: "EUR", stripeReady: true, twintOnline: true, iban: "CH93..." });
  assert.ok(!chEur.some((m) => m.key === "twint"));

  const nl = availableMethods({ country: "NL", currency: "EUR", stripeReady: true, sepaEnabled: true, iban: "NL91ABNA0417164300" });
  assert.deepEqual(stripeMethodTypes(nl), ["card", "sepa_debit", "ideal"]);
  assert.ok(nl.find((m) => m.key === "sepa_debit")!.delayedSettlement);

  // SEPA debit needs the toggle
  const de = availableMethods({ country: "DE", currency: "EUR", stripeReady: true });
  assert.deepEqual(stripeMethodTypes(de), ["card"]);

  const us = availableMethods({ country: "US", currency: "USD", stripeReady: true, achEnabled: true });
  assert.deepEqual(stripeMethodTypes(us), ["card", "us_bank_account"]);
  const usNoAch = availableMethods({ country: "US", currency: "USD", stripeReady: true, enabled: ["card"] });
  assert.deepEqual(usNoAch.map((m) => m.key), ["card", "apple_pay", "google_pay"]);

  assert.equal(methodFromStripe("card", "apple_pay"), "apple_pay");
  assert.equal(methodFromStripe("us_bank_account"), "ach");
  assert.equal(methodFromStripe("twint"), "twint");
  assert.equal(methodFromStripe("unknown_rail"), "card");
});

test("installment schedule mirrors SQL", () => {
  const s = buildInstallmentSchedule({ total: 100, count: 3, startDate: "2026-01-31", frequency: "monthly", currency: "CHF" });
  assert.deepEqual(s, [
    { seq: 1, dueDate: "2026-01-31", amount: 33.34 },
    { seq: 2, dueDate: "2026-02-28", amount: 33.33 },
    { seq: 3, dueDate: "2026-03-31", amount: 33.33 },
  ]);
  const t = buildInstallmentSchedule({ total: 900, count: 3, startDate: "2026-09-01", frequency: "termly" });
  assert.deepEqual(t.map((i) => i.dueDate), ["2026-09-01", "2027-01-01", "2027-05-01"]);
  const jpy = buildInstallmentSchedule({ total: 1000, count: 7, startDate: "2026-01-01", currency: "JPY" });
  assert.equal(jpy.reduce((a, i) => a + i.amount, 0), 1000);
  assert.equal(addPeriods("2026-12-30", "weekly", 1), "2027-01-06");
  assert.equal(addPeriods("2024-02-29", "yearly", 1), "2025-02-28");
  assert.throws(() => buildInstallmentSchedule({ total: 10, count: 0, startDate: "2026-01-01" }));
});

test("application fee", () => {
  assert.equal(applicationFeeMinor(10_000, feeRuleForPlan("club")), 100);
  assert.equal(applicationFeeMinor(10_000, feeRuleForPlan("founding")), 0);
  assert.equal(applicationFeeMinor(999, { bps: 150 }), 14);
  assert.equal(applicationFeeMinor(50, { bps: 0, fixedMinor: 100 }), 50); // capped at amount
  assert.equal(applicationFeeMinor(10_000, feeRuleForPlan("unknown")), 100);
  assert.equal(applicationFeeMinor(10_000, feeRuleForPlan("club", 25)), 25);
});

test("EPC QR payload", () => {
  const p = buildEpcQrPayload({ name: "FC Beispiel e.V.", iban: "DE89 3704 0044 0532 0130 00", amountEur: 120, reference: "RF18 5390 0754 7034" });
  assert.equal(p, "BCD\n002\n1\nSCT\n\nFC Beispiel e.V.\nDE89370400440532013000\nEUR120.00\n\nRF18539007547034");
  const q = buildEpcQrPayload({ name: "Club", iban: "NL91ABNA0417164300", bic: "abnanl2a", amountEur: 9.5, text: "INV-2026-0001" });
  assert.equal(q.split("\n")[4], "ABNANL2A");
  assert.equal(q.split("\n").at(-1), "INV-2026-0001");
  assert.throws(() => buildEpcQrPayload({ name: "x", iban: "nope", amountEur: 1 }));
});

test("Express connected-account capabilities", () => {
  assert.equal(TWINT_CAPABILITY, "twint_payments");
  assert.deepEqual(Object.keys(expressCapabilities("CH")).sort(), ["card_payments", "transfers", "twint_payments"]);
  assert.deepEqual(expressCapabilities("ch").twint_payments, { requested: true });
  assert.deepEqual(Object.keys(expressCapabilities("DE")).sort(), ["card_payments", "transfers"]);
  assert.deepEqual(Object.keys(expressCapabilities("US")).sort(), ["card_payments", "transfers"]);
  assert.deepEqual(Object.keys(expressCapabilities("CH", { requestTwint: false })).sort(), ["card_payments", "transfers"]);
  assert.equal(twintCapabilityEnabled(undefined), true);
  assert.equal(twintCapabilityEnabled("true"), true);
  assert.equal(twintCapabilityEnabled("false"), false);
  assert.equal(twintCapabilityEnabled(" OFF "), false);
});

test("TWINT is offered online for CHF invoices of a connected CH club only", () => {
  const ctx = { country: "CH", stripeReady: true, twintOnline: true, enabled: ["card", "twint"] };
  assert.deepEqual(stripeMethodTypes(availableMethods({ ...ctx, currency: "CHF" })), ["card", "twint"]);
  assert.deepEqual(stripeMethodTypes(availableMethods({ ...ctx, currency: "EUR" })), ["card"]);
  assert.deepEqual(stripeMethodTypes(availableMethods({ ...ctx, currency: "CHF", twintOnline: false })), ["card"]);
});
