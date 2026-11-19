import { z } from "zod";

/**
 * Validation for the finance module (expenses, lists, coach pay). Client-safe.
 * Issue messages are i18n keys under "finance.errors".
 */
export const EXPENSE_METHODS = ["bank_transfer", "card", "cash", "twint", "direct_debit", "other"] as const;
export type ExpenseMethod = (typeof EXPENSE_METHODS)[number];
export const EXPENSE_STATUSES = ["paid", "unpaid"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export const RATE_TYPES = ["hourly", "per_session"] as const;

export const RECEIPT_BUCKET = "expense-receipts";
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];
const RECEIPT_EXT: Record<ReceiptType, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "finance.errors.date").refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "finance.errors.date");
const optUuid = z.union([z.literal(""), z.null(), z.undefined(), z.string().uuid("finance.errors.invalidRequest")])
  .transform((v) => (v ? v : null));
const optText = (max: number) => z.union([z.null(), z.undefined(), z.string()])
  .transform((v) => (v ?? "").trim())
  .refine((v) => v.length <= max, "finance.errors.tooLong")
  .transform((v) => (v ? v : null));

export const expenseSchema = z.object({
  date: dayKey,
  amount: z.coerce.number({ invalid_type_error: "finance.errors.amount" }).finite("finance.errors.amount").gt(0, "finance.errors.amount").max(10_000_000, "finance.errors.amount"),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "finance.errors.currency"),
  categoryId: optUuid,
  supplierId: optUuid,
  coachId: optUuid,
  programId: optUuid,
  campEditionId: optUuid,
  teamId: optUuid,
  venueId: optUuid,
  description: optText(1000),
  method: z.enum(EXPENSE_METHODS, { errorMap: () => ({ message: "finance.errors.method" }) }),
  status: z.enum(EXPENSE_STATUSES, { errorMap: () => ({ message: "finance.errors.invalidRequest" }) }),
  paidOn: z.union([z.literal(""), z.null(), z.undefined(), dayKey]).transform((v) => (v ? v : null)),
  recurringMonthly: z.boolean().default(false),
});
export type ExpenseInput = z.input<typeof expenseSchema>;
export type ExpenseValues = z.output<typeof expenseSchema>;

/** DB row for an expense (org / ids are set by the action). */
export function expenseRow(v: ExpenseValues) {
  return {
    expense_date: v.date, amount: v.amount, currency: v.currency, category_id: v.categoryId, supplier_id: v.supplierId,
    coach_id: v.coachId, program_id: v.programId, camp_edition_id: v.campEditionId, team_id: v.teamId, venue_id: v.venueId,
    description: v.description, payment_method: v.method, status: v.status,
    paid_on: v.status === "paid" ? v.paidOn ?? v.date : null,
    recurring_monthly: v.recurringMonthly,
  };
}

export const listItemSchema = z.object({
  name: z.string().trim().min(1, "finance.errors.nameRequired").max(120, "finance.errors.tooLong"),
  contact: optText(200),
  notes: optText(1000),
});
export const categoryNameSchema = z.string().trim().min(1, "finance.errors.nameRequired").max(80, "finance.errors.tooLong");

export const rateSchema = z.object({
  coachId: z.string().uuid("finance.errors.invalidRequest"),
  rateType: z.enum(RATE_TYPES, { errorMap: () => ({ message: "finance.errors.invalidRequest" }) }),
  amount: z.coerce.number().finite("finance.errors.amount").min(0, "finance.errors.amount").max(100_000, "finance.errors.amount"),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "finance.errors.currency"),
  notes: optText(500),
});

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "finance.errors.month");
export const reasonSchema = z.string().trim().min(1, "finance.errors.reasonRequired").max(500, "finance.errors.tooLong");

export function firstIssueKey(err: z.ZodError): string {
  const m = err.issues[0]?.message ?? "";
  return m.startsWith("finance.errors.") ? m : "finance.errors.invalidRequest";
}

/** Database / RPC error -> i18n key. */
export function financeErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  const codes: [RegExp, string][] = [
    [/NOT_AUTHORIZED|row-level security|permission denied/i, "finance.errors.notPermitted"],
    [/CROSS_ORG_REFERENCE|COACH_NOT_FOUND|PAYOUT_NOT_FOUND/, "finance.errors.notFound"],
    [/ALREADY_PAID/, "finance.errors.alreadyPaid"],
    [/ALREADY_VOIDED/, "finance.errors.alreadyVoided"],
    [/FUTURE_MONTH/, "finance.errors.futureMonth"],
    [/REASON_REQUIRED/, "finance.errors.reasonRequired"],
    [/INVALID_AMOUNT/, "finance.errors.amount"],
    [/INVALID_CURRENCY/, "finance.errors.currency"],
    [/uq_expense_categories_name|uq_expense_suppliers_name|duplicate key/i, "finance.errors.duplicateName"],
    [/foreign key/i, "finance.errors.inUse"],
    [/check constraint/i, "finance.errors.invalidRequest"],
  ];
  for (const [re, key] of codes) if (re.test(m)) return key;
  return "finance.errors.generic";
}

/** Sniff the real type of an uploaded receipt from its first bytes. */
export function sniffReceiptType(b: Uint8Array): ReceiptType | null {
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

export function receiptObjectPath(orgId: string, expenseId: string, type: ReceiptType, rand: string): string {
  return `${orgId}/${expenseId}/${rand}.${RECEIPT_EXT[type]}`;
}

export function isReceiptPathFor(path: string | null | undefined, orgId: string, expenseId: string): boolean {
  return !!path && path.startsWith(`${orgId}/${expenseId}/`) && path.split("/").length === 3;
}

/** Original file name, trimmed to something safe to display / download. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/\u0000-\u001f"<>|:*?]+/g, "_").trim();
  return (cleaned || "receipt").slice(0, 200);
}
