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

/** One page of the org's payments, newest first. RLS (finance of the current org) scopes the rows. */
export async function listPayments(filter: PaymentFilter = "all", page = 1, pageSize = 100): Promise<Result<PaymentRow[]> & { hasMore?: boolean }> {
  const size = Math.min(Math.max(pageSize, 1), 999);
  const from = (Math.max(1, Math.floor(page)) - 1) * size;
  const supabase = await createClient();
  let q = supabase
    .from("payments")
    .select("id,invoice_id,method,status,amount_chf,currency,paid_at,created_at,qr_reference,notes,method_detail,stripe_payment_intent_id,stripe_charge_id,stripe_refund_id,stripe_account_id,voided_at,reverses_payment_id,admin_note")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    // Paged (one probe row tells whether there is a next page) instead of a
    // hard 300-row cut that made older payments unreachable.
    .range(from, from + size);
  if (filter === "refunded") q = q.in("status", ["refunded", "partially_refunded"]);
  else if (filter !== "all") q = q.eq("status", filter);
  const { data: all, error } = await q;
  if (error) return { data: null, error: error.message };
  const hasMore = (all ?? []).length > size;
  const data = (all ?? []).slice(0, size);

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
    hasMore,
  };
}

/**
 * Succeeded payments of the whole club per currency (the "Total collected"
 * line), paged through every row: summing only the rows shown on the page
 * under-reported it once a club had more payments than one page.
 */
export async function collectedTotals(): Promise<Result<{ currency: string; amount: number }[]>> {
  const supabase = await createClient();
  const rows: Pick<PaymentRow, "status" | "amount" | "currency">[] = [];
  for (let from = 0; from < 1_000_000; from += 1000) {
    const { data, error } = await supabase.from("payments").select("id,amount_chf,currency,status").eq("status", "succeeded").order("id").range(from, from + 999);
    if (error) return { data: null, error: error.message };
    for (const p of data ?? []) rows.push({ status: p.status, amount: Number(p.amount_chf ?? 0), currency: (p.currency ?? "CHF").toUpperCase() });
    if (!data || data.length < 1000) break;
  }
  return { data: collectedByCurrency(rows), error: null };
}

/** Sum of succeeded payments per currency (never mixes currencies). */
export function collectedByCurrency(rows: Pick<PaymentRow, "status" | "amount" | "currency">[]): { currency: string; amount: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) if (r.status === "succeeded") by.set(r.currency, (by.get(r.currency) ?? 0) + r.amount);
  return Array.from(by, ([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }));
}
