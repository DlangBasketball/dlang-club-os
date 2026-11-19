import { createClient } from "@/lib/supabase/server";
import { formatQrReference } from "@/lib/swiss-payments";
import { invoiceMoney, netPaid } from "@/lib/payments/adjustments";

export type Result<T> = { data: T; error: null } | { data: null; error: string };

export type AwaitingItem = {
  id: string;
  number: string;
  familyName: string;
  reference: string;
  total: number;
  paid: number;
  balance: number;
  currency: string;
  status: string;
  dueDate: string | null;
};

const AWAIT: ("sent" | "partially_paid" | "overdue")[] = ["sent", "partially_paid", "overdue"];

/** Invoices awaiting payment, with their structured reference for reconciliation. */
export async function listAwaitingPayment(): Promise<Result<AwaitingItem[]>> {
  const supabase = await createClient();
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("id,number,family_id,total_chf,adjustments_total,currency,status,due_date,payment_reference")
    .in("status", AWAIT)
    .order("due_date", { ascending: true })
    .limit(300);
  if (error) return { data: null, error: error.message };

  const ids = (invoices ?? []).map((i) => i.id);
  const familyIds = Array.from(new Set((invoices ?? []).map((i) => i.family_id)));
  const [payRes, famRes] = await Promise.all([
    ids.length ? supabase.from("payments").select("invoice_id,amount_chf,status").in("invoice_id", ids).in("status", ["succeeded", "refunded", "partially_refunded"]) : Promise.resolve({ data: [] as { invoice_id: string; amount_chf: number; status: string }[] }),
    familyIds.length ? supabase.from("families").select("id,name").in("id", familyIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const paysBy = new Map<string, { amount: number; status: string }[]>();
  for (const p of payRes.data ?? []) {
    const arr = paysBy.get(p.invoice_id) ?? [];
    arr.push({ amount: Number(p.amount_chf ?? 0), status: p.status });
    paysBy.set(p.invoice_id, arr);
  }
  const fName = new Map((famRes.data ?? []).map((f) => [f.id, f.name]));

  return {
    data: (invoices ?? [])
      .map((i) => {
        // Amount due includes credit / debit notes (invoice_adjustments).
        const currency = (i.currency ?? "CHF").toUpperCase();
        const m = invoiceMoney({
          total: Number(i.total_chf ?? 0),
          adjustmentsTotal: Number(i.adjustments_total ?? 0),
          paid: netPaid(paysBy.get(i.id) ?? [], currency),
          currency,
        });
        return {
          id: i.id,
          number: i.number,
          familyName: fName.get(i.family_id) ?? "—",
          reference: formatQrReference(i.payment_reference ?? ""),
          total: m.amountDue,
          paid: m.paid,
          balance: m.balance,
          currency,
          status: i.status,
          dueDate: i.due_date,
        };
      })
      .filter((i) => i.balance > 0),
    error: null,
  };
}
