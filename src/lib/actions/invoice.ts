"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";
import { getStripe } from "@/lib/stripe";
import { createInvoiceCheckout } from "@/lib/stripe-connect";
import { loadPayableInvoice } from "@/lib/payments/invoice-payable";
import { roundMoney } from "@/lib/payments/currency";
import { getOrgPaymentProfile, methodsForInvoice } from "@/lib/payments/settings";
import { sendEmail } from "@/lib/email/resend";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { invoiceIssued, overdueReminder } from "@/lib/email/templates";
import type { Json } from "@/types/database";
import { moneyFail, moneyT, notPermitted, invalidInput, requireMoneyStaff, revalidateMoney } from "@/lib/money/action-helpers";
import { invoiceMoney } from "@/lib/payments/adjustments";
import { guardianMayPay } from "@/lib/family/billing";
import { getTranslations } from "@/lib/i18n/server";
import { MANUAL_INVOICE_CATEGORIES, billingErrorCode } from "@/lib/billing/activities";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireFinance() {
  const me = await getSessionUser();
  if (!me || !(me.roles.includes("admin") || me.roles.includes("finance"))) return null;
  return me;
}

// --- Create (manual) -------------------------------------------------------
const itemSchema = z.object({
  description: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  unit_price_chf: z.coerce.number(),
});
const createSchema = z.object({
  family_id: z.string().uuid("Choose a family"),
  // Revenue category (migration 20250420103500): required, never "other";
  // club fees are issued through the membership flow.
  activity: z.enum(MANUAL_INVOICE_CATEGORIES),
  // Client-generated idempotency key: a retried submit returns the same invoice.
  request_id: z.string().uuid().optional(),
  description: z.string().optional().default(""),
  due_date: z.string().optional().default(""),
  discount_chf: z.coerce.number().min(0).optional().default(0),
  discount_label: z.string().optional().default("Discount"),
  items: z.array(itemSchema).min(1, "Add at least one line item"),
});
export type CreateInvoiceInput = z.input<typeof createSchema>;

export async function createInvoice(input: CreateInvoiceInput): Promise<ActionResult> {
  const me = await requireFinance();
  if (!me) return { ok: false, error: "Not permitted" };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    const t = await getTranslations();
    if (parsed.error.issues.some((i) => i.path[0] === "activity")) return { ok: false, error: t("billing.errors.CATEGORY_REQUIRED") };
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid invoice" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_manual_invoice", { p_payload: parsed.data as unknown as Json });
  if (error) {
    const code = billingErrorCode(error.message);
    if (code) {
      const t = await getTranslations();
      return { ok: false, error: t.dynamic(`billing.errors.${code}`, undefined, t("billing.errors.generic")) };
    }
    return { ok: false, error: error.message };
  }
  const invoiceId = (data as { invoice_id?: string } | null)?.invoice_id;
  revalidatePath("/admin/invoices");
  if (invoiceId) redirect(`/admin/invoices/${invoiceId}`);
  return { ok: true };
}

// --- Send (draft -> sent) + email ------------------------------------------
export async function sendInvoice(id: string): Promise<ActionResult> {
  const me = await requireFinance();
  if (!me) return { ok: false, error: "Not permitted" };
  const supabase = await createClient();

  const { data: inv } = await supabase
    .from("invoices")
    .select("id,number,status,description,total_chf,adjustments_total,currency,due_date,family_id,locale,payer_kind,payer_profile_id")
    .eq("id", id)
    .maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found" };
  if (inv.status !== "draft" && inv.status !== "sent") return { ok: false, error: "Only draft invoices can be sent" };

  const { error } = await supabase.from("invoices").update({ status: "sent" }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  const { data: fam } = await supabase.from("families").select("contact_name,contact_email").eq("id", inv.family_id).maybeSingle();
  let family = fam as { contact_name: string | null; contact_email: string | null } | null;
  // An invoice addressed to someone outside the family (a relative linked to one child,
  // kind 'other') goes to that payer, never to the family contact.
  const payer = inv as unknown as { payer_kind?: string | null; payer_profile_id?: string | null };
  if (payer.payer_kind === "other" && payer.payer_profile_id) {
    const { data: pp } = await createAdminClient().from("profiles").select("full_name,email").eq("id", payer.payer_profile_id).maybeSingle();
    const p = pp as { full_name: string | null; email: string | null } | null;
    family = { contact_name: p?.full_name ?? null, contact_email: p?.email ?? null };
  }
  if (family?.contact_email) {
    const org = await getOrgEmailContext(me.orgId, inv.locale);
    const clubName = org.clubName;
    const t = invoiceIssued({
      ...org.brand,
      currency: inv.currency ?? org.brand.currency,
      parentName: family.contact_name ?? "",
      invoiceNumber: inv.number,
      description: inv.description,
      // Amount due: the issued total plus any credit / debit notes.
      totalChf: Number(inv.total_chf ?? 0) + Number(inv.adjustments_total ?? 0),
      dueDateLabel: org.f.date(inv.due_date),
      payUrl: org.link(`/parent/invoices/${id}`),
    });
    await sendEmail({ to: family.contact_email, subject: t.subject, html: t.html, fromName: org.senderName ?? clubName });
  }
  revalidatePath(`/admin/invoices/${id}`);
  revalidatePath("/admin/invoices");
  return { ok: true };
}

// --- Cancel ----------------------------------------------------------------
// Draft: cancelled outright. Issued and unpaid: a cancellation document for
// the amount due (nothing is deleted; reopenInvoice undoes it). Invoices with
// money on them are refused: void / re-allocate / refund the payments first.
export async function cancelInvoice(id: string, reason: string): Promise<ActionResult> {
  const t = await moneyT();
  if (!(await requireMoneyStaff())) return notPermitted(t);
  const parsed = z.object({ id: z.string().uuid(), reason: z.string().trim().min(1).max(500) }).safeParse({ id, reason });
  if (!parsed.success) return parsed.error.issues.some((i) => i.path[0] === "reason") ? moneyFail(t, "REASON_REQUIRED") : invalidInput(t);
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_invoice", { p_invoice: parsed.data.id, p_reason: parsed.data.reason });
  if (error) return moneyFail(t, error);
  revalidateMoney([parsed.data.id]);
  return { ok: true };
}

// --- Manual payment (cash / bank transfer / TWINT / QR-bill) ----------------
const paymentSchema = z.object({
  amount: z.coerce.number().finite().positive(),
  method: z.enum(["bank_transfer", "twint", "manual", "qr_bill", "card"]),
  paid_on: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().default(""),
  reference: z.string().trim().max(200).optional().default(""),
  note: z.string().trim().max(1000).optional().default(""),
});
export type ManualPaymentInput = z.input<typeof paymentSchema>;

/**
 * Record a manual payment. `requestId` (one per submit in the form) makes a
 * retry or a double click return the first payment instead of booking it twice.
 */
export async function recordManualPayment(invoiceId: string, input: ManualPaymentInput, requestId?: string): Promise<ActionResult> {
  const t = await moneyT();
  if (!(await requireMoneyStaff())) return notPermitted(t);
  const id = z.string().uuid().safeParse(invoiceId);
  const parsed = paymentSchema.safeParse(input);
  if (!id.success) return invalidInput(t);
  if (!parsed.success) return parsed.error.issues.some((i) => i.path[0] === "amount") ? moneyFail(t, "INVALID_AMOUNT") : invalidInput(t);

  const supabase = await createClient();
  const rid = requestId ? z.string().uuid().safeParse(requestId) : null;
  if (rid && !rid.success) return invalidInput(t);
  const args = {
    p_invoice: id.data,
    p_amount: parsed.data.amount,
    p_method: parsed.data.method,
    p_paid_on: parsed.data.paid_on || null,
    p_reference: parsed.data.reference || null,
    p_note: parsed.data.note || null,
  };
  // With a request id: idempotent wrapper (20250420106000); not yet in the generated types.
  const { error } = rid?.success
    ? await (supabase as unknown as { rpc: (fn: string, a: Record<string, unknown>) => Promise<{ error: { message: string } | null }> })
        .rpc("record_offline_payment_once", { ...args, p_request_id: rid.data })
    : await supabase.rpc("record_offline_payment", args);
  if (error) return moneyFail(t, error);
  revalidateMoney([id.data]);
  return { ok: true };
}

// --- Overdue reminder email ------------------------------------------------
export async function sendReminder(id: string): Promise<ActionResult> {
  const me = await requireFinance();
  if (!me) return { ok: false, error: "Not permitted" };
  const supabase = await createClient();
  const { data: inv } = await supabase
    .from("invoices")
    .select("number,total_chf,adjustments_total,currency,due_date,family_id,status,locale,reminders_paused")
    .eq("id", id)
    .maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found" };
  if (inv.reminders_paused) return { ok: false, error: (await moneyT())("editMoney.errors.REMINDERS_PAUSED") };
  const { data: paidNet } = await supabase.rpc("invoice_net_paid", { p_invoice: id });
  const due = invoiceMoney({
    total: Number(inv.total_chf ?? 0),
    adjustmentsTotal: Number(inv.adjustments_total ?? 0),
    paid: Number(paidNet ?? 0),
    currency: inv.currency ?? "CHF",
  }).outstanding;

  const { data: family } = await supabase.from("families").select("contact_name,contact_email").eq("id", inv.family_id).maybeSingle();
  if (!family?.contact_email) return { ok: false, error: "No contact email on file for this family" };

  const org = await getOrgEmailContext(me.orgId, inv.locale);
  const clubName = org.clubName;
  const t = overdueReminder({
    ...org.brand,
    currency: inv.currency ?? org.brand.currency,
    parentName: family.contact_name ?? "",
    invoiceNumber: inv.number,
    description: null,
    totalChf: due,
    dueDateLabel: org.f.date(inv.due_date),
    payUrl: org.link(`/parent/invoices/${id}`),
  });
  const res = await sendEmail({ to: family.contact_email, subject: t.subject, html: t.html, fromName: org.senderName ?? clubName });
  if (!res.ok && res.error === "email-not-configured") return { ok: false, error: "Email isn't configured (set RESEND_API_KEY)" };
  return { ok: true };
}

// --- Stripe Checkout (parent or finance) -----------------------------------
// Charges the club's connected Stripe account in the invoice currency with the
// region's payment methods (card / TWINT / SEPA / iDEAL / Bancontact / ACH …).
export async function createCheckoutSession(invoiceId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: "Please sign in" };

  // RLS ensures the caller may only read an invoice they're entitled to.
  const inv = await loadPayableInvoice(invoiceId);
  if (!inv.ok) return inv;
  // A second guardian without the "can pay" permission cannot start a payment.
  if (!me.roles.includes("admin") && !me.roles.includes("finance")) {
    const { data: famRow } = await (await createClient()).from("invoices").select("family_id").eq("id", inv.id).maybeSingle();
    if (famRow?.family_id && !(await guardianMayPay(inv.orgId, famRow.family_id, me.id))) {
      return { ok: false, error: (await getTranslations())("family.errors.cannotPay") };
    }
  }

  if (!getStripe()) return { ok: false, error: "Online payments aren't configured yet" };
  const profile = await getOrgPaymentProfile(inv.orgId);
  if (!profile.stripeReady) return { ok: false, error: "Online payments aren't set up for this club yet" };
  const methods = methodsForInvoice(profile, inv.currency).filter((m) => m.via === "stripe");
  if (!methods.length) return { ok: false, error: "No online payment method is available for this invoice" };

  try {
    const url = await createInvoiceCheckout({
      profile,
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      currency: inv.currency,
      amount: inv.balance,
      methods,
      customerEmail: me.email,
    });
    return { ok: true, url };
  } catch (err) {
    console.error("[stripe] checkout failed:", err);
    return { ok: false, error: "Could not start checkout" };
  }
}

// --- One-click "mark as paid" (records the outstanding balance) -------------
export async function markInvoicePaid(
  invoiceId: string,
  method: "bank_transfer" | "twint" | "manual" | "qr_bill" = "bank_transfer",
): Promise<ActionResult> {
  const t = await moneyT();
  if (!(await requireMoneyStaff())) return notPermitted(t);

  // Outstanding balance = amount due (total + credit/debit notes) net of
  // refund rows (as public.invoice_net_paid), so a refunded Stripe payment
  // can be settled by bank transfer afterwards.
  const inv = await loadPayableInvoice(invoiceId);
  if (!inv.ok) return { ok: false, error: inv.error };
  const balance = roundMoney(inv.balance, inv.currency);
  if (balance <= 0) return moneyFail(t, "NOTHING_DUE");

  const supabase = await createClient();
  const { data: ref } = await supabase.from("invoices").select("payment_reference").eq("id", invoiceId).maybeSingle();

  const { error } = await supabase.rpc("record_offline_payment", {
    p_invoice: invoiceId,
    p_amount: balance,
    p_method: method,
    p_paid_on: null,
    p_reference: ref?.payment_reference ?? null,
    p_note: t("editMoney.payment.markedPaidNote"),
  });
  if (error) return moneyFail(t, error);
  revalidateMoney([invoiceId]);
  return { ok: true };
}
