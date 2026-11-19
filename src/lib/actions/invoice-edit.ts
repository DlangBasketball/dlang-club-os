"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  invalidInput,
  moneyFail,
  moneyT,
  notPermitted,
  requireMoneyStaff,
  revalidateMoney,
  type MoneyResult,
} from "@/lib/money/action-helpers";
import type { Json } from "@/types/database";

/*
 * Invoice editing (admin + finance). Every mutation goes through a SECURITY
 * DEFINER RPC (migration 20250420095900) that re-checks the role and that the
 * invoice belongs to the caller's org, rounds amounts to the currency's minor
 * unit and writes an audit_logs row with before/after amounts. The org is
 * never taken from the client.
 */

const uuid = z.string().uuid();
const reason = z.string().trim().min(1).max(500);
const money = z.coerce.number().finite();
const dateStr = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
const locale = z.union([z.literal(""), z.enum(["en", "de", "fr", "it", "es"])]);

// --- Draft: free edit ------------------------------------------------------
const draftSchema = z.object({
  family_id: uuid,
  description: z.string().trim().max(500).optional().default(""),
  due_date: dateStr.optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  locale: locale.optional().default(""),
  tax_rate: z.coerce.number().min(0).max(100),
  tax_inclusive: z.boolean(),
  discount: money.min(0).optional().default(0),
  discount_label: z.string().trim().max(200).optional().default(""),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(500),
        quantity: z.coerce.number().positive().max(100000),
        unit_price: money,
      }),
    )
    .min(1)
    .max(200),
});
export type DraftInvoiceInput = z.input<typeof draftSchema>;

export async function updateDraftInvoice(invoiceId: string, input: DraftInvoiceInput): Promise<MoneyResult> {
  const t = await moneyT();
  if (!(await requireMoneyStaff())) return notPermitted(t);
  const id = uuid.safeParse(invoiceId);
  const parsed = draftSchema.safeParse(input);
  if (!id.success || !parsed.success) return invalidInput(t);

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_draft_invoice", { p_invoice: id.data, p_payload: parsed.data as unknown as Json });
  if (error) return moneyFail(t, error);
  revalidateMoney([id.data]);
  return { ok: true, message: t("editMoney.invoice.saved") };
}

// --- Issued: safe fields only ------------------------------------------------
const detailsSchema = z.object({
  due_date: dateStr.optional(),
  notes: z.string().trim().max(2000).optional(),
  locale: locale.optional(),
  reminders_paused: z.boolean().optional(),
});
export type InvoiceDetailsInput = z.input<typeof detailsSchema>;

export async function updateInvoiceDetails(invoiceId: string, input: InvoiceDetailsInput): Promise<MoneyResult> {
  const t = await moneyT();
  if (!(await requireMoneyStaff())) return notPermitted(t);
  const id = uuid.safeParse(invoiceId);
  const parsed = detailsSchema.safeParse(input);
  if (!id.success || !parsed.success) return invalidInput(t);

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_invoice_details", { p_invoice: id.data, p_payload: parsed.data as unknown as Json });
  if (error) return moneyFail(t, error);
  revalidateMoney([id.data]);
  return { ok: true, message: t("editMoney.invoice.saved") };
}

/** Pause / resume payment reminders for one invoice. */
export async function setInvoiceRemindersPaused(invoiceId: string, paused: boolean): Promise<MoneyResult> {
  return updateInvoiceDetails(invoiceId, { reminders_paused: paused });
}

// --- Credit note / debit note / write-off -----------------------------------
const adjustmentSchema = z.object({
  kind: z.enum(["credit_note", "debit_note", "write_off"]),
  amount: money.optional(),
  reason,
  description: z.string().trim().max(500).optional().default(""),
});
export type AdjustmentInput = z.input<typeof adjustmentSchema>;

export async function issueInvoiceAdjustment(invoiceId: string, input: AdjustmentInput): Promise<MoneyResult> {
  const t = await moneyT();
  if (!(await requireMoneyStaff())) return notPermitted(t);
  const id = uuid.safeParse(invoiceId);
  const parsed = adjustmentSchema.safeParse(input);
  if (!id.success || !parsed.success) return parsed.success ? invalidInput(t) : reasonOrInvalid(t, parsed.error);
  if (parsed.data.kind !== "write_off" && !(Number(parsed.data.amount) > 0)) return moneyFail(t, "INVALID_AMOUNT");

  const supabase = await createClient();
  const { error } = await supabase.rpc("issue_invoice_adjustment", {
    p_invoice: id.data,
    p_kind: parsed.data.kind,
    p_amount: parsed.data.kind === "write_off" ? null : Number(parsed.data.amount),
    p_reason: parsed.data.reason,
    p_description: parsed.data.description || null,
  });
  if (error) return moneyFail(t, error);
  revalidateMoney([id.data]);
  return { ok: true, message: t("editMoney.adjust.issued") };
}

/** Writes off the whole open balance (bad debt) with a reason. */
export async function writeOffInvoice(invoiceId: string, why: string): Promise<MoneyResult> {
  return issueInvoiceAdjustment(invoiceId, { kind: "write_off", reason: why });
}

export async function voidInvoiceAdjustment(adjustmentId: string, why: string): Promise<MoneyResult> {
  const t = await moneyT();
  if (!(await requireMoneyStaff())) return notPermitted(t);
  const id = uuid.safeParse(adjustmentId);
  const r = reason.safeParse(why);
  if (!id.success) return invalidInput(t);
  if (!r.success) return moneyFail(t, "REASON_REQUIRED");

  const supabase = await createClient();
  const { data: adj } = await supabase.from("invoice_adjustments").select("invoice_id").eq("id", id.data).maybeSingle();
  const { error } = await supabase.rpc("void_invoice_adjustment", { p_adjustment: id.data, p_reason: r.data });
  if (error) return moneyFail(t, error);
  revalidateMoney([adj?.invoice_id]);
  return { ok: true, message: t("editMoney.adjust.voidedMessage") };
}

// --- Reopen a cancelled invoice ----------------------------------------------
export async function reopenInvoice(invoiceId: string, why: string): Promise<MoneyResult> {
  const t = await moneyT();
  if (!(await requireMoneyStaff())) return notPermitted(t);
  const id = uuid.safeParse(invoiceId);
  const r = reason.safeParse(why);
  if (!id.success) return invalidInput(t);
  if (!r.success) return moneyFail(t, "REASON_REQUIRED");

  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_invoice", { p_invoice: id.data, p_reason: r.data });
  if (error) return moneyFail(t, error);
  revalidateMoney([id.data]);
  return { ok: true, message: t("editMoney.actions.reopened") };
}

// --- Overpayment -> family credit, and paying from credit --------------------
const optionalAmount = z.union([z.literal(""), z.null(), money.positive()]).optional();

export async function transferOverpaymentToCredit(invoiceId: string, amount?: number | null, why?: string): Promise<MoneyResult> {
  const t = await moneyT();
  if (!(await requireMoneyStaff())) return notPermitted(t);
  const id = uuid.safeParse(invoiceId);
  const a = optionalAmount.safeParse(amount);
  if (!id.success || !a.success) return invalidInput(t);

  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_overpayment_to_credit", {
    p_invoice: id.data,
    p_amount: typeof a.data === "number" ? a.data : null,
    p_reason: why?.trim() || t("editMoney.overpay.defaultReason"),
  });
  if (error) return moneyFail(t, error);
  revalidateMoney([id.data]);
  return { ok: true, message: t("editMoney.overpay.done") };
}

export async function applyFamilyCredit(invoiceId: string, amount?: number | null, why?: string): Promise<MoneyResult> {
  const t = await moneyT();
  if (!(await requireMoneyStaff())) return notPermitted(t);
  const id = uuid.safeParse(invoiceId);
  const a = optionalAmount.safeParse(amount);
  if (!id.success || !a.success) return invalidInput(t);

  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_family_credit", {
    p_invoice: id.data,
    p_amount: typeof a.data === "number" ? a.data : null,
    p_reason: why?.trim() || t("editMoney.credit.defaultReason"),
  });
  if (error) return moneyFail(t, error);
  revalidateMoney([id.data]);
  return { ok: true, message: t("editMoney.credit.applied") };
}

function reasonOrInvalid(t: Awaited<ReturnType<typeof moneyT>>, err: z.ZodError): MoneyResult {
  return err.issues.some((i) => i.path[0] === "reason") ? moneyFail(t, "REASON_REQUIRED") : invalidInput(t);
}
