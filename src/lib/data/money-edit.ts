import "server-only";
import { createClient } from "@/lib/supabase/server";
import { creditBalance, invoiceMoney, netPaid } from "@/lib/payments/adjustments";

/*
 * Reads for the money-editing screens (invoice edit, payment corrections,
 * family credit, training-credit ledger). Session client only: RLS scopes
 * every row to the caller's org (finance) or own family (guardian).
 */
export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(data: T): Result<T> => ({ data, error: null });
const fail = (error: string): Result<never> => ({ data: null, error });

export type DraftEditData = {
  id: string;
  number: string;
  status: string;
  familyId: string;
  description: string;
  dueDate: string;
  notes: string;
  locale: string;
  currency: string;
  taxRate: number;
  taxInclusive: boolean;
  reference: string | null;
  items: { description: string; quantity: number; unitPrice: number }[];
};

/** The invoice as the edit form needs it (draft editor or safe-edit form). */
export async function getInvoiceForEdit(id: string): Promise<Result<DraftEditData | null>> {
  const supabase = await createClient();
  const { data: inv, error } = await supabase
    .from("invoices")
    .select("id,number,status,family_id,description,due_date,notes,locale,currency,tax_rate,tax_inclusive,payment_reference")
    .eq("id", id)
    .maybeSingle();
  if (error) return fail(error.message);
  if (!inv) return ok(null);
  const { data: items } = await supabase
    .from("invoice_items")
    .select("description,quantity,unit_price_chf")
    .eq("invoice_id", id)
    .order("created_at");
  return ok({
    id: inv.id,
    number: inv.number,
    status: inv.status,
    familyId: inv.family_id,
    description: inv.description ?? "",
    dueDate: inv.due_date ?? "",
    notes: inv.notes ?? "",
    locale: inv.locale ?? "",
    currency: (inv.currency ?? "CHF").toUpperCase(),
    taxRate: Number(inv.tax_rate ?? 0),
    taxInclusive: inv.tax_inclusive ?? true,
    reference: inv.payment_reference ?? null,
    items: (items ?? []).map((it) => ({
      description: it.description,
      quantity: Number(it.quantity ?? 1),
      unitPrice: Number(it.unit_price_chf ?? 0),
    })),
  });
}

/** Families of the caller's org (recipient picker). */
export async function listFamilyOptions(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("families").select("id,name").order("name").limit(1000);
  return (data ?? []).map((f) => ({ id: f.id, name: f.name }));
}

export type ReallocationTarget = { id: string; number: string; familyName: string; outstanding: number; currency: string };

/** Open invoices in a currency a manual payment can be moved to. */
export async function listReallocationTargets(currency: string, excludeInvoiceId?: string): Promise<ReallocationTarget[]> {
  const supabase = await createClient();
  const cur = currency.toUpperCase();
  const { data: invs } = await supabase
    .from("invoices")
    .select("id,number,family_id,total_chf,adjustments_total,currency,status")
    .eq("currency", cur)
    .in("status", ["sent", "partially_paid", "overdue"])
    .order("issued_at", { ascending: false })
    .limit(300);
  const rows = (invs ?? []).filter((i) => i.id !== excludeInvoiceId);
  if (!rows.length) return [];
  const ids = rows.map((i) => i.id);
  const famIds = Array.from(new Set(rows.map((i) => i.family_id)));
  const [pays, fams] = await Promise.all([
    supabase.from("payments").select("invoice_id,amount_chf,status").in("invoice_id", ids).in("status", ["succeeded", "refunded", "partially_refunded"]),
    supabase.from("families").select("id,name").in("id", famIds),
  ]);
  const byInv = new Map<string, { amount: number; status: string }[]>();
  for (const p of pays.data ?? []) {
    const arr = byInv.get(p.invoice_id) ?? [];
    arr.push({ amount: Number(p.amount_chf ?? 0), status: p.status });
    byInv.set(p.invoice_id, arr);
  }
  const fName = new Map((fams.data ?? []).map((f) => [f.id, f.name]));
  return rows.map((i) => ({
    id: i.id,
    number: i.number,
    familyName: fName.get(i.family_id) ?? "—",
    currency: cur,
    outstanding: invoiceMoney({
      total: Number(i.total_chf ?? 0),
      adjustmentsTotal: Number(i.adjustments_total ?? 0),
      paid: netPaid(byInv.get(i.id) ?? [], cur),
      currency: cur,
    }).outstanding,
  }));
}

/** Family money-credit balance in one currency. */
export async function getFamilyCreditBalance(familyId: string, currency: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("family_credit_entries")
    .select("amount,currency")
    .eq("family_id", familyId)
    .eq("currency", currency.toUpperCase());
  return creditBalance((data ?? []).map((e) => ({ amount: Number(e.amount ?? 0), currency: e.currency })), currency);
}

export type FamilyCreditRow = { familyId: string; familyName: string; currency: string; balance: number; lastAt: string };

/** Every family with a non-zero credit balance (credits page). */
export async function listFamilyCredits(): Promise<Result<FamilyCreditRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("family_credit_entries")
    .select("family_id,amount,currency,created_at")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) return fail(error.message);
  const by = new Map<string, { familyId: string; currency: string; entries: { amount: number; currency: string }[]; lastAt: string }>();
  for (const e of data ?? []) {
    const key = `${e.family_id}:${e.currency}`;
    const row = by.get(key) ?? { familyId: e.family_id, currency: e.currency, entries: [], lastAt: e.created_at };
    row.entries.push({ amount: Number(e.amount ?? 0), currency: e.currency });
    by.set(key, row);
  }
  const famIds = Array.from(new Set(Array.from(by.values()).map((r) => r.familyId)));
  const { data: fams } = famIds.length ? await supabase.from("families").select("id,name").in("id", famIds) : { data: [] as { id: string; name: string }[] };
  const fName = new Map((fams ?? []).map((f) => [f.id, f.name]));
  return ok(
    Array.from(by.values())
      .map((r) => ({ familyId: r.familyId, familyName: fName.get(r.familyId) ?? "—", currency: r.currency, balance: creditBalance(r.entries, r.currency), lastAt: r.lastAt }))
      .filter((r) => r.balance !== 0)
      .sort((a, b) => a.familyName.localeCompare(b.familyName)),
  );
}

export type CreditTotalsRow = {
  athleteId: string;
  name: string;
  totals: Record<"personal" | "nutrition" | "mental", { total: number; used: number }>;
};

/** Per-athlete training-credit totals and usage (adjust dialog). */
export async function listTrainingCreditTotals(): Promise<Result<CreditTotalsRow[]>> {
  const supabase = await createClient();
  const { data: athletes, error } = await supabase.from("athletes").select("id,first_name,last_name").order("first_name").limit(2000);
  if (error) return fail(error.message);
  const ids = (athletes ?? []).map((a) => a.id);
  const { data: credits } = ids.length
    ? await supabase.from("training_credits").select("athlete_id,credit_category,total_credits,used_credits").in("athlete_id", ids)
    : { data: [] as { athlete_id: string; credit_category: string; total_credits: number; used_credits: number }[] };
  const empty = () => ({ personal: { total: 0, used: 0 }, nutrition: { total: 0, used: 0 }, mental: { total: 0, used: 0 } });
  const by = new Map<string, CreditTotalsRow["totals"]>();
  for (const c of credits ?? []) {
    const e = by.get(c.athlete_id) ?? empty();
    if (c.credit_category === "personal" || c.credit_category === "nutrition" || c.credit_category === "mental") {
      e[c.credit_category] = { total: Number(c.total_credits ?? 0), used: Number(c.used_credits ?? 0) };
    }
    by.set(c.athlete_id, e);
  }
  return ok((athletes ?? []).map((a) => ({ athleteId: a.id, name: `${a.first_name} ${a.last_name}`, totals: by.get(a.id) ?? empty() })));
}

export type CreditLedgerRow = {
  id: string;
  athleteName: string;
  category: string;
  kind: string;
  delta: number;
  totalBefore: number;
  totalAfter: number;
  reason: string;
  at: string;
};

/** Latest training-credit changes with reasons (finance / admin only by RLS). */
export async function listTrainingCreditLedger(limit = 50): Promise<Result<CreditLedgerRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_credit_adjustments")
    .select("id,athlete_id,credit_category,kind,delta,total_before,total_after,reason,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return fail(error.message);
  const ids = Array.from(new Set((data ?? []).map((r) => r.athlete_id)));
  const { data: ath } = ids.length ? await supabase.from("athletes").select("id,first_name,last_name").in("id", ids) : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const name = new Map((ath ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`]));
  return ok(
    (data ?? []).map((r) => ({
      id: r.id,
      athleteName: name.get(r.athlete_id) ?? "—",
      category: r.credit_category,
      kind: r.kind,
      delta: r.delta,
      totalBefore: r.total_before,
      totalAfter: r.total_after,
      reason: r.reason,
      at: r.created_at,
    })),
  );
}
