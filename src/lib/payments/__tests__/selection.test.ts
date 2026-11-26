import { test } from "node:test";
import assert from "node:assert/strict";
import { countAllowed, monthlyFrom, normaliseCounts, packageDueDates, packageSchedule } from "../../selection/rules";

// Selection programme packages: per-package instalment rules (mirror of
// public.selection_plan_internal / selection_due_dates / plan_split).

test("package schedule: even splits and remainder on the last instalment", () => {
  assert.deepEqual(packageSchedule(4500, 4, "CHF", "2026-11-21").map((l) => l.amount), [1125, 1125, 1125, 1125]);
  assert.deepEqual(packageSchedule(4500, 10, "CHF", "2026-11-21").map((l) => l.amount), Array(10).fill(450));
  assert.deepEqual(packageSchedule(1500, 5, "CHF", "2026-11-21").map((l) => l.amount), [300, 300, 300, 300, 300]);
  assert.deepEqual(packageSchedule(100, 3, "CHF", "2026-11-21").map((l) => l.amount), [33.33, 33.33, 33.34]);
  // zero-decimal currency
  assert.deepEqual(packageSchedule(1000, 3, "JPY", "2026-11-21").map((l) => l.amount), [333, 333, 334]);
});

test("package schedule: monthly from the plan day, month-end clamping, leap years", () => {
  assert.deepEqual(packageDueDates("2026-11-21", 3), ["2026-11-21", "2026-12-21", "2027-01-21"]);
  assert.deepEqual(packageDueDates("2027-08-31", 3), ["2027-08-31", "2027-09-30", "2027-10-31"]);
  assert.deepEqual(packageDueDates("2028-01-30", 2), ["2028-01-30", "2028-02-29"]);
});

test("package rules: pay in full always allowed, fewer instalments allowed, outside the set refused", () => {
  assert.deepEqual(normaliseCounts([5, 4, 3, 2]), [1, 2, 3, 4, 5]);
  assert.equal(countAllowed({ allowedCounts: [1, 2, 3, 4, 5] }, 5), true);
  assert.equal(countAllowed({ allowedCounts: [1, 2, 3, 4, 5] }, 2), true);
  assert.equal(countAllowed({ allowedCounts: [1, 2, 3, 4, 5] }, 10), false);
  assert.deepEqual(monthlyFrom(4500, [1, 10], "CHF"), { amount: 450, count: 10 });
});
