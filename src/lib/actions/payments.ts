"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { isKnownMethod } from "@/lib/payments/methods";
import type { Json } from "@/types/database";
import { z } from "zod";
import {
  invalidInput,
  moneyFail,
  moneyT,
  notPermitted,
  requireMoneyStaff,
  revalidateMoney,
  type MoneyResult,
} from "@/lib/money/action-helpers";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Admin: save regional payment settings (enabled methods, SEPA / ACH / EPC
 * toggles, BIC, tax defaults). Goes through public.update_payment_settings,
 * which strips platform-controlled keys (Stripe account, plan, fee).
 */
export async function savePaymentSettings(form: FormData): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!me?.roles.includes("admin")) return { ok: false, error: "Only club admins can change payment settings" };

  const methods = form.getAll("enabled_methods").map(String).filter(isKnownMethod);
  if (!methods.length) return { ok: false, error: "Enable at least one payment method" };
  const rate = Number(form.get("tax_rate") ?? 0);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return { ok: false, error: "Tax rate must be between 0 and 100" };
  const bic = String(form.get("bic") ?? "").replace(/\s/g, "").toUpperCase();
  if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) return { ok: false, error: "BIC must be 8 or 11 characters" };

  const patch = {
    enabled_methods: methods,
    sepa_enabled: form.get("sepa_enabled") === "on",
    us_ach_enabled: form.get("us_ach_enabled") === "on",
    epc_qr_enabled: form.get("epc_qr_enabled") === "on",
    ...(bic ? { bic } : {}),
    tax: {
      rate,
      inclusive: form.get("tax_inclusive") === "on",
      label: String(form.get("tax_label") ?? "").trim() || undefined,
      registration_number: String(form.get("tax_registration") ?? "").trim() || undefined,
    },
  };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_payment_settings", { p_patch: patch as unknown as Json });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/settings/payments");
  return { ok: true };
}

/** Form-action wrapper: redirects back with ?saved=1 or ?error=… */
export async function savePaymentSettingsForm(form: FormData): Promise<void> {
  const res = await savePaymentSettings(form);
  redirect(res.ok ? "/admin/settings/payments?saved=1" : `/admin/settings/payments?error=${encodeURIComponent(res.error)}`);
}

// ===========================================================================
// Manual payment corrections (admin + finance). Payments stay append-only:
// void = a reversing row + the original flagged voided; edit / re-allocate =
// void + a replacement row. Stripe-originated payments are never voided or
// edited here (refund them in Stripe); they can only be annotated. The RPCs
// (migration 20250420095900) check role + org and write before/after audit rows.
// ===========================================================================
const paymentId = z.string().uuid();
const reasonText = z.string().trim().min(1).max(500);

export async function voidPayment(id: string, reason: string): Promise<MoneyResult> {
  const t = await moneyT();
  if (!(await requireMoneyStaff())) return notPermitted(t);
  const pid = paymentId.safeParse(id);
  const r = reasonText.safeParse(reason);
  if (!pid.success) return invalidInput(t);
  if (!r.success) return moneyFail(t, "REASON_REQUIRED");

  const supabase = await createClient();
  const { data: before } = await supabase.from("payments").select("invoice_id").eq("id", pid.data).maybeSingle();
  const { error } = await supabase.rpc("void_payment", { p_payment: pid.data, p_reason: r.data });
  if (error) return moneyFail(t, error);
  revalidateMoney([before?.invoice_id]);
  return { ok: true, message: t("editMoney.payment.voidedMessage") };
}

const editSchema = z.object({
  amount: z.coerce.number().finite().positive().optional(),
  method: z.enum(["bank_transfer", "twint", "manual", "qr_bill", "card"]).optional(),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reference: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
  invoice_id: z.string().uuid().optional(),
  reason: reasonText,
});
export type EditPaymentInput = z.input<typeof editSchema>;

export async function editPayment(id: string, input: EditPaymentInput): Promise<MoneyResult> {
  const t = await moneyT();
  if (!(await requireMoneyStaff())) return notPermitted(t);
  const pid = paymentId.safeParse(id);
  const parsed = editSchema.safeParse(input);
  if (!pid.success) return invalidInput(t);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return field === "reason" ? moneyFail(t, "REASON_REQUIRED") : field === "amount" ? moneyFail(t, "INVALID_AMOUNT") : invalidInput(t);
  }
  const { reason, ...payload } = parsed.data;

  const supabase = await createClient();
  const { data: before } = await supabase.from("payments").select("invoice_id").eq("id", pid.data).maybeSingle();
  const { data, error } = await supabase.rpc("edit_manual_payment", {
    p_payment: pid.data,
    p_payload: payload as unknown as Json,
    p_reason: reason,
  });
  if (error) return moneyFail(t, error);
  const target = (data as { invoice_id?: string } | null)?.invoice_id;
  const moved = Boolean(target && target !== before?.invoice_id);
  revalidateMoney([before?.invoice_id, target]);
  return { ok: true, message: moved ? t("editMoney.payment.reallocatedMessage") : t("editMoney.payment.editedMessage") };
}

/** Moves a manual payment (unchanged) to another invoice of the same currency. */
export async function reallocatePayment(id: string, invoiceId: string, reason: string): Promise<MoneyResult> {
  return editPayment(id, { invoice_id: invoiceId, reason });
}

/** Internal note on any payment (Stripe ones included). Never changes money. */
export async function annotatePayment(id: string, note: string): Promise<MoneyResult> {
  const t = await moneyT();
  if (!(await requireMoneyStaff())) return notPermitted(t);
  const pid = paymentId.safeParse(id);
  const n = z.string().trim().max(1000).safeParse(note ?? "");
  if (!pid.success || !n.success) return invalidInput(t);

  const supabase = await createClient();
  const { data: before } = await supabase.from("payments").select("invoice_id").eq("id", pid.data).maybeSingle();
  const { error } = await supabase.rpc("annotate_payment", { p_payment: pid.data, p_note: n.data });
  if (error) return moneyFail(t, error);
  revalidateMoney([before?.invoice_id]);
  return { ok: true, message: t("editMoney.payment.noteSaved") };
}

/** Manual family-credit correction: + goodwill credit, − credit paid out. Never below zero. */
export async function adjustFamilyCredit(familyId: string, currency: string, amount: number, reason: string): Promise<MoneyResult> {
  const t = await moneyT();
  if (!(await requireMoneyStaff())) return notPermitted(t);
  const parsed = z
    .object({
      familyId: z.string().uuid(),
      currency: z.string().trim().regex(/^[A-Za-z]{3}$/),
      amount: z.coerce.number().finite().refine((n) => n !== 0),
      reason: reasonText,
    })
    .safeParse({ familyId, currency, amount, reason });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return field === "reason" ? moneyFail(t, "REASON_REQUIRED") : field === "amount" ? moneyFail(t, "INVALID_AMOUNT") : invalidInput(t);
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_family_credit", {
    p_family: parsed.data.familyId,
    p_currency: parsed.data.currency.toUpperCase(),
    p_amount: parsed.data.amount,
    p_reason: parsed.data.reason,
  });
  if (error) return moneyFail(t, error);
  revalidateMoney();
  return { ok: true, message: t("editMoney.credit.adjusted") };
}
