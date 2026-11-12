/**
 * Installment / recurring schedule generation — pure. Mirrors
 * public.installment_schedule() + public.plan_interval() so previews in the UI
 * match what the database creates.
 */
import { currencyExponent, fromMinorUnits, toMinorUnits } from "./currency";

export type PlanFrequency = "weekly" | "monthly" | "quarterly" | "termly" | "yearly";
export const PLAN_FREQUENCIES: readonly PlanFrequency[] = ["weekly", "monthly", "quarterly", "termly", "yearly"];

export type Installment = { seq: number; dueDate: string; amount: number };

const MONTHS: Record<Exclude<PlanFrequency, "weekly">, number> = { monthly: 1, quarterly: 3, termly: 4, yearly: 12 };

function parseISODate(iso: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Invalid date (expected YYYY-MM-DD): ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}
const pad = (n: number) => String(n).padStart(2, "0");
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** start + k periods, computed from the start (no drift); month ends clamp like Postgres. */
export function addPeriods(startISO: string, frequency: PlanFrequency, k: number, intervalCount = 1): string {
  const { y, m, d } = parseISODate(startISO);
  if (frequency === "weekly") {
    const t = new Date(Date.UTC(y, m - 1, d) + k * intervalCount * 7 * 86_400_000);
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }
  const total = (m - 1) + k * intervalCount * MONTHS[frequency];
  const ny = y + Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

/**
 * Splits `total` into `count` installments. Works in minor units; the
 * remainder goes one minor unit at a time to the earliest installments, so the
 * amounts always sum exactly to the total.
 */
export function buildInstallmentSchedule(opts: {
  total: number;
  count: number;
  startDate: string;
  frequency?: PlanFrequency;
  currency?: string;
  intervalCount?: number;
}): Installment[] {
  const { total, count, startDate, frequency = "monthly", currency = "CHF", intervalCount = 1 } = opts;
  if (!Number.isInteger(count) || count < 1 || count > 60) throw new Error("Installment count must be 1–60");
  if (!Number.isFinite(total) || total < 0) throw new Error("Total must be a non-negative amount");
  if (!PLAN_FREQUENCIES.includes(frequency)) throw new Error(`Invalid frequency: ${frequency}`);
  void currencyExponent(currency); // validates the currency code

  const minor = toMinorUnits(total, currency);
  const base = Math.floor(minor / count);
  const rem = minor - base * count;
  return Array.from({ length: count }, (_, k) => ({
    seq: k + 1,
    dueDate: addPeriods(startDate, frequency, k, intervalCount),
    amount: fromMinorUnits(base + (k < rem ? 1 : 0), currency),
  }));
}
