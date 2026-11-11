import { createClient } from "@/lib/supabase/server";

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(data: T): Result<T> => ({ data, error: null });
const fail = (error: string): Result<never> => ({ data: null, error });
const uniq = (ids: (string | null | undefined)[]) =>
  Array.from(new Set(ids.filter((x): x is string => Boolean(x))));

export type InvoiceListItem = {
  id: string;
  number: string;
  familyName: string;
  total: number;
  paid: number;
  balance: number;
  status: string;
  dueDate: string | null;
  issuedAt: string;
};

export async function listInvoices(statusFilter?: string): Promise<Result<InvoiceListItem[]>> {
  const supabase = await createClient();
  let q = supabase
    .from("invoices")
    .select("id,number,family_id,total_chf,status,due_date,issued_at")
    .order("issued_at", { ascending: false })
    .limit(300);
  if (statusFilter && statusFilter !== "all") q = q.eq("status", statusFilter as never);
  const { data: invoices, error } = await q;
  if (error) return fail(error.message);

  const ids = uniq((invoices ?? []).map((i) => i.id));
  const familyIds = uniq((invoices ?? []).map((i) => i.family_id));
  const [payments, families] = await Promise.all([
    ids.length
      ? supabase.from("payments").select("invoice_id,amount_chf,status").in("invoice_id", ids).eq("status", "succeeded")
      : Promise.resolve({ data: [] as { invoice_id: string; amount_chf: number; status: string }[] }),
    familyIds.length
      ? supabase.from("families").select("id,name").in("id", familyIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const paidByInvoice = new Map<string, number>();
  for (const p of payments.data ?? [])
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount_chf ?? 0));
  const fName = new Map((families.data ?? []).map((f) => [f.id, f.name]));

  return ok(
    (invoices ?? []).map((i) => {
      const total = Number(i.total_chf ?? 0);
      const paid = paidByInvoice.get(i.id) ?? 0;
      return {
        id: i.id,
        number: i.number,
        familyName: fName.get(i.family_id) ?? "—",
        total,
        paid,
        balance: total - paid,
        status: i.status,
        dueDate: i.due_date,
        issuedAt: i.issued_at,
      };
    }),
  );
}

export type InvoiceItem = { id: string; description: string; quantity: number; unitPrice: number; amount: number };
export type InvoicePayment = {
  id: string;
  amount: number;
  method: string;
  status: string;
  reference: string | null;
  paidAt: string | null;
  recordedBy: string | null;
  notes: string | null;
};
export type InvoiceAuditEntry = { id: number; action: string; actorId: string | null; at: string; table: string | null };
export type InvoiceDetail = {
  id: string;
  orgId: string;
  number: string;
  reference: string | null;
  status: string;
  description: string | null;
  total: number;
  paid: number;
  balance: number;
  dueDate: string | null;
  issuedAt: string;
  paidAt: string | null;
  family: { id: string; name: string; contactName: string | null; contactEmail: string | null };
  programName: string | null;
  items: InvoiceItem[];
  payments: InvoicePayment[];
  audit: InvoiceAuditEntry[];
};

export async function getInvoiceDetail(id: string): Promise<Result<InvoiceDetail | null>> {
  const supabase = await createClient();
  const { data: inv, error } = await supabase
    .from("invoices")
    .select("id,number,status,description,total_chf,due_date,issued_at,paid_at,family_id,program_id,org_id,payment_reference")
    .eq("id", id)
    .maybeSingle();
  if (error) return fail(error.message);
  if (!inv) return ok(null);

  const [itemsRes, paymentsRes, familyRes, programRes, invAudit, payAudit] = await Promise.all([
    supabase.from("invoice_items").select("id,description,quantity,unit_price_chf,amount_chf").eq("invoice_id", id).order("created_at"),
    supabase.from("payments").select("id,amount_chf,method,status,qr_reference,paid_at,recorded_by,notes").eq("invoice_id", id).order("created_at", { ascending: false }),
    supabase.from("families").select("id,name,contact_name,contact_email").eq("id", inv.family_id).maybeSingle(),
    inv.program_id ? supabase.from("programs").select("name").eq("id", inv.program_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("audit_logs").select("id,action,actor_id,created_at,target_table").eq("target_id", id).order("created_at", { ascending: false }).limit(30),
    supabase.from("audit_logs").select("id,action,actor_id,created_at,target_table,new_data").in("action", ["PAYMENT_RECORDED", "STRIPE_PAYMENT"]).order("created_at", { ascending: false }).limit(60),
  ]);

  const total = Number(inv.total_chf ?? 0);
  const paid = (paymentsRes.data ?? [])
    .filter((p) => p.status === "succeeded")
    .reduce((s, p) => s + Number(p.amount_chf ?? 0), 0);

  const audit: InvoiceAuditEntry[] = [
    ...(invAudit.data ?? []).map((a) => ({ id: a.id, action: a.action, actorId: a.actor_id, at: a.created_at, table: a.target_table })),
    ...(payAudit.data ?? [])
      .filter((a) => (a.new_data as Record<string, unknown> | null)?.invoice_id === id)
      .map((a) => ({ id: a.id, action: a.action, actorId: a.actor_id, at: a.created_at, table: a.target_table })),
  ].sort((x, y) => y.at.localeCompare(x.at));

  return ok({
    id: inv.id,
    orgId: inv.org_id,
    number: inv.number,
    reference: inv.payment_reference,
    status: inv.status,
    description: inv.description,
    total,
    paid,
    balance: total - paid,
    dueDate: inv.due_date,
    issuedAt: inv.issued_at,
    paidAt: inv.paid_at,
    family: {
      id: familyRes.data?.id ?? inv.family_id,
      name: familyRes.data?.name ?? "—",
      contactName: familyRes.data?.contact_name ?? null,
      contactEmail: familyRes.data?.contact_email ?? null,
    },
    programName: (programRes.data as { name?: string } | null)?.name ?? null,
    items: (itemsRes.data ?? []).map((it) => ({
      id: it.id,
      description: it.description,
      quantity: Number(it.quantity ?? 1),
      unitPrice: Number(it.unit_price_chf ?? 0),
      amount: Number(it.amount_chf ?? 0),
    })),
    payments: (paymentsRes.data ?? []).map((p) => ({
      id: p.id,
      amount: Number(p.amount_chf ?? 0),
      method: p.method,
      status: p.status,
      reference: p.qr_reference,
      paidAt: p.paid_at,
      recordedBy: p.recorded_by,
      notes: p.notes,
    })),
    audit,
  });
}
