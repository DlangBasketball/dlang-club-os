"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";
import { getStripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email/resend";
import { invoiceIssued, overdueReminder } from "@/lib/email/templates";
import { formatDate } from "@/lib/utils";
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
    .select("id,number,status,description,total_chf,due_date,family_id")
    .eq("id", id)
    .maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found" };
  if (inv.status !== "draft" && inv.status !== "sent") return { ok: false, error: "Only draft invoices can be sent" };

  const { error } = await supabase.from("invoices").update({ status: "sent" }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  const { data: family } = await supabase.from("families").select("contact_name,contact_email").eq("id", inv.family_id).maybeSingle();
  if (family?.contact_email) {
    const t = invoiceIssued({
      parentName: family.contact_name ?? "there",
      invoiceNumber: inv.number,
      description: inv.description,
      totalChf: Number(inv.total_chf ?? 0),
      dueDateLabel: formatDate(inv.due_date),
      payUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/parent/invoices/${id}`,
    });
    await sendEmail({ to: family.contact_email, subject: t.subject, html: t.html });
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
    .select("number,total_chf,due_date,family_id,status")
    .eq("id", id)
    .maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found" };

  const { data: family } = await supabase.from("families").select("contact_name,contact_email").eq("id", inv.family_id).maybeSingle();
  if (!family?.contact_email) return { ok: false, error: "No contact email on file for this family" };

  const t = overdueReminder({
    parentName: family.contact_name ?? "there",
    invoiceNumber: inv.number,
    description: null,
    totalChf: Number(inv.total_chf ?? 0),
    dueDateLabel: formatDate(inv.due_date),
    payUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/parent/invoices/${id}`,
  });
  const res = await sendEmail({ to: family.contact_email, subject: t.subject, html: t.html });
  if (!res.ok && res.error === "email-not-configured") return { ok: false, error: "Email isn't configured (set RESEND_API_KEY)" };
  return { ok: true };
}

// --- Stripe Checkout (parent or finance) -----------------------------------
export async function createCheckoutSession(invoiceId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: "Please sign in" };

  // RLS ensures the caller may only read an invoice they're entitled to.
  const supabase = await createClient();
  const { data: inv } = await supabase.from("invoices").select("id,number,total_chf,status,family_id").eq("id", invoiceId).maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found" };
  if (inv.status === "paid") return { ok: false, error: "This invoice is already paid" };
  if (inv.status === "cancelled") return { ok: false, error: "This invoice was cancelled" };

  // Compute outstanding balance from succeeded payments.
  const { data: pays } = await supabase.from("payments").select("amount_chf,status").eq("invoice_id", invoiceId).eq("status", "succeeded");
  const paid = (pays ?? []).reduce((s, p) => s + Number(p.amount_chf ?? 0), 0);
  const balance = Number(inv.total_chf ?? 0) - paid;
  if (balance <= 0) return { ok: false, error: "Nothing left to pay" };

  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Online payments aren't configured yet" };

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "chf",
          unit_amount: Math.round(balance * 100),
          product_data: { name: `DLang Basketball — Invoice ${inv.number}` },
        },
      },
    ],
    metadata: { invoice_id: invoiceId },
    payment_intent_data: { metadata: { invoice_id: invoiceId } },
    success_url: `${site}/parent/invoices/${invoiceId}?paid=1`,
    cancel_url: `${site}/parent/invoices/${invoiceId}`,
  });
  if (!session.url) return { ok: false, error: "Could not start checkout" };
  return { ok: true, url: session.url };
}

// --- One-click "mark as paid" (records the outstanding balance) -------------
export async function markInvoicePaid(
  invoiceId: string,
  method: "bank_transfer" | "twint" | "manual" = "bank_transfer",
): Promise<ActionResult> {
  const me = await requireFinance();
  if (!me) return { ok: false, error: "Not permitted" };

  const supabase = await createClient();
  const { data: inv } = await supabase
    .from("invoices")
    .select("total_chf,status,payment_reference")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found" };
  if (inv.status === "paid") return { ok: false, error: "Already paid" };
  if (inv.status === "cancelled") return { ok: false, error: "Invoice was cancelled" };

  const { data: pays } = await supabase.from("payments").select("amount_chf,status").eq("invoice_id", invoiceId).eq("status", "succeeded");
  const paid = (pays ?? []).reduce((s, p) => s + Number(p.amount_chf ?? 0), 0);
  const balance = Number(inv.total_chf ?? 0) - paid;
  if (balance <= 0) return { ok: false, error: "Nothing outstanding" };

  const { error } = await supabase.rpc("record_manual_payment", {
    p_invoice: invoiceId,
    p_amount: balance,
    p_method: method,
    p_reference: inv.payment_reference ?? undefined,
    p_note: "Reconciled — marked paid",
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/invoices/${invoiceId}`);
  revalidatePath("/admin/invoices/reconcile");
  revalidatePath("/admin/invoices");
  return { ok: true };
}
