/**
 * Player billing UI helpers — pure and client-safe (no I/O).
 *
 * Used by the player profile tabs, the club membership form, "Record a
 * payment" and the unallocated receipts worklist. All money arithmetic is in
 * minor units (centimes) so a receipt split over several invoices never
 * gains or loses a centime. The server (receipt_record / receipt_allocate /
 * membership_preview) re-validates everything; these helpers only give the
 * user immediate, exact feedback.
 */
import { BILLING_ACTIVITIES, type BillingActivity } from "@/lib/billing/activities";
import { fromMinorUnits, toMinorUnits } from "@/lib/payments/currency";

// ---------------------------------------------------------------------------
// Amount parsing
// ---------------------------------------------------------------------------

/**
 * Parse a typed amount ("1'250.50", "1 250,50", "90") into a number.
 * Returns null for empty input and NaN for something that is not an amount.
 */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : Number.NaN;
  let s = input.trim().replace(/[\s'’  ]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // Both separators: the last one is the decimal mark.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    s = s.replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return Number.NaN;
  return Number(s);
}

// ---------------------------------------------------------------------------
// Grouping by revenue category (never combined)
// ---------------------------------------------------------------------------

export type CategoryGroup<T> = { category: BillingActivity; items: T[] };

/**
 * Group items by revenue category, in the fixed category order (club
 * membership, selection, training, shop, camp, other). Unknown categories
 * fall under "other". Empty groups are left out; item order is kept.
 */
export function groupByCategory<T>(items: T[], categoryOf: (item: T) => string | null | undefined): CategoryGroup<T>[] {
  const map = new Map<BillingActivity, T[]>();
  for (const item of items) {
    const raw = categoryOf(item);
    const c: BillingActivity = (BILLING_ACTIVITIES as readonly string[]).includes(raw ?? "") ? (raw as BillingActivity) : "other";
    const arr = map.get(c) ?? [];
    arr.push(item);
    map.set(c, arr);
  }
  return BILLING_ACTIVITIES.filter((c) => map.has(c)).map((c) => ({ category: c, items: map.get(c)! }));
}

export type CategoryCurrencyTotal = { category: BillingActivity; currency: string; total: number; count: number };

/** Sum per category AND currency (two categories or two currencies are never added together). */
export function totalsByCategory<T>(
  items: T[],
  categoryOf: (item: T) => string | null | undefined,
  amountOf: (item: T) => number,
  currencyOf: (item: T) => string,
): CategoryCurrencyTotal[] {
  const out: CategoryCurrencyTotal[] = [];
  for (const g of groupByCategory(items, categoryOf)) {
    const byCur = new Map<string, { minor: number; count: number }>();
    for (const it of g.items) {
      const cur = (currencyOf(it) || "CHF").toUpperCase();
      const b = byCur.get(cur) ?? { minor: 0, count: 0 };
      b.minor += toMinorUnits(amountOf(it) || 0, cur);
      b.count += 1;
      byCur.set(cur, b);
    }
    for (const [currency, b] of Array.from(byCur.entries()).sort((x, y) => x[0].localeCompare(y[0]))) {
      out.push({ category: g.category, currency, total: fromMinorUnits(b.minor, currency), count: b.count });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Allocation of one received amount to several invoices
// ---------------------------------------------------------------------------

export type OpenInvoiceForAllocation = { id: string; currency: string; balance: number };
export type AllocationDraft = { invoiceId: string; amount: string | number };
export type AllocationRowError = "INVALID_AMOUNT" | "ALLOCATION_EXCEEDS_BALANCE" | "CURRENCY_MISMATCH" | "INVOICE_NOT_FOUND";
export type AllocationCheck = {
  /** Allocations to send (amount > 0 only), in the input order. */
  allocations: { invoiceId: string; amount: number }[];
  /** Per invoice id: what is wrong with that row. */
  rowErrors: Record<string, AllocationRowError>;
  /** Receipt-level error (nothing to book, or more allocated than received). */
  error: "INVALID_AMOUNT" | "ALLOCATION_EXCEEDS_RECEIPT" | "DUPLICATE_ALLOCATION" | null;
  allocated: number;
  unallocated: number;
  ok: boolean;
};

/**
 * Check what the user typed against the received amount and the open
 * balances. Empty / zero rows are ignored (not allocated); the remainder
 * stays unallocated on the receipt. `receiptAmount` is what is still free on
 * the receipt (for a new receipt: the whole amount).
 */
export function validateAllocations(input: {
  receiptAmount: number | string | null;
  currency: string;
  drafts: AllocationDraft[];
  invoices: OpenInvoiceForAllocation[];
}): AllocationCheck {
  const cur = (input.currency || "CHF").toUpperCase();
  const rowErrors: Record<string, AllocationRowError> = {};
  const allocations: { invoiceId: string; amount: number }[] = [];
  const received = parseAmount(input.receiptAmount);
  const receivedOk = received != null && Number.isFinite(received) && received > 0;
  const receivedMinor = receivedOk ? toMinorUnits(received!, cur) : 0;
  const byId = new Map(input.invoices.map((i) => [i.id, i]));
  const seen = new Set<string>();
  let duplicate = false;
  let sum = 0;
  for (const d of input.drafts) {
    const amount = parseAmount(d.amount);
    if (amount == null || amount === 0) continue;
    if (seen.has(d.invoiceId)) { duplicate = true; continue; }
    seen.add(d.invoiceId);
    const inv = byId.get(d.invoiceId);
    if (!inv) { rowErrors[d.invoiceId] = "INVOICE_NOT_FOUND"; continue; }
    if (!Number.isFinite(amount) || amount < 0) { rowErrors[d.invoiceId] = "INVALID_AMOUNT"; continue; }
    if (inv.currency.toUpperCase() !== cur) { rowErrors[d.invoiceId] = "CURRENCY_MISMATCH"; continue; }
    const minor = toMinorUnits(amount, cur);
    if (minor <= 0) { rowErrors[d.invoiceId] = "INVALID_AMOUNT"; continue; }
    if (minor > toMinorUnits(Math.max(inv.balance, 0), cur)) { rowErrors[d.invoiceId] = "ALLOCATION_EXCEEDS_BALANCE"; continue; }
    sum += minor;
    allocations.push({ invoiceId: d.invoiceId, amount: fromMinorUnits(minor, cur) });
  }
  let error: AllocationCheck["error"] = null;
  if (!receivedOk) error = "INVALID_AMOUNT";
  else if (duplicate) error = "DUPLICATE_ALLOCATION";
  else if (sum > receivedMinor) error = "ALLOCATION_EXCEEDS_RECEIPT";
  return {
    allocations,
    rowErrors,
    error,
    allocated: fromMinorUnits(sum, cur),
    unallocated: fromMinorUnits(Math.max(receivedMinor - sum, 0), cur),
    ok: error === null && Object.keys(rowErrors).length === 0,
  };
}

/**
 * Suggest allocations: fill the given invoices in order (oldest due first is
 * the caller's choice) until the received amount is used up.
 */
export function autoAllocate(receiptAmount: number, currency: string, invoices: OpenInvoiceForAllocation[]): { invoiceId: string; amount: number }[] {
  const cur = (currency || "CHF").toUpperCase();
  if (!Number.isFinite(receiptAmount) || receiptAmount <= 0) return [];
  let left = toMinorUnits(receiptAmount, cur);
  const out: { invoiceId: string; amount: number }[] = [];
  for (const inv of invoices) {
    if (left <= 0) break;
    if (inv.currency.toUpperCase() !== cur) continue;
    const bal = toMinorUnits(Math.max(inv.balance, 0), cur);
    if (bal <= 0) continue;
    const take = Math.min(bal, left);
    out.push({ invoiceId: inv.id, amount: fromMinorUnits(take, cur) });
    left -= take;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Which instalments an amount settles
// ---------------------------------------------------------------------------

export type InstallmentLite = { id: string; seq: number; dueDate: string; amount: number; amountPaid: number; status: string };
export type InstallmentCoverage = { id: string; seq: number; dueDate: string; covers: "full" | "partial"; amount: number };

/**
 * The open instalments an allocation pays, in due order (as the payment
 * engine applies money: oldest open instalment first). Paid, cancelled and
 * skipped instalments are left out.
 */
export function installmentsSettled(installments: InstallmentLite[], amount: number, currency: string): InstallmentCoverage[] {
  const cur = (currency || "CHF").toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0) return [];
  let left = toMinorUnits(amount, cur);
  const open = installments
    .filter((i) => !["paid", "cancelled", "skipped"].includes(i.status))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.seq - b.seq);
  const out: InstallmentCoverage[] = [];
  for (const i of open) {
    if (left <= 0) break;
    const due = Math.max(toMinorUnits(i.amount, cur) - toMinorUnits(i.amountPaid, cur), 0);
    if (due <= 0) continue;
    const take = Math.min(due, left);
    out.push({ id: i.id, seq: i.seq, dueDate: i.dueDate, covers: take === due ? "full" : "partial", amount: fromMinorUnits(take, cur) });
    left -= take;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Membership schedule display (preview: per payer -> per month)
// ---------------------------------------------------------------------------

export type PreviewPayer = { index: number; name: string | null; kind: string; amount: number; schedule: { seq: number; due_on: string; amount: number }[] };
export type ScheduleMonthRow = {
  /** First day of the month (YYYY-MM-01). */
  month: string;
  /** Due date in that month (null for a month without an instalment). */
  dueOn: string | null;
  /** Amount per payer index (0 when that payer has nothing that month). */
  perPayer: number[];
  total: number;
  noInstallment: boolean;
};
export type ScheduleDisplay = {
  rows: ScheduleMonthRow[];
  payerTotals: number[];
  total: number;
  /** True when the instalments add up exactly to the agreed fee (and each payer's to their share). */
  balanced: boolean;
};

/**
 * One row per month of the season: each payer's instalment that month, the
 * month total, and the months with no instalment shown explicitly (so a
 * 12-month season with 11 instalments shows the free month).
 */
export function scheduleDisplay(input: {
  payers: PreviewPayer[];
  monthsWithoutInstallment: string[];
  agreedFee: number;
  currency: string;
}): ScheduleDisplay {
  const cur = (input.currency || "CHF").toUpperCase();
  const n = input.payers.length;
  const rows = new Map<string, { dueOn: string | null; perPayer: number[]; noInstallment: boolean }>();
  const payerMinor = new Array<number>(n).fill(0);
  input.payers.forEach((p, idx) => {
    for (const s of p.schedule) {
      const month = `${s.due_on.slice(0, 7)}-01`;
      const row = rows.get(month) ?? { dueOn: s.due_on, perPayer: new Array<number>(n).fill(0), noInstallment: false };
      // perPayer holds minor units until the rows are built below.
      row.perPayer[idx] += toMinorUnits(s.amount, cur);
      row.dueOn = row.dueOn && row.dueOn < s.due_on ? row.dueOn : s.due_on;
      rows.set(month, row);
      payerMinor[idx] += toMinorUnits(s.amount, cur);
    }
  });
  for (const m of input.monthsWithoutInstallment) {
    const month = `${m.slice(0, 7)}-01`;
    if (!rows.has(month)) rows.set(month, { dueOn: null, perPayer: new Array<number>(n).fill(0), noInstallment: true });
  }
  const out: ScheduleMonthRow[] = Array.from(rows.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, r]) => {
      const totalMinor = r.perPayer.reduce((s, x) => s + x, 0);
      return {
        month, dueOn: r.dueOn, noInstallment: r.noInstallment,
        perPayer: r.perPayer.map((x) => fromMinorUnits(x, cur)),
        total: fromMinorUnits(totalMinor, cur),
      };
    });
  const totalMinor = payerMinor.reduce((s, x) => s + x, 0);
  const balanced = totalMinor === toMinorUnits(input.agreedFee, cur)
    && input.payers.every((p, idx) => payerMinor[idx] === toMinorUnits(p.amount, cur) || p.schedule.length === 0);
  return { rows: out, payerTotals: payerMinor.map((x) => fromMinorUnits(x, cur)), total: fromMinorUnits(totalMinor, cur), balanced };
}

/** "August 2026" in the viewer's locale for a YYYY-MM-DD date (calendar month, never shifted by time zones). */
export function monthLabel(isoDate: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(isoDate ?? "");
  if (!m) return isoDate ?? "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  try {
    return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  } catch {
    return `${m[1]}-${m[2]}`;
  }
}

// ---------------------------------------------------------------------------
// Payment status of an amount owed
// ---------------------------------------------------------------------------

export type MoneyStatus = "paid" | "partial" | "unpaid" | "none";

/** paid / partial / unpaid from what was invoiced and what is still open. */
export function moneyStatus(invoiced: number, balance: number, currency = "CHF"): MoneyStatus {
  const inv = toMinorUnits(Math.max(invoiced || 0, 0), currency);
  const bal = toMinorUnits(Math.max(balance || 0, 0), currency);
  if (inv === 0) return "none";
  if (bal === 0) return "paid";
  if (bal >= inv) return "unpaid";
  return "partial";
}

/** Membership list filters (URL params) — unknown values are ignored. */
export const MEMBERSHIP_PAYMENT_FILTERS = ["paid", "partial", "unpaid", "overdue"] as const;
export type MembershipPaymentFilter = (typeof MEMBERSHIP_PAYMENT_FILTERS)[number];
export const parsePaymentFilter = (v: unknown): MembershipPaymentFilter | null =>
  typeof v === "string" && (MEMBERSHIP_PAYMENT_FILTERS as readonly string[]).includes(v) ? (v as MembershipPaymentFilter) : null;

/** Does a membership row match a payment-status filter? */
export function matchesPaymentFilter(row: { status: MoneyStatus; overdue: boolean }, filter: MembershipPaymentFilter | null): boolean {
  if (!filter) return true;
  if (filter === "overdue") return row.overdue;
  return row.status === filter;
}

/**
 * Default first instalment month of a season (YYYY-MM-01): the configured
 * month in the season's first year, or the next year when that month falls
 * before the season start (as membership_plan_internal does).
 */
export function defaultFirstDueMonth(seasonStartsOn: string, firstMonth: number | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(seasonStartsOn ?? "");
  if (!m) return "";
  const y = Number(m[1]);
  const start = Number(m[2]);
  const month = firstMonth && firstMonth >= 1 && firstMonth <= 12 ? firstMonth : start;
  const year = month < start ? y + 1 : y;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export type PayerFormKind = "family" | "guardian" | "other_parent" | "sponsor" | "other";
export type PayerFormRow = {
  kind: PayerFormKind; profileId: string | null; name: string; email: string; shareKind: "fixed" | "percent"; shareValue: string;
};

/**
 * Map the form's payer rows to the membership RPC payload. "Other parent"
 * is a guardian share without a login (name + email); the server re-checks
 * that a chosen guardian belongs to the player's family.
 */
export function payersPayload(rows: PayerFormRow[], familyId: string | null) {
  return rows.map((r) => {
    const value = parseAmount(r.shareValue);
    const kind = r.kind === "other_parent" ? "guardian" : r.kind;
    return {
      kind: kind as "family" | "guardian" | "sponsor" | "other",
      profileId: r.kind === "guardian" ? r.profileId : null,
      familyId: r.kind === "family" ? familyId : null,
      name: r.kind === "family" || (r.kind === "guardian" && r.profileId) ? null : r.name.trim() || null,
      email: r.kind === "family" || (r.kind === "guardian" && r.profileId) ? null : r.email.trim() || null,
      shareKind: r.shareKind,
      shareValue: value != null && Number.isFinite(value) ? value : 0,
    };
  });
}

/** Profile tabs addressable with ?tab= (unknown values fall back to the first tab). */
export const PROFILE_TABS = ["overview", "teams", "membership", "selection", "bookings", "development", "attendance", "documents", "billing"] as const;
export type ProfileTabId = (typeof PROFILE_TABS)[number];
export const parseProfileTab = (v: unknown): ProfileTabId | null =>
  typeof v === "string" && (PROFILE_TABS as readonly string[]).includes(v) ? (v as ProfileTabId) : null;
