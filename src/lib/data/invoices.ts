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
};

export async function listInvoices(statusFilter?: string): Promise<Result<InvoiceListItem[]>> {
  const supabase = await createClient();
  let q = supabase
    .from("invoices")
    .select("id,number,family_id,total_chf,adjustments_total,currency,status,due_date,issued_at,reminders_paused")
    .order("issued_at", { ascending: false })
    .limit(300);
  if (statusFilter && statusFilter !== "all") q = q.eq("status", statusFilter as never);
  const { data: invoices, error } = await q;
  if (error) return fail(error.message);

  const ids = uniq((invoices ?? []).map((i) => i.id));
  const familyIds = uniq((invoices ?? []).map((i) => i.family_id));
  const [payments, families] = await Promise.all([
    ids.length
      ? supabase.from("payments").select("invoice_id,amount_chf,status").in("invoice_id", ids).in("status", ["succeeded", "refunded", "partially_refunded"])
      : Promise.resolve({ data: [] as { invoice_id: string; amount_chf: number; status: string }[] }),
    familyIds.length
      ? supabase.from("families").select("id,name").in("id", familyIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  // Net paid as public.invoice_net_paid(): succeeded rows (incl. reversals and
  // credit transfers) plus negative refund rows.
  const paysByInvoice = new Map<string, { amount: number; status: string }[]>();
  for (const p of payments.data ?? []) {
    const arr = paysByInvoice.get(p.invoice_id) ?? [];
    arr.push({ amount: Number(p.amount_chf ?? 0), status: p.status });
    paysByInvoice.set(p.invoice_id, arr);
  }
  const fName = new Map((families.data ?? []).map((f) => [f.id, f.name]));

  return ok(
    (invoices ?? []).map((i) => {
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
