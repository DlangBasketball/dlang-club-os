import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { PaymentLike } from "@/lib/payments/adjustments";
import { OPEN_INVOICE_STATUSES, openInvoices, type OpenInvoice } from "@/lib/payments/open-invoices";

type Db = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;
export type Result<T> = { data: T; error: null } | { data: null; error: string };

const PAGE = 1000; // PostgREST caps a response at ~1000 rows
const CHUNK = 100; // invoices per payments query (URL length; stays under the row cap)

/**
 * The open invoices of the caller's club (RLS scopes the rows; a family filter
 * narrows them) with their real balances. Pages through every row instead of
 * stopping at the server's response cap, so counts and totals stay right for
 * large clubs.
 */
export async function loadOpenInvoices(db: Db, opts: { familyId?: string; orgId?: string } = {}): Promise<Result<OpenInvoice[]>> {
  type Row = {
    id: string; family_id: string | null; status: string; due_date: string | null; currency: string | null; total_chf: number | null;
    adjustments_total: number | null; activity: string | null;
  };
  const rows: Row[] = [];
  for (let from = 0; from < 100_000; from += PAGE) {
    let q = db
      .from("invoices")
      .select("id,family_id,status,due_date,currency,total_chf,adjustments_total,activity")
      .in("status", [...OPEN_INVOICE_STATUSES])
      .order("id")
      .range(from, from + PAGE - 1);
    if (opts.familyId) q = q.eq("family_id", opts.familyId);
    // Required with the service-role client (no RLS): scope to the club explicitly.
    if (opts.orgId) q = q.eq("org_id", opts.orgId);
    const { data, error } = await q;
    if (error) return { data: null, error: error.message };
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }

  const pays = new Map<string, PaymentLike[]>();
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db
      .from("payments")
      .select("invoice_id,amount_chf,status")
      .in("invoice_id", ids.slice(i, i + CHUNK))
      .in("status", ["succeeded", "refunded", "partially_refunded"]);
    if (error) return { data: null, error: error.message };
    for (const p of data ?? []) {
      const arr = pays.get(p.invoice_id) ?? [];
      arr.push({ amount: Number(p.amount_chf ?? 0), status: p.status });
      pays.set(p.invoice_id, arr);
    }
  }

  return {
    data: openInvoices(
      rows.map((r) => ({
        id: r.id, familyId: r.family_id, status: r.status, dueDate: r.due_date, currency: r.currency, total: r.total_chf,
        adjustmentsTotal: r.adjustments_total, activity: r.activity,
      })),
      pays,
    ),
    error: null,
  };
}
