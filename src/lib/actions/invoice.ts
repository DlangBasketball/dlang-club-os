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
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid invoice" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_manual_invoice", { p_payload: parsed.data as unknown as Json });
  if (error) return { ok: false, error: error.message };
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
    .select("id,number,status,description,total_chf,currency,due_date,family_id")
    .eq("id", id)
    .maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found" };
  if (inv.status !== "draft" && inv.status !== "sent") return { ok: false, error: "Only draft invoices can be sent" };

  const { error } = await supabase.from("invoices").update({ status: "sent" }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  const { data: family } = await supabase.from("families").select("contact_name,contact_email").eq("id", inv.family_id).maybeSingle();
  if (family?.contact_email) {
    const org = await getOrgEmailContext(me.orgId);
    const clubName = org.clubName;
    const t = invoiceIssued({
      ...org.brand,
      currency: inv.currency ?? org.brand.currency,
      parentName: family.contact_name ?? "there",
      invoiceNumber: inv.number,
      description: inv.description,
      totalChf: Number(inv.total_chf ?? 0),
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
export async function cancelInvoice(id: string): Promise<ActionResult> {
  const me = await requireFinance();
  if (!me) return { ok: false, error: "Not permitted" };
  const supabase = await createClient();
  const { data: inv } = await supabase.from("invoices").select("status").eq("id", id).maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found" };
  if (inv.status === "paid") return { ok: false, error: "Paid invoices can't be cancelled (issue a refund instead)" };
  const { error } = await supabase.from("invoices").update({ status: "cancelled" }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/invoices/${id}`);
  revalidatePath("/admin/invoices");
  return { ok: true };
}

// --- Manual payment (bank transfer / TWINT / cash) -------------------------
const paymentSchema = z.object({
  amount: z.coerce.number().positive("Amount must be positive"),
  method: z.enum(["bank_transfer", "twint", "manual", "card"]),
  reference: z.string().optional().default(""),
  note: z.string().optional().default(""),
});
export type ManualPaymentInput = z.input<typeof paymentSchema>;

export async function recordManualPayment(invoiceId: string, input: ManualPaymentInput): Promise<ActionResult> {
  const me = await requireFinance();
  if (!me) return { ok: false, error: "Not permitted" };
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid payment" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_manual_payment", {
    p_invoice: invoiceId,
    p_amount: parsed.data.amount,
    p_method: parsed.data.method,
    p_reference: parsed.data.reference || undefined,
    p_note: parsed.data.note || undefined,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/invoices/${invoiceId}`);
  revalidatePath("/admin/invoices");
  return { ok: true };
}

// --- Overdue reminder email ------------------------------------------------
export async function sendReminder(id: string): Promise<ActionResult> {
  const me = await requireFinance();
  if (!me) return { ok: false, error: "Not permitted" };
  const supabase = await createClient();
  const { data: inv } = await supabase
    .from("invoices")
    .select("number,total_chf,currency,due_date,family_id,status")
    .eq("id", id)
    .maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found" };

  const { data: family } = await supabase.from("families").select("contact_name,contact_email").eq("id", inv.family_id).maybeSingle();
  if (!family?.contact_email) return { ok: false, error: "No contact email on file for this family" };

  const org = await getOrgEmailContext(me.orgId);
  const clubName = org.clubName;
  const t = overdueReminder({
    ...org.brand,
    currency: inv.currency ?? org.brand.currency,
    parentName: family.contact_name ?? "there",
    invoiceNumber: inv.number,
    description: null,
    totalChf: Number(inv.total_chf ?? 0),
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
  method: "bank_transfer" | "twint" | "manual" = "bank_transfer",
): Promise<ActionResult> {
  const me = await requireFinance();
  if (!me) return { ok: false, error: "Not permitted" };

  // Outstanding balance net of refund rows (as public.invoice_net_paid), so a
  // refunded Stripe payment can be settled by bank transfer afterwards.
  const inv = await loadPayableInvoice(invoiceId);
  if (!inv.ok) return { ok: false, error: inv.error };
  const balance = roundMoney(inv.balance, inv.currency);
  if (balance <= 0) return { ok: false, error: "Nothing outstanding" };

  const supabase = await createClient();
  const { data: ref } = await supabase.from("invoices").select("payment_reference").eq("id", invoiceId).maybeSingle();

  const { error } = await supabase.rpc("record_manual_payment", {
    p_invoice: invoiceId,
    p_amount: balance,
    p_method: method,
    p_reference: ref?.payment_reference ?? undefined,
    p_note: "Reconciled — marked paid",
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/invoices/${invoiceId}`);
  revalidatePath("/admin/invoices/reconcile");
  revalidatePath("/admin/invoices");
  return { ok: true };
}
