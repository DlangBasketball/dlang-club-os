import "server-only";
import { createClient } from "@/lib/supabase/server";
import { normalizeCurrency } from "./currency";

export type PayableInvoice =
  | { ok: true; id: string; orgId: string; number: string; currency: string; total: number; paid: number; balance: number }
  | { ok: false; error: string };

/**
 * Loads an invoice through the caller's session (RLS decides visibility) and
 * computes the outstanding balance against the amount due (total plus
 * credit / debit notes). Refund rows (negative, status refunded /
 * partially_refunded) reduce the paid amount, matching public.invoice_net_paid().
 */
export async function loadPayableInvoice(invoiceId: string): Promise<PayableInvoice> {
  const supabase = await createClient();
  const { data: inv } = await supabase
    .from("invoices")
    .select("id,org_id,number,total_chf,adjustments_total,currency,status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return { ok: false, error: "Invoice not found" };
  if (inv.status === "paid") return { ok: false, error: "This invoice is already paid" };
  if (inv.status === "cancelled" || inv.status === "void") return { ok: false, error: "This invoice was cancelled" };
  if (inv.status === "written_off") return { ok: false, error: "Nothing left to pay" };

  const { data: pays } = await supabase
    .from("payments")
    .select("amount_chf,status")
    .eq("invoice_id", invoiceId)
    .in("status", ["succeeded", "refunded", "partially_refunded"]);
  const paid = (pays ?? []).reduce((s, p) => {
    const a = Number(p.amount_chf ?? 0);
    return p.status === "succeeded" || a < 0 ? s + a : s;
  }, 0);
  // Amount due = issued total + credit / debit notes (invoice_adjustments).
  const total = Number(inv.total_chf ?? 0) + Number(inv.adjustments_total ?? 0);
  const balance = Math.round((total - paid) * 1000) / 1000;
  if (balance <= 0) return { ok: false, error: "Nothing left to pay" };

  return {
    ok: true,
    id: inv.id,
    orgId: inv.org_id,
    number: inv.number,
    currency: normalizeCurrency(inv.currency ?? "CHF"),
    total,
    paid,
    balance,
  };
}
