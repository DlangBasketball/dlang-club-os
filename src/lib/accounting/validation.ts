import { z } from "zod";
import { ACCOUNT_NUMBER_RE, ACCOUNT_TYPES, VAT_CODE_RE, isMappingKey } from "./chart";
import { MEDICAL_MODES, PRODUCT_TYPES, RESOLUTIONS } from "./refunds";
import { SUPPORT_REASONS } from "@/lib/pricing/discounts";

/** Zod schemas for the accounting server actions (messages are i18n keys). */
const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "accounting.errors.invalidDate");
const money = z.coerce.number().finite().min(0).max(10_000_000);
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "accounting.errors.invalidCurrency");

export const accountSchema = z.object({
  number: z.string().trim().regex(ACCOUNT_NUMBER_RE, "accounting.errors.invalidAccount"),
  name: z.string().trim().min(1, "accounting.errors.nameRequired").max(120),
  type: z.enum(ACCOUNT_TYPES),
  isActive: z.boolean().default(true),
});

export const mappingSchema = z.array(z.object({
  key: z.string().refine(isMappingKey, "accounting.errors.invalidRequest"),
  account: z.string().trim().max(20).optional().nullable().transform((v) => (v ? v : null))
    .refine((v) => v === null || ACCOUNT_NUMBER_RE.test(v), "accounting.errors.invalidAccount"),
  vatCode: z.string().trim().max(20).optional().nullable().transform((v) => (v ? v : null))
    .refine((v) => v === null || VAT_CODE_RE.test(v), "accounting.errors.invalidVatCode"),
})).max(300);

export const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, "accounting.errors.invalidPeriod");
export const reasonSchema = z.string().trim().min(1, "accounting.errors.reasonRequired").max(500);

export const policySchema = z.object({
  productType: z.enum(PRODUCT_TYPES),
  fullUntilDays: z.coerce.number().int().min(0).max(730).nullable(),
  partialPercent: z.coerce.number().int().min(0).max(100),
  partialUntilDays: z.coerce.number().int().min(0).max(730).nullable(),
  medicalMode: z.enum(MEDICAL_MODES),
  medicalPercent: z.coerce.number().int().min(0).max(100),
  notes: optText(2000),
  isActive: z.boolean().default(true),
}).refine((p) => p.fullUntilDays === null || p.partialUntilDays === null || p.partialUntilDays <= p.fullUntilDays, {
  message: "accounting.errors.policyOrder",
});

export const refundCreateSchema = z.object({
  registrationId: uuid.optional().nullable(),
  bookingId: uuid.optional().nullable(),
  invoiceId: uuid.optional().nullable(),
  medical: z.boolean().default(false),
  reason: optText(1000),
  preference: z.enum(RESOLUTIONS).optional().nullable(),
  iban: optText(40),
  accountHolder: optText(140),
}).refine((v) => [v.registrationId, v.bookingId, v.invoiceId].filter(Boolean).length === 1, { message: "accounting.errors.invalidRequest" });

export const refundProcessSchema = z.object({
  requestId: uuid,
  resolution: z.enum(RESOLUTIONS),
  amount: money.optional().nullable(),
  overrideReason: optText(500),
});

export const dunningSchema = z.object({
  enabled: z.boolean(),
  level1Days: z.coerce.number().int().min(1).max(365),
  level2Days: z.coerce.number().int().min(1).max(365),
  level2Fee: money.max(10000),
  level3Days: z.coerce.number().int().min(1).max(365),
  level3Fee: money.max(10000),
  collectionDays: z.coerce.number().int().min(1).max(730),
  minBalance: money.max(100000),
}).refine((s) => s.level1Days < s.level2Days && s.level2Days < s.level3Days && s.level3Days < s.collectionDays, {
  message: "accounting.errors.dunningOrder",
});

export const pauseSchema = z.object({ familyId: uuid, until: day.optional().nullable(), reason: reasonSchema });

export const supportSchema = z.object({
  familyId: uuid,
  name: z.string().trim().min(1, "accounting.errors.nameRequired").max(120),
  reason: z.enum(SUPPORT_REASONS),
  kind: z.enum(["percent", "fixed_amount"]),
  value: z.coerce.number().positive().max(1_000_000),
  currency: currency.optional().nullable(),
  maxAmount: money.optional().nullable().transform((v) => (v ? v : null)),
  scope: z.enum(["all", "camps", "training", "shop"]),
  validFrom: day.optional().nullable(),
  validUntil: day.optional().nullable(),
}).refine((s) => s.kind !== "percent" || s.value <= 100, { message: "accounting.errors.invalidPercent" })
  .refine((s) => s.kind !== "fixed_amount" || !!s.currency, { message: "accounting.errors.invalidCurrency" })
  .refine((s) => !s.validFrom || !s.validUntil || s.validUntil >= s.validFrom, { message: "accounting.errors.invalidDate" });

export const reimbursementSchema = z.object({
  funderKind: z.enum(["city", "canton", "foundation", "js", "other"]),
  funderName: z.string().trim().min(1, "accounting.errors.nameRequired").max(140),
  familyId: uuid.optional().nullable().or(z.literal("").transform(() => null)),
  invoiceId: uuid.optional().nullable().or(z.literal("").transform(() => null)),
  periodStart: day.optional().nullable().or(z.literal("").transform(() => null)),
  periodEnd: day.optional().nullable().or(z.literal("").transform(() => null)),
  amountExpected: z.coerce.number().positive().max(10_000_000),
  amountReceived: money.optional().nullable(),
  currency,
  status: z.enum(["expected", "requested", "received", "rejected"]),
  requestedOn: day.optional().nullable().or(z.literal("").transform(() => null)),
  receivedOn: day.optional().nullable().or(z.literal("").transform(() => null)),
  reference: optText(140),
  notes: optText(1000),
}).refine((r) => r.status !== "received" || (!!r.receivedOn && r.amountReceived != null), { message: "accounting.errors.receivedNeedsData" });

/** Database / RPC error -> i18n key. */
const KNOWN = [
  "NOT_AUTHORIZED", "PERIOD_CLOSED", "PERIOD_NOT_ENDED", "PERIOD_NOT_CLOSED", "REASON_REQUIRED", "INVALID_PERIOD",
  "ENTRY_NOT_FOUND", "ENTRY_IGNORED", "ENTRY_BOOKED", "INVOICE_NOT_FOUND", "INVOICE_NOT_PAYABLE", "INVOICE_REQUIRED", "INVOICE_CANCELLED",
  "SUBJECT_NOT_FOUND", "INVALID_IBAN", "HOLDER_REQUIRED", "STRIPE_NOT_AVAILABLE", "STRIPE_AMOUNT_TOO_HIGH", "REQUEST_EXISTS",
  "REQUEST_NOT_FOUND", "REQUEST_CLOSED", "OVERRIDE_REASON_REQUIRED", "BANK_DETAILS_REQUIRED", "INVALID_AMOUNT", "ALREADY_CANCELLED",
  "CASE_NOT_FOUND", "CROSS_TENANT_REFERENCE", "INVALID_PAYLOAD", "HAS_PAYMENTS", "CREDIT_ALREADY_USED",
] as const;

export function accountingErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  for (const k of KNOWN) if (m.includes(k)) return `accounting.errors.codes.${k}`;
  if (/duplicate key|unique/i.test(m)) return "accounting.errors.duplicate";
  if (/violates check constraint|invalid input/i.test(m)) return "accounting.errors.invalidRequest";
  if (/row-level security|permission denied/i.test(m)) return "accounting.errors.notPermitted";
  return "accounting.errors.generic";
}

export function firstIssueKey(e: z.ZodError): string {
  const msg = e.issues[0]?.message ?? "";
  return msg.startsWith("accounting.") ? msg : "accounting.errors.invalidRequest";
}

export const BANK_FILE_MAX_BYTES = 5 * 1024 * 1024;
