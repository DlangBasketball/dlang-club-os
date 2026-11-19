import { createClient } from "@/lib/supabase/server";

export type Result<T> = { data: T; error: null } | { data: null; error: string };

export type PaymentRow = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  method: string;
  status: string;
  amount: number;
  currency: string;
  at: string;
  reference: string | null;
  notes: string | null;
  methodDetail: string | null;
  isStripe: boolean;
  voidedAt: string | null;
  isReversal: boolean;
  adminNote: string | null;
  /** Manual, active receipt: finance may void it. */
  canVoid: boolean;
  /** Plain manual receipt: finance may edit / re-allocate it. */
  canEdit: boolean;
};

export const PAYMENT_FILTERS = ["all", "succeeded", "pending", "failed", "refunded"] as const;
export type PaymentFilter = (typeof PAYMENT_FILTERS)[number];

/** The org's payments, newest first. RLS (finance of the current org) scopes the rows. */
export async function listPayments(filter: PaymentFilter = "all"): Promise<Result<PaymentRow[]>> {
  const supabase = await createClient();
  let q = supabase
    .from("payments")
    .select("id,invoice_id,method,status,amount_chf,currency,paid_at,created_at,qr_reference,notes,method_detail,stripe_payment_intent_id,stripe_charge_id,stripe_refund_id,stripe_account_id,voided_at,reverses_payment_id,admin_note")
    .order("created_at", { ascending: false })
    .limit(300);
  if (filter === "refunded") q = q.in("status", ["refunded", "partially_refunded"]);
  else if (filter !== "all") q = q.eq("status", filter);
  const { data, error } = await q;
  if (error) return { data: null, error: error.message };

  const ids = Array.from(new Set((data ?? []).map((p) => p.invoice_id)));
  const { data: invs } = ids.length
    ? await supabase.from("invoices").select("id,number").in("id", ids)
    : { data: [] as { id: string; number: string }[] };
  const num = new Map((invs ?? []).map((i) => [i.id, i.number]));

  return {
    data: (data ?? []).map((p) => {
      const isStripe = Boolean(p.stripe_payment_intent_id || p.stripe_charge_id || p.stripe_refund_id || p.stripe_account_id);
      const amount = Number(p.amount_chf ?? 0);
      const canVoid = !isStripe && p.status === "succeeded" && !p.voided_at && !p.reverses_payment_id;
      return {
        id: p.id,
        invoiceId: p.invoice_id,
        invoiceNumber: num.get(p.invoice_id) ?? "—",
        method: p.method,
        status: p.status,
        amount,
        currency: (p.currency ?? "CHF").toUpperCase(),
        at: p.paid_at ?? p.created_at,
        reference: p.qr_reference ?? null,
        notes: p.notes ?? null,
        methodDetail: p.method_detail ?? null,
        isStripe,
        voidedAt: p.voided_at ?? null,
        isReversal: Boolean(p.reverses_payment_id),
        adminNote: p.admin_note ?? null,
        canVoid,
        canEdit: canVoid && amount > 0 && !["family_credit", "to_family_credit", "reversal"].includes(p.method_detail ?? ""),
      };
    }),
    error: null,
  };
}

/** Sum of succeeded payments per currency (never mixes currencies). */
export function collectedByCurrency(rows: PaymentRow[]): { currency: string; amount: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) if (r.status === "succeeded") by.set(r.currency, (by.get(r.currency) ?? 0) + r.amount);
  return Array.from(by, ([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }));
}
