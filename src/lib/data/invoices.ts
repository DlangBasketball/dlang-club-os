import { createClient } from "@/lib/supabase/server";
import { invoiceMoney, netPaid } from "@/lib/payments/adjustments";

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(data: T): Result<T> => ({ data, error: null });
const fail = (error: string): Result<never> => ({ data: null, error });
const uniq = (ids: (string | null | undefined)[]) =>
  Array.from(new Set(ids.filter((x): x is string => Boolean(x))));

export type InvoiceListItem = {
  id: string;
  number: string;
  familyName: string;
  /** Issued total (never changes once issued). */
  total: number;
  /** Total + credit / debit notes (invoice_adjustments). */
  amountDue: number;
  paid: number;
  /** amountDue − paid (negative when overpaid). */
  balance: number;
  overpaid: number;
  currency: string;
  status: string;
  dueDate: string | null;
  issuedAt: string;
  remindersPaused: boolean;
  /** Revenue category (invoices.activity). */
  category: string;
  /** Selection invoices: the programme series (e.g. "EYBL"); null otherwise. */
  categoryLabel: string | null;
  /** Issuing entity name (snapshot taken at issue). */
  entityName: string | null;
  /** What the invoice is for, as printed. */
  sourceLabel: string | null;
  /** Individual payer of a membership share (guardian / sponsor / other). */
  payerName: string | null;
};

export type InvoiceFilter = {
  /** all | open | overdue | an invoice_status. */
  status?: string;
  familyId?: string;
  /** Invoice number or family name. */
  q?: string;
  /** 1-based page. */
  page?: number;
  pageSize?: number;
  /** "YYYY-MM-DD" in the club's time zone (past-due check for the overdue filter). */
  todayKey?: string;
  /** Revenue category (invoices.activity). */
  category?: string;
  /** Issuing entity (invoices.billing_entity_id). */
  entityId?: string;
  /** Issued at >= / < these instants (ISO; club-local day bounds computed by the caller). */
  issuedFrom?: string;
  issuedBefore?: string;
};

export type InvoicePage = { rows: InvoiceListItem[]; hasMore: boolean; page: number };

const OPEN_LIST = "pending,sent,partially_paid";
const UUID = /^[0-9a-f-]{36}$/i;
const KNOWN_STATUSES = new Set(["draft", "pending", "sent", "partially_paid", "paid", "overdue", "void", "refunded", "cancelled", "written_off"]);

/**
 * One page of the club's invoices (RLS scopes the rows), newest first, with
 * filters: status (incl. "open" = still owed and "overdue" = flagged overdue
 * OR open and past its due date, like the dashboard), family and a search on
 * the invoice number or family name. Older invoices stay reachable through
 * paging instead of being cut off at a fixed row limit.
 */
export async function findInvoices(filter: InvoiceFilter = {}): Promise<Result<InvoicePage>> {
  const supabase = await createClient();
  const pageSize = Math.min(Math.max(filter.pageSize ?? 100, 1), 999); // +1 probe row stays within the 1000-row response cap
  const page = Math.max(1, Math.floor(filter.page ?? 1));
  const from = (page - 1) * pageSize;
  const today = filter.todayKey && /^\d{4}-\d{2}-\d{2}$/.test(filter.todayKey) ? filter.todayKey : new Date().toISOString().slice(0, 10);
  let q = supabase
    .from("invoices")
    .select("id,number,family_id,total_chf,adjustments_total,currency,status,due_date,issued_at,reminders_paused,activity,program_id,billing_entity_snapshot,source_label,payer_name")
    .order("issued_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + pageSize); // one extra row tells whether there is a next page
  const status = filter.status ?? "all";
  if (status === "open") q = q.in("status", ["pending", "sent", "partially_paid", "overdue"]);
  else if (status === "overdue") q = q.or(`status.eq.overdue,and(status.in.(${OPEN_LIST}),due_date.lt.${today})`);
  else if (status !== "all" && KNOWN_STATUSES.has(status)) q = q.eq("status", status as never);
  if (filter.familyId && UUID.test(filter.familyId)) q = q.eq("family_id", filter.familyId);
  if (filter.category && /^[a-z_]{2,40}$/.test(filter.category)) q = q.eq("activity", filter.category as never);
  if (filter.entityId && UUID.test(filter.entityId)) q = q.eq("billing_entity_id", filter.entityId);
  if (filter.issuedFrom && !Number.isNaN(Date.parse(filter.issuedFrom))) q = q.gte("issued_at", filter.issuedFrom);
  if (filter.issuedBefore && !Number.isNaN(Date.parse(filter.issuedBefore))) q = q.lt("issued_at", filter.issuedBefore);
  const term = (filter.q ?? "").trim().replace(/[%,()*\\]/g, " ").trim().slice(0, 80);
  if (term) {
    const { data: fams, error: famErr } = await supabase.from("families").select("id").ilike("name", `%${term}%`).limit(200);
    if (famErr) return fail(famErr.message);
    const ids = (fams ?? []).map((f) => f.id);
    q = ids.length ? q.or(`number.ilike.%${term}%,family_id.in.(${ids.join(",")})`) : q.ilike("number", `%${term}%`);
  }
  const { data: invoices, error } = await q;
  if (error) return fail(error.message);
  const hasMore = (invoices ?? []).length > pageSize;
  const pageRows = (invoices ?? []).slice(0, pageSize);
  const rows = await withMoney(supabase, pageRows);
  if (rows.error !== null) return fail(rows.error);
  return ok({ rows: rows.data, hasMore, page });
}

type InvoiceRow = {
  id: string; number: string; family_id: string; total_chf: number | null; adjustments_total: number | null; currency: string | null; status: string;
  due_date: string | null; issued_at: string; reminders_paused: boolean | null; activity?: string | null; program_id?: string | null;
  billing_entity_snapshot?: unknown; source_label?: string | null; payer_name?: string | null;
};

async function withMoney(supabase: Awaited<ReturnType<typeof createClient>>, invoices: InvoiceRow[]): Promise<Result<InvoiceListItem[]>> {
  const ids = uniq(invoices.map((i) => i.id));
  const familyIds = uniq(invoices.map((i) => i.family_id));
  const paysByInvoice = new Map<string, { amount: number; status: string }[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("payments").select("invoice_id,amount_chf,status").in("invoice_id", ids.slice(i, i + 200)).in("status", ["succeeded", "refunded", "partially_refunded"]);
    if (error) return fail(error.message);
    // Net paid as public.invoice_net_paid(): succeeded rows (incl. reversals and
    // credit transfers) plus negative refund rows.
    for (const p of data ?? []) {
      const arr = paysByInvoice.get(p.invoice_id) ?? [];
      arr.push({ amount: Number(p.amount_chf ?? 0), status: p.status });
      paysByInvoice.set(p.invoice_id, arr);
    }
  }
  const seriesIds = uniq(invoices.filter((i) => i.activity === "selection").map((i) => i.program_id));
  const series = new Map<string, string>();
  for (let i = 0; i < seriesIds.length; i += 200) {
    const { data, error } = await supabase.from("programs").select("id,name,series").in("id", seriesIds.slice(i, i + 200));
    if (error) return fail(error.message);
    for (const p of (data ?? []) as unknown as { id: string; name: string; series: string | null }[]) series.set(p.id, p.series?.trim() || p.name);
  }
  const fName = new Map<string, string>();
  for (let i = 0; i < familyIds.length; i += 200) {
    const { data, error } = await supabase.from("families").select("id,name").in("id", familyIds.slice(i, i + 200));
    if (error) return fail(error.message);
    for (const f of data ?? []) fName.set(f.id, f.name);
  }

  return ok(
    invoices.map((i) => {
      const currency = (i.currency ?? "CHF").toUpperCase();
      const m = invoiceMoney({
        total: Number(i.total_chf ?? 0),
        adjustmentsTotal: Number(i.adjustments_total ?? 0),
        paid: netPaid(paysByInvoice.get(i.id) ?? [], currency),
        currency,
      });
      return {
        id: i.id,
        number: i.number,
        familyName: fName.get(i.family_id) ?? "—",
        total: m.total,
        amountDue: m.amountDue,
        paid: m.paid,
        balance: m.balance,
        overpaid: m.overpaid,
        currency,
        status: i.status,
        dueDate: i.due_date,
        issuedAt: i.issued_at,
        remindersPaused: Boolean(i.reminders_paused),
        category: i.activity ?? "other",
        categoryLabel: i.activity === "selection" && i.program_id ? series.get(i.program_id) ?? null : null,
        entityName: ((i.billing_entity_snapshot ?? null) as { name?: string } | null)?.name ?? null,
        sourceLabel: i.source_label ?? null,
        payerName: i.payer_name ?? null,
      };
    }),
  );
}

/** First page of invoices (parent app and legacy callers). */
export async function listInvoices(statusFilter?: string): Promise<Result<InvoiceListItem[]>> {
  const r = await findInvoices({ status: statusFilter, pageSize: 300 });
  return r.error !== null ? fail(r.error) : ok(r.data.rows);
}

/** Every invoice the caller can see (CSV export): pages through all of them. */
export async function listAllInvoices(): Promise<Result<InvoiceListItem[]>> {
  const out: InvoiceListItem[] = [];
  for (let page = 1; page <= 200; page++) {
    const r = await findInvoices({ status: "all", page, pageSize: 999 });
    if (r.error !== null) return fail(r.error);
    out.push(...r.data.rows);
    if (!r.data.hasMore) break;
  }
  return ok(out);
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
  /** 'family_credit' | 'to_family_credit' | 'reversal' | card brand … */
  methodDetail: string | null;
  /** Came from Stripe (card / TWINT / SEPA online): annotate only. */
  isStripe: boolean;
  voidedAt: string | null;
  voidReason: string | null;
  reversesPaymentId: string | null;
  replacedByPaymentId: string | null;
  adminNote: string | null;
  /** Finance may void it (manual, active, not a reversal). */
  canVoid: boolean;
  /** Finance may edit / re-allocate it (plain manual receipt). */
  canEdit: boolean;
};
export type InvoiceAdjustment = {
  id: string;
  number: string;
  kind: "credit_note" | "debit_note" | "write_off" | "cancellation";
  amount: number;
  taxAmount: number;
  description: string | null;
  reason: string;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
};
export type InvoiceAuditEntry = { id: number; action: string; actorId: string | null; at: string; table: string | null };
export type InvoiceDetail = {
  id: string;
  orgId: string;
  number: string;
  reference: string | null;
  status: string;
  description: string | null;
  /** Issued total (line items, incl. tax). */
  total: number;
  /** Sum of active credit / debit notes, write-offs, cancellations (signed). */
  adjustmentsTotal: number;
  /** total + adjustmentsTotal: what the family owes before payments. */
  amountDue: number;
  paid: number;
  /** amountDue − paid (negative when overpaid). */
  balance: number;
  overpaid: number;
  adjustments: InvoiceAdjustment[];
  notes: string | null;
  locale: string | null;
  remindersPaused: boolean;
  cancelReason: string | null;
  /** ISO currency of all amounts on this invoice (regional payments). */
  currency: string;
  tax: { rate: number; amount: number; label: string | null; inclusive: boolean; reverseCharge: boolean; subtotal: number };
  dueDate: string | null;
  issuedAt: string;
  paidAt: string | null;
  family: { id: string; name: string; contactName: string | null; contactEmail: string | null };
  programName: string | null;
  items: InvoiceItem[];
  payments: InvoicePayment[];
  audit: InvoiceAuditEntry[];
};

/** Payment-level audit actions shown in an invoice's trail (matched on new_data.invoice_id). */
const PAYMENT_AUDIT_ACTIONS = [
  "PAYMENT_RECORDED", "STRIPE_PAYMENT", "STRIPE_REFUND", "STRIPE_DISPUTE_LOST",
  "PAYMENT_VOIDED", "PAYMENT_EDITED", "PAYMENT_REALLOCATED", "PAYMENT_ANNOTATED",
  "OVERPAYMENT_TO_CREDIT", "FAMILY_CREDIT_APPLIED",
];

export async function getInvoiceDetail(id: string): Promise<Result<InvoiceDetail | null>> {
  const supabase = await createClient();
  const { data: inv, error } = await supabase
    .from("invoices")
    .select("id,number,status,description,total_chf,adjustments_total,due_date,issued_at,paid_at,family_id,program_id,org_id,payment_reference,currency,subtotal_amount,tax_rate,tax_amount,tax_label,tax_inclusive,reverse_charge,notes,locale,reminders_paused,cancel_reason")
    .eq("id", id)
    .maybeSingle();
  if (error) return fail(error.message);
  if (!inv) return ok(null);

  const [itemsRes, paymentsRes, familyRes, programRes, invAudit, payAudit, adjRes] = await Promise.all([
    supabase.from("invoice_items").select("id,description,quantity,unit_price_chf,amount_chf").eq("invoice_id", id).order("created_at"),
    supabase
      .from("payments")
      .select("id,amount_chf,method,status,qr_reference,paid_at,recorded_by,notes,method_detail,stripe_payment_intent_id,stripe_charge_id,stripe_refund_id,stripe_account_id,voided_at,void_reason,reverses_payment_id,replaced_by_payment_id,admin_note")
      .eq("invoice_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("families").select("id,name,contact_name,contact_email").eq("id", inv.family_id).maybeSingle(),
    inv.program_id ? supabase.from("programs").select("name").eq("id", inv.program_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("audit_logs").select("id,action,actor_id,created_at,target_table").eq("target_id", id).order("created_at", { ascending: false }).limit(30),
    supabase
      .from("audit_logs")
      .select("id,action,actor_id,created_at,target_table,new_data")
      .in("action", PAYMENT_AUDIT_ACTIONS)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("invoice_adjustments")
      .select("id,number,kind,amount,tax_amount,description,reason,created_at,voided_at,void_reason")
      .eq("invoice_id", id)
      .order("created_at"),
  ]);

  const currency = (inv.currency ?? "CHF").toUpperCase();
  // Net paid as public.invoice_net_paid(): succeeded rows (incl. reversal and
  // credit-transfer rows) plus negative refund rows.
  const money = invoiceMoney({
    total: Number(inv.total_chf ?? 0),
    adjustmentsTotal: Number(inv.adjustments_total ?? 0),
    paid: netPaid((paymentsRes.data ?? []).map((p) => ({ amount: Number(p.amount_chf ?? 0), status: p.status })), currency),
    currency,
  });

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
    total: money.total,
    adjustmentsTotal: money.adjustments,
    amountDue: money.amountDue,
    paid: money.paid,
    balance: money.balance,
    overpaid: money.overpaid,
    adjustments: (adjRes.data ?? []).map((a) => ({
      id: a.id,
      number: a.number,
      kind: a.kind,
      amount: Number(a.amount ?? 0),
      taxAmount: Number(a.tax_amount ?? 0),
      description: a.description,
      reason: a.reason,
      createdAt: a.created_at,
      voidedAt: a.voided_at,
      voidReason: a.void_reason,
    })),
    notes: inv.notes ?? null,
    locale: inv.locale ?? null,
    remindersPaused: Boolean(inv.reminders_paused),
    cancelReason: inv.cancel_reason ?? null,
    currency,
    tax: {
      rate: Number(inv.tax_rate ?? 0),
      amount: Number(inv.tax_amount ?? 0),
      label: inv.tax_label ?? null,
      inclusive: inv.tax_inclusive ?? true,
      reverseCharge: inv.reverse_charge ?? false,
      subtotal: Number(inv.subtotal_amount ?? money.total),
    },
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
    payments: (paymentsRes.data ?? []).map((p) => {
      const isStripe = Boolean(p.stripe_payment_intent_id || p.stripe_charge_id || p.stripe_refund_id || p.stripe_account_id);
      const canVoid = !isStripe && p.status === "succeeded" && !p.voided_at && !p.reverses_payment_id;
      return {
        id: p.id,
        amount: Number(p.amount_chf ?? 0),
        method: p.method,
        status: p.status,
        reference: p.qr_reference,
        paidAt: p.paid_at,
        recordedBy: p.recorded_by,
        notes: p.notes,
        methodDetail: p.method_detail ?? null,
        isStripe,
        voidedAt: p.voided_at ?? null,
        voidReason: p.void_reason ?? null,
        reversesPaymentId: p.reverses_payment_id ?? null,
        replacedByPaymentId: p.replaced_by_payment_id ?? null,
        adminNote: p.admin_note ?? null,
        canVoid,
        canEdit: canVoid && Number(p.amount_chf ?? 0) > 0 && !["family_credit", "to_family_credit", "reversal"].includes(p.method_detail ?? ""),
      };
    }),
    audit,
  });
}
