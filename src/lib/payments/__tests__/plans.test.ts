import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocatePayments, autopayKey, cardExpiringSoon, chargeableOffSession, classifyOffSession, DEFAULT_PLAN_SETTINGS,
  instalmentStatus, monthDay, nextRetry, planDisplayStatus, planDueDates, planFee, planOffer, prorate, recurringPeriod,
  splitInstalments, todayIn, upcomingPeriods, addDays, type PlanSettings,
} from "../plans";

test("schedule: monthly on a day of month, month-end clamping", () => {
  assert.deepEqual(planDueDates({ today: "2026-01-15", count: 3, firstAtSignup: false, kind: "monthly", dayOfMonth: 31 }),
    ["2026-01-31", "2026-02-28", "2026-03-31"]);
  // leap year February
  assert.deepEqual(planDueDates({ today: "2028-01-31", count: 2, firstAtSignup: false, kind: "monthly", dayOfMonth: 30 }),
    ["2028-02-29", "2028-03-30"]);
  // day already passed this month -> next month; year rollover
  assert.deepEqual(planDueDates({ today: "2026-11-20", count: 3, firstAtSignup: false, kind: "monthly", dayOfMonth: 5 }),
    ["2026-12-05", "2027-01-05", "2027-02-05"]);
  // due today when the day is today
  assert.deepEqual(planDueDates({ today: "2026-05-05", count: 1, firstAtSignup: false, kind: "monthly", dayOfMonth: 5 }), ["2026-05-05"]);
  assert.equal(monthDay(2026, 12, 2, 31), "2027-02-28");
});

test("schedule: first payment at signup and custom dates", () => {
  assert.deepEqual(planDueDates({ today: "2026-01-15", count: 3, firstAtSignup: true, kind: "monthly", dayOfMonth: 15 }),
    ["2026-01-15", "2026-02-15", "2026-03-15"]);
  assert.deepEqual(planDueDates({ today: "2026-01-15", count: 2, firstAtSignup: false, kind: "custom", dayOfMonth: 1, customDates: ["2026-03-01", "2026-01-10", "2026-02-01"] }),
    ["2026-02-01", "2026-03-01"]);
  assert.deepEqual(planDueDates({ today: "2026-01-15", count: 2, firstAtSignup: true, kind: "custom", dayOfMonth: 1, customDates: ["2026-01-15", "2026-04-01"] }),
    ["2026-01-15", "2026-04-01"]);
  assert.equal(planDueDates({ today: "2026-01-15", count: 3, firstAtSignup: false, kind: "custom", dayOfMonth: 1, customDates: ["2026-02-01"] }), null);
  assert.equal(planDueDates({ today: "2026-01-15", count: 0, firstAtSignup: false, kind: "monthly", dayOfMonth: 1 }), null);
});

test("schedule: dates are calendar dates, unaffected by DST", () => {
  // Europe/Zurich switches to summer time on 2026-03-29 and back on 2026-10-25.
  assert.deepEqual(planDueDates({ today: "2026-03-28", count: 3, firstAtSignup: true, kind: "monthly", dayOfMonth: 28 }),
    ["2026-03-28", "2026-04-28", "2026-05-28"]);
  assert.equal(addDays("2026-03-28", 1), "2026-03-29");
  assert.equal(addDays("2026-10-24", 2), "2026-10-26");
  // 23:30 UTC on 28 March is already 29 March in Zurich; 22:30 UTC on 25 Oct is 23:30 local.
  assert.equal(todayIn("Europe/Zurich", new Date("2026-03-28T23:30:00Z")), "2026-03-29");
  assert.equal(todayIn("Europe/Zurich", new Date("2026-10-25T22:30:00Z")), "2026-10-25");
  assert.equal(todayIn("America/New_York", new Date("2026-03-08T04:30:00Z")), "2026-03-07");
  assert.equal(todayIn("Not/AZone", new Date("2026-01-02T10:00:00Z")), "2026-01-02");
});

test("amounts: minor units, remainder on the last instalment", () => {
  assert.deepEqual(splitInstalments(100, 3, "CHF"), [33.33, 33.33, 33.34]);
  assert.deepEqual(splitInstalments(1000, 7, "JPY"), [142, 142, 142, 142, 142, 142, 148]);
  assert.deepEqual(splitInstalments(0.05, 2, "EUR"), [0.02, 0.03]);
  assert.deepEqual(splitInstalments(10.005, 3, "KWD"), [3.335, 3.335, 3.335]);
  for (const [total, n] of [[1490, 4], [333.33, 6], [0.01, 3], [99999.99, 10]] as const) {
    const parts = splitInstalments(total, n, "CHF");
    assert.equal(Math.round(parts.reduce((s, x) => s + x, 0) * 100), Math.round(total * 100));
    assert.ok(parts.slice(0, -1).every((p) => p === parts[0]));
  }
  assert.throws(() => splitInstalments(-1, 2, "CHF"));
  assert.throws(() => splitInstalments(10, 0, "CHF"));
  assert.equal(planFee("percent", 2.5, 1000, "CHF"), 25);
  assert.equal(planFee("percent", 50, 1000, "CHF"), 200); // capped at 20 %
  assert.equal(planFee("fixed", 9.999, 1000, "CHF"), 10);
  assert.equal(planFee("none", 5, 1000, "CHF"), 0);
});

const settings = (over: Partial<PlanSettings> = {}): PlanSettings => ({
  ...DEFAULT_PLAN_SETTINGS, enabled: true, productTypes: ["camp", "season"], allowedCounts: [2, 3, 4], minAmount: 200,
  feeKind: "fixed", feeValue: 10, dayOfMonth: 1, ...over,
});

test("offer: club rules per product, minimum, camp deadline", () => {
  const base = { productType: "camp", balance: 900, currency: "CHF", today: "2026-03-10" };
  const o = planOffer(settings(), base);
  assert.equal(o.eligible, true);
  assert.deepEqual(o.options.map((x) => x.count), [2, 3, 4]);
  assert.deepEqual(o.options[1].amounts, [303.33, 303.33, 303.34]);
  assert.equal(o.options[1].total, 910);
  assert.deepEqual(o.options[1].dates, ["2026-04-01", "2026-05-01", "2026-06-01"]);
  // last instalment no later than 30 days before a camp starting 2026-06-15
  const d = planOffer(settings({ campLastDaysBefore: 30 }), { ...base, activityStart: "2026-06-15" });
  assert.deepEqual(d.options.map((x) => x.count), [2]);
  assert.equal(planOffer(settings(), { ...base, productType: "shop" }).eligible, false);
  assert.equal(planOffer(settings({ productTypes: ["invoice"] }), { ...base, productType: "shop" }).eligible, true);
  assert.deepEqual(planOffer(settings(), { ...base, balance: 150 }), { eligible: false, reason: "minimum", options: [] });
  assert.equal(planOffer(settings({ enabled: false }), base).eligible, false);
  assert.equal(planOffer(settings(), { ...base, hasPlan: true }).eligible, false);
});

test("allocation: earliest open instalment first, overpayment rolls forward", () => {
  assert.deepEqual(allocatePayments([340, 340, 340], 400, 1020, "CHF"), [
    { amountPaid: 340, status: "paid" }, { amountPaid: 60, status: "scheduled" }, { amountPaid: 0, status: "scheduled" },
  ]);
  assert.deepEqual(allocatePayments([340, 340, 340], 700, 1020, "CHF").map((a) => a.status), ["paid", "paid", "scheduled"]);
  assert.deepEqual(allocatePayments([340, 340, 340], 1100, 1020, "CHF").map((a) => a.status), ["paid", "paid", "paid"]);
  // paid in full after a credit note lowered the amount due
  assert.deepEqual(allocatePayments([340, 340, 340], 900, 900, "CHF").map((a) => a.status), ["paid", "paid", "paid"]);
  assert.deepEqual(allocatePayments([100, 100], -50, 200, "CHF").map((a) => a.amountPaid), [0, 0]);
});

test("display status", () => {
  const today = "2026-05-10";
  assert.equal(instalmentStatus({ status: "scheduled", dueDate: "2026-06-01", outstanding: 100 }, today), "upcoming");
  assert.equal(instalmentStatus({ status: "scheduled", dueDate: "2026-05-12", outstanding: 100 }, today), "due");
  assert.equal(instalmentStatus({ status: "scheduled", dueDate: "2026-05-10", outstanding: 100 }, today), "due");
  assert.equal(instalmentStatus({ status: "invoiced", dueDate: "2026-05-09", outstanding: 100 }, today), "overdue");
  assert.equal(instalmentStatus({ status: "paid", dueDate: "2026-05-09", outstanding: 0 }, today), "paid");
  assert.equal(instalmentStatus({ status: "cancelled", dueDate: "2026-05-09", outstanding: 0 }, today), "cancelled");
  assert.equal(instalmentStatus({ status: "skipped", dueDate: "2026-05-09", outstanding: 0 }, today), "skipped");
  assert.equal(planDisplayStatus("active", ["paid", "overdue"]), "overdue");
  assert.equal(planDisplayStatus("paused", ["overdue"]), "paused");
});

test("recurring periods and proration", () => {
  assert.deepEqual(recurringPeriod("2026-08-01", 1, "monthly", "2026-09-15"), { start: "2026-09-01", end: "2026-09-30" });
  assert.deepEqual(recurringPeriod("2026-08-01", 31, "monthly", "2026-09-15"), { start: "2026-08-31", end: "2026-09-29" });
  assert.deepEqual(recurringPeriod("2026-08-01", 1, "quarterly", "2026-12-20"), { start: "2026-11-01", end: "2027-01-31" });
  assert.deepEqual(recurringPeriod("2026-08-01", 15, "yearly", "2027-08-14"), { start: "2026-08-15", end: "2027-08-14" });
  assert.deepEqual(recurringPeriod("2026-08-01", 1, "monthly", "2026-07-01"), { start: "2026-08-01", end: "2026-08-31" });
  assert.equal(prorate(120, "2026-09-01", "2026-09-30", "2026-09-16", "daily", "CHF"), 60);
  assert.equal(prorate(100, "2026-02-01", "2026-02-28", "2026-02-15", "daily", "CHF"), 50);
  assert.equal(prorate(100, "2026-01-01", "2026-01-31", "2026-01-21", "daily", "CHF"), 35.48);
  assert.equal(prorate(120, "2026-09-01", "2026-09-30", "2026-09-16", "half_month", "CHF"), 60);
  assert.equal(prorate(120, "2026-09-01", "2026-09-30", "2026-09-15", "half_month", "CHF"), 120);
  assert.equal(prorate(120, "2026-09-01", "2026-09-30", "2026-09-16", "none", "CHF"), 120);
  assert.equal(prorate(120, "2026-09-01", "2026-09-30", "2026-08-20", "daily", "CHF"), 120);
  assert.equal(prorate(120, "2026-09-01", "2026-09-30", "2026-10-02", "daily", "CHF"), 0);
});

test("forecast: upcoming recurring periods", () => {
  const rows = upcomingPeriods({
    nextRunDate: "2026-09-01", endDate: "2026-11-30", amount: 120, currency: "CHF", startDate: "2026-09-16",
    template: { startDate: "2026-09-01", billingDay: 1, frequency: "monthly", proration: "daily" },
  }, "2026-09-01", "2027-06-30");
  assert.deepEqual(rows, [
    { periodStart: "2026-09-01", amount: 60 }, { periodStart: "2026-10-01", amount: 120 }, { periodStart: "2026-11-01", amount: 120 },
  ]);
  assert.deepEqual(upcomingPeriods({ nextRunDate: null, endDate: null, amount: 1, currency: "CHF", startDate: "2026-01-01" }, "2026-01-01", "2027-01-01"), []);
});

test("autopay: idempotency keys, retry schedule, classification", () => {
  assert.equal(autopayKey("abc", 2), "autopay:abc:2");
  assert.notEqual(autopayKey("abc", 1), autopayKey("abc", 2));
  assert.deepEqual(nextRetry({ firstOn: "2026-05-01", attempt: 1, retryDays: [3, 7], today: "2026-05-01" }), { fallback: false, next: "2026-05-04" });
  assert.deepEqual(nextRetry({ firstOn: "2026-05-01", attempt: 2, retryDays: [3, 7], today: "2026-05-04" }), { fallback: false, next: "2026-05-08" });
  assert.deepEqual(nextRetry({ firstOn: "2026-05-01", attempt: 3, retryDays: [3, 7], today: "2026-05-08" }), { fallback: true, next: null });
  assert.deepEqual(nextRetry({ firstOn: "2026-05-01", attempt: 1, retryDays: [3, 7], today: "2026-05-01", code: "expired_card" }), { fallback: true, next: null });
  // late run: never schedule in the past
  assert.deepEqual(nextRetry({ firstOn: "2026-05-01", attempt: 1, retryDays: [3, 7], today: "2026-05-06" }), { fallback: false, next: "2026-05-07" });
  assert.equal(classifyOffSession({ status: "succeeded" }), "succeeded");
  assert.equal(classifyOffSession({ code: "authentication_required" }), "requires_action");
  assert.equal(classifyOffSession({ status: "requires_action" }), "requires_action");
  assert.equal(classifyOffSession({ code: "card_declined", declineCode: "insufficient_funds" }), "failed");
  assert.equal(cardExpiringSoon(6, 2026, "2026-05-20"), true);
  assert.equal(cardExpiringSoon(7, 2026, "2026-05-20"), false);
  assert.equal(cardExpiringSoon(null, 2026, "2026-05-20"), false);
  assert.equal(chargeableOffSession("card"), true);
  assert.equal(chargeableOffSession("twint"), false);
});
