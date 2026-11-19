/**
 * Instalment plans, recurring fees and autopay — pure logic (client-safe, no
 * server imports). Mirrors the SQL of migration 20250420101000:
 *   planDueDates        <-> public.plan_due_dates
 *   splitInstalments    <-> public.plan_split          (remainder on the LAST one)
 *   planFee             <-> public.plan_fee
 *   allocatePayments    <-> public.refresh_installment_status (earliest first, roll forward)
 *   recurringPeriod     <-> public.recurring_period_bounds
 *   prorate             <-> public.recurring_prorate
 *   nextRetry           <-> public.autopay_charge_result (retry schedule)
 *   autopayKey          <-> public.autopay_begin_charge (idempotency key)
 * All dates are ISO calendar dates (YYYY-MM-DD) computed in UTC, so daylight
 * saving changes never shift a due date; "today" for a club comes from
 * todayIn(timeZone).
 */
import { currencyExponent, fromMinorUnits, toMinorUnits } from "./currency";

export type ProductType = "season" | "camp" | "training_package" | "shop" | "invoice";
export const PRODUCT_TYPES: readonly ProductType[] = ["season", "camp", "training_package", "shop", "invoice"];
export const ALLOWED_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 24] as const;
export type FeeKind = "none" | "fixed" | "percent";
export type ScheduleKind = "monthly" | "custom";
export type Proration = "none" | "daily" | "half_month";
export type RecurringFrequency = "monthly" | "quarterly" | "yearly";

/** Club instalment rules (public.payment_plan_settings, camelCase). */
export type PlanSettings = {
  enabled: boolean;
  productTypes: ProductType[];
  allowedCounts: number[];
  minAmount: number;
  feeKind: FeeKind;
  feeValue: number;
  firstAtSignup: boolean;
  scheduleKind: ScheduleKind;
  dayOfMonth: number;
  customDates: string[];
  campLastDaysBefore: number | null;
  autopayEnabled: boolean;
  retryDays: number[];
  remindBeforeDays: number;
  overdueRepeatDays: number;
  mandateVersion: string;
};

export const DEFAULT_PLAN_SETTINGS: PlanSettings = {
  enabled: false, productTypes: [], allowedCounts: [2, 3, 4], minAmount: 0, feeKind: "none", feeValue: 0,
  firstAtSignup: false, scheduleKind: "monthly", dayOfMonth: 1, customDates: [], campLastDaysBefore: null,
  autopayEnabled: false, retryDays: [3, 7], remindBeforeDays: 3, overdueRepeatDays: 7, mandateVersion: "1",
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, "0");

export function parseDate(iso: string): { y: number; m: number; d: number } {
  const m = ISO.exec(iso);
  if (!m) throw new Error(`Invalid date (expected YYYY-MM-DD): ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}
const fmt = (t: Date) => `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
const utc = (iso: string) => { const { y, m, d } = parseDate(iso); return Date.UTC(y, m - 1, d); };

export function addDays(iso: string, days: number): string {
  return fmt(new Date(utc(iso) + days * 86_400_000));
}
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((utc(toIso) - utc(fromIso)) / 86_400_000);
}
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Day `day` of the month `add` months after (y, m), clamped to the month end. */
export function monthDay(y: number, m: number, add: number, day: number): string {
  const total = (m - 1) + add;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(Math.max(day, 1), daysInMonth(ny, nm)))}`;
}

/** The club's calendar date "now" in its time zone (DST-safe). */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

// ---------------------------------------------------------------------------
// Schedule + amounts
// ---------------------------------------------------------------------------
/**
 * Due dates for a new plan, or null when the schedule can't give `count` dates.
 * monthly: day D each month from the first day D on/after today (after today
 * when the first payment is taken at signup — that one is due today).
 * custom: the club's dates on/after today, ascending.
 */
export function planDueDates(opts: {
  today: string; count: number; firstAtSignup: boolean; kind: ScheduleKind; dayOfMonth: number; customDates?: string[];
}): string[] | null {
  const { today, count, firstAtSignup, kind, dayOfMonth } = opts;
  if (!Number.isInteger(count) || count < 1 || count > 60) return null;
  const out: string[] = firstAtSignup ? [today] : [];
  const rest = count - out.length;
  if (rest === 0) return out;
  if (kind === "custom") {
    const future = Array.from(new Set(opts.customDates ?? []))
      .filter((d) => ISO.test(d) && (d > today || (d === today && !firstAtSignup)))
      .sort();
    if (future.length < rest) return null;
    return [...out, ...future.slice(0, rest)];
  }
  const { y, m } = parseDate(today);
  const first = monthDay(y, m, 0, dayOfMonth);
  const add = first < today || (firstAtSignup && first === today) ? 1 : 0;
  for (let k = 0; k < rest; k++) out.push(monthDay(y, m, add + k, dayOfMonth));
  return out;
}

/** Splits `total` into `count` amounts in minor units; the remainder goes on the last one. */
export function splitInstalments(total: number, count: number, currency: string): number[] {
  if (!Number.isInteger(count) || count < 1 || count > 60) throw new Error("Instalment count must be 1–60");
  if (!Number.isFinite(total) || total < 0) throw new Error("Total must be a non-negative amount");
  const minor = toMinorUnits(total, currency);
  const base = Math.floor(minor / count);
  return Array.from({ length: count }, (_, k) => fromMinorUnits(k === count - 1 ? minor - base * (count - 1) : base, currency));
}

/** Instalment fee (fixed or % of the amount, max 20%), rounded to the minor unit. */
export function planFee(kind: FeeKind, value: number, amount: number, currency: string): number {
  if (kind === "fixed") return fromMinorUnits(toMinorUnits(Math.max(value, 0), currency), currency);
  if (kind === "percent") return fromMinorUnits(toMinorUnits(Math.max(amount, 0) * Math.min(Math.max(value, 0), 20) / 100, currency), currency);
  return 0;
}

export type PlanOption = { count: number; dates: string[]; amounts: number[]; fee: number; total: number };
export type PlanOffer =
  | { eligible: true; options: PlanOption[] }
  | { eligible: false; reason: "disabled" | "product" | "minimum" | "nothing_due" | "has_plan" | "no_schedule"; options: [] };

/**
 * Which instalment counts a payer may choose for an amount (UI preview; the
 * database re-checks the same rules in plan_choose_internal).
 */
export function planOffer(settings: PlanSettings, ctx: {
  productType: string; balance: number; currency: string; today: string; activityStart?: string | null; hasPlan?: boolean;
}): PlanOffer {
  const no = (reason: Extract<PlanOffer, { eligible: false }>["reason"]): PlanOffer => ({ eligible: false, reason, options: [] });
  if (!settings.enabled) return no("disabled");
  if (ctx.hasPlan) return no("has_plan");
  const type = ctx.productType as ProductType;
  if (!(settings.productTypes.includes(type) || settings.productTypes.includes("invoice"))) return no("product");
  if (!(ctx.balance > 0)) return no("nothing_due");
  if (ctx.balance < settings.minAmount) return no("minimum");
  void currencyExponent(ctx.currency);
  const deadline = type === "camp" && settings.campLastDaysBefore != null && ctx.activityStart
    ? addDays(ctx.activityStart, -settings.campLastDaysBefore) : null;
  const options: PlanOption[] = [];
  for (const count of [...settings.allowedCounts].sort((a, b) => a - b)) {
    const dates = planDueDates({ today: ctx.today, count, firstAtSignup: settings.firstAtSignup, kind: settings.scheduleKind, dayOfMonth: settings.dayOfMonth, customDates: settings.customDates });
    if (!dates) continue;
    if (deadline && dates[dates.length - 1] > deadline) continue;
    const fee = planFee(settings.feeKind, settings.feeValue, ctx.balance, ctx.currency);
    const total = fromMinorUnits(toMinorUnits(ctx.balance, ctx.currency) + toMinorUnits(fee, ctx.currency), ctx.currency);
    options.push({ count, dates, amounts: splitInstalments(total, count, ctx.currency), fee, total });
  }
  return options.length ? { eligible: true, options } : no("no_schedule");
}

// ---------------------------------------------------------------------------
// Allocation: payments go to the earliest open instalment; overpayment rolls forward
// ---------------------------------------------------------------------------
export type Allocation = { amountPaid: number; status: "paid" | "scheduled" };

export function allocatePayments(amounts: number[], paid: number, amountDue: number, currency: string): Allocation[] {
  let left = Math.max(toMinorUnits(paid, currency), 0);
  const fully = amountDue > 0 && toMinorUnits(paid, currency) >= toMinorUnits(amountDue, currency);
  return amounts.map((a) => {
    const amt = toMinorUnits(a, currency);
    const take = Math.min(left, amt);
    left -= take;
    const done = take >= amt || fully;
    return { amountPaid: fromMinorUnits(done ? amt : take, currency), status: done ? "paid" : "scheduled" };
  });
}

export type InstalmentStatus = "upcoming" | "due" | "paid" | "overdue" | "cancelled" | "skipped";

/** Status shown to people: stored status + due date + reminder window. */
export function instalmentStatus(row: { status: string; dueDate: string; outstanding: number }, today: string, dueWindowDays = 3): InstalmentStatus {
  if (row.status === "paid" || (row.outstanding <= 0 && row.status !== "cancelled" && row.status !== "skipped")) return "paid";
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "skipped") return "skipped";
  if (row.dueDate < today) return "overdue";
  if (row.dueDate <= addDays(today, dueWindowDays)) return "due";
  return "upcoming";
}

/** Plan status for lists: paused / cancelled / completed win; else overdue if any instalment is. */
export function planDisplayStatus(planStatus: string, rows: InstalmentStatus[]): "active" | "overdue" | "paused" | "completed" | "cancelled" {
  if (planStatus === "cancelled") return "cancelled";
  if (planStatus === "completed") return "completed";
  if (planStatus === "paused") return "paused";
  return rows.includes("overdue") ? "overdue" : "active";
}

// ---------------------------------------------------------------------------
// Recurring periods + proration
// ---------------------------------------------------------------------------
const MONTHS: Record<RecurringFrequency, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** Period containing `date` for a template starting `start` with billing day `day`. */
export function recurringPeriod(start: string, day: number, frequency: RecurringFrequency, date: string): { start: string; end: string } {
  const s = parseDate(start);
  const d = parseDate(date);
  const step = MONTHS[frequency] ?? 1;
  let k = Math.max(Math.floor(((d.y * 12 + d.m) - (s.y * 12 + s.m)) / step), 0);
  let ps = monthDay(s.y, s.m, k * step, day);
  while (ps > date && k > 0) { k -= 1; ps = monthDay(s.y, s.m, k * step, day); }
  return { start: ps, end: addDays(monthDay(s.y, s.m, (k + 1) * step, day), -1) };
}

/** First-period amount for someone joining on `join` (none / daily / half_month). */
export function prorate(amount: number, periodStart: string, periodEnd: string, join: string | null, rule: Proration, currency: string): number {
  const days = daysBetween(periodStart, periodEnd) + 1;
  if (!join || join <= periodStart || rule === "none" || days <= 0) return amount;
  if (join > periodEnd) return 0;
  const left = daysBetween(join, periodEnd) + 1;
  if (rule === "daily") return fromMinorUnits(toMinorUnits(amount * left / days, currency), currency);
  return left * 2 > days ? amount : fromMinorUnits(toMinorUnits(amount / 2, currency), currency);
}

/** Upcoming not-yet-invoiced periods of one enrolment in [from, until] (forecast feed). */
export function upcomingPeriods(e: {
  nextRunDate: string | null; endDate: string | null; amount: number; currency: string; startDate: string;
  template?: { startDate: string; billingDay: number; frequency: RecurringFrequency; proration: Proration } | null;
  frequency?: RecurringFrequency;
}, from: string, until: string, max = 36): { periodStart: string; amount: number }[] {
  const out: { periodStart: string; amount: number }[] = [];
  let p = e.nextRunDate;
  let guard = 0;
  while (p && p <= until && (!e.endDate || p <= e.endDate) && guard++ < max) {
    const end = e.template
      ? recurringPeriod(e.template.startDate, e.template.billingDay, e.template.frequency, p).end
      : addDays(monthDay(parseDate(p).y, parseDate(p).m, MONTHS[e.frequency ?? "monthly"], parseDate(p).d), -1);
    const amt = e.template ? prorate(e.amount, p, end, e.startDate, e.template.proration, e.currency) : e.amount;
    if (p >= from && amt > 0) out.push({ periodStart: p, amount: amt });
    p = addDays(end, 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Autopay
// ---------------------------------------------------------------------------
/** Idempotency key for one off-session attempt (Stripe + autopay_charges). */
export function autopayKey(installmentId: string, attempt: number): string {
  return `autopay:${installmentId}:${attempt}`;
}

const NO_RETRY = new Set(["expired_card", "lost_card", "stolen_card", "pickup_card"]);

/**
 * After a failed attempt (1-based within the current round): the next retry
 * date counted from the round's first attempt, or fallback (QR-bill + reminder)
 * when retries are exhausted or the card can't recover.
 */
export function nextRetry(opts: { firstOn: string; attempt: number; retryDays: number[]; today: string; code?: string | null }):
  { fallback: true; next: null } | { fallback: false; next: string } {
  if ((opts.code && NO_RETRY.has(opts.code)) || opts.attempt > opts.retryDays.length) return { fallback: true, next: null };
  let next = addDays(opts.firstOn, opts.retryDays[opts.attempt - 1]);
  if (next <= opts.today) next = addDays(opts.today, 1);
  return { fallback: false, next };
}

/** Classifies a Stripe off-session error / PaymentIntent status. */
export function classifyOffSession(input: { status?: string | null; code?: string | null; declineCode?: string | null }):
  "succeeded" | "processing" | "requires_action" | "failed" {
  if (input.status === "succeeded") return "succeeded";
  if (input.status === "processing") return "processing";
  if (input.status === "requires_action" || input.status === "requires_confirmation" || input.code === "authentication_required") return "requires_action";
  return "failed";
}

/** Card expires within the current or next month (notify before it fails). */
export function cardExpiringSoon(expMonth: number | null, expYear: number | null, today: string): boolean {
  if (!expMonth || !expYear) return false;
  const { y, m } = parseDate(today);
  return expYear * 12 + expMonth <= y * 12 + m + 1;
}

/** Methods that can be charged off-session. TWINT can't: every TWINT payment is approved in the app. */
export function chargeableOffSession(method: string): boolean {
  return method === "card";
}
