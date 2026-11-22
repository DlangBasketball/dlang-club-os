import "server-only";
import { getSessionUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import type { BillingActivity, ReceiptStatus } from "@/lib/billing/activities";

/*
 * Billing foundation — server-side reads (migration 20250420103500). Every
 * read goes through the caller's session (RLS + the role checks inside the
 * RPCs): admin / finance see their club's billing data, guardians only what
 * RLS lets them see (their own payer invoices), coaches nothing. The org is
 * never taken from the client. Contract: docs/billing-foundation.md.
 */
export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T,>(data: T): Result<T> => ({ data, error: null });
const fail = <T,>(error: string): Result<T> => ({ data: null, error });

type Staff = { orgId: string; isAdmin: boolean };
async function staff(): Promise<Staff | null> {
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) return null;
  return { orgId: me.orgId, isAdmin: me.roles.includes("admin") };
}

const num = (v: unknown) => Number(v ?? 0);

// ---------------------------------------------------------------------------
// Billing entities + routing
// ---------------------------------------------------------------------------
export type BillingEntity = {
  id: string; name: string; legalName: string | null; street: string | null; buildingNumber: string | null; addressExtra: string | null;
  postalCode: string | null; city: string | null; country: string; vatNumber: string | null; iban: string | null; qrIban: string | null;
  email: string | null; phone: string | null; isDefault: boolean; isActive: boolean;
};
export type BillingEntitiesView = {
  entities: BillingEntity[];
  /** activity -> entity id (activities without a route use the default entity). */
  routes: Partial<Record<BillingActivity, string>>;
  /** Invoices the migration assigned to the default entity (for review). */
  migrationDefaultCount: number;
  /** Invoice number prefix per category (categories without one keep the club's invoice pattern). */
  numberSeries: Partial<Record<BillingActivity, { prefix: string; isActive: boolean }>>;
  canEdit: boolean;
};

export async function getBillingEntities(): Promise<Result<BillingEntitiesView>> {
  const me = await staff();
  if (!me) return fail("NOT_AUTHORIZED");
  const db = await createClient();
  const [ents, routes, review, series] = await Promise.all([
    db.from("billing_entities").select("*").eq("org_id", me.orgId).order("is_default", { ascending: false }).order("name"),
    db.from("billing_entity_routes").select("activity,billing_entity_id").eq("org_id", me.orgId),
    db.from("invoices").select("id", { count: "exact", head: true }).eq("org_id", me.orgId).eq("billing_entity_source", "migration_default"),
    db.from("invoice_number_series").select("category,prefix,is_active").eq("org_id", me.orgId),
  ]);
  if (series.error) return fail(series.error.message);
  const numberSeries: BillingEntitiesView["numberSeries"] = {};
  for (const r of series.data ?? []) numberSeries[r.category as BillingActivity] = { prefix: r.prefix, isActive: r.is_active };
  if (ents.error) return fail(ents.error.message);
  if (routes.error) return fail(routes.error.message);
  const map: Partial<Record<BillingActivity, string>> = {};
  for (const r of routes.data ?? []) map[r.activity as BillingActivity] = r.billing_entity_id;
  return ok({
    entities: (ents.data ?? []).map((e) => ({
      id: e.id, name: e.name, legalName: e.legal_name, street: e.street, buildingNumber: e.building_number, addressExtra: e.address_extra,
      postalCode: e.postal_code, city: e.city, country: e.country, vatNumber: e.vat_number, iban: e.iban, qrIban: e.qr_iban,
      email: e.email, phone: e.phone, isDefault: e.is_default, isActive: e.is_active,
    })),
    routes: map,
    migrationDefaultCount: review.count ?? 0,
    numberSeries,
    canEdit: me.isAdmin,
  });
}

// ---------------------------------------------------------------------------
// Club season settings + seasons
// ---------------------------------------------------------------------------
export type ClubBillingSettings = {
  seasonStartMonth: number;
  installmentCount: number;
  installmentDueDay: number;
  /** Effective first instalment month (the season start month unless set). */
  firstInstallmentMonth: number;
  firstInstallmentMonthSet: boolean;
  currency: string;
};
export type Season = { id: string; name: string; startsOn: string; endsOn: string; isCurrent: boolean };

export async function getClubBillingSettings(): Promise<Result<ClubBillingSettings>> {
  if (!(await staff())) return fail("NOT_AUTHORIZED");
  const db = await createClient();
  const { data, error } = await db.rpc("club_billing_settings");
  if (error) return fail(error.message);
  const s = (data ?? {}) as Record<string, unknown>;
  return ok({
    seasonStartMonth: num(s.season_start_month) || 8,
    installmentCount: num(s.installment_count) || 11,
    installmentDueDay: num(s.installment_due_day) || 28,
    firstInstallmentMonth: num(s.first_installment_month) || num(s.season_start_month) || 8,
    firstInstallmentMonthSet: Boolean(s.first_installment_month_set),
    currency: String(s.currency ?? "CHF"),
  });
}

export async function listSeasons(): Promise<Result<{ seasons: Season[]; canEdit: boolean }>> {
  const me = await staff();
  if (!me) return fail("NOT_AUTHORIZED");
  const db = await createClient();
  const { data, error } = await db.from("seasons").select("id,name,starts_on,ends_on,is_current").eq("org_id", me.orgId)
    .order("starts_on", { ascending: false }).limit(200);
  if (error) return fail(error.message);
  return ok({
    seasons: (data ?? []).map((s) => ({ id: s.id, name: s.name, startsOn: s.starts_on, endsOn: s.ends_on, isCurrent: s.is_current })),
    canEdit: me.isAdmin,
  });
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------
export type UnallocatedReceipt = {
  receiptId: string; familyId: string | null; payerName: string | null; amount: number; allocated: number; unallocated: number;
  currency: string; receivedOn: string; method: string; reference: string | null; bankEntryId: string | null; createdAt: string;
};

/** Receipts with money not yet allocated to an invoice (Finance worklist). */
export async function listUnallocatedReceipts(): Promise<Result<UnallocatedReceipt[]>> {
  if (!(await staff())) return fail("NOT_AUTHORIZED");
  const db = await createClient();
  const { data, error } = await db.rpc("receipt_unallocated");
  if (error) return fail(error.message);
  return ok((data ?? []).map((r) => ({
    receiptId: r.receipt_id, familyId: r.family_id, payerName: r.payer_name, amount: num(r.amount), allocated: num(r.allocated),
    unallocated: num(r.unallocated), currency: r.currency, receivedOn: r.received_on, method: r.method, reference: r.reference,
    bankEntryId: r.bank_entry_id, createdAt: r.created_at,
  })));
}

export type ReceiptAllocation = {
  paymentId: string; invoiceId: string; invoiceNumber: string | null; activity: BillingActivity; amount: number;
  installmentId: string | null; voided: boolean;
};
export type ReceiptDetail = {
  id: string; status: ReceiptStatus; amount: number; allocated: number; unallocated: number; currency: string; receivedOn: string;
  method: string; reference: string | null; note: string | null; payerName: string | null; familyId: string | null;
  bankEntryId: string | null; allocations: ReceiptAllocation[];
};

export async function getReceipt(id: string): Promise<Result<ReceiptDetail | null>> {
  const me = await staff();
  if (!me) return fail("NOT_AUTHORIZED");
  const db = await createClient();
  const { data: r, error } = await db.from("payment_receipts").select("*").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (error) return fail(error.message);
  if (!r) return ok(null);
  const { data: pays, error: pErr } = await db.from("payments")
    .select("id,invoice_id,amount_chf,installment_id,voided_at,reverses_payment_id,invoices(number,activity)")
    .eq("receipt_id", id).order("created_at");
  if (pErr) return fail(pErr.message);
  type P = { id: string; invoice_id: string; amount_chf: number; installment_id: string | null; voided_at: string | null;
    reverses_payment_id: string | null; invoices: { number: string; activity: BillingActivity } | { number: string; activity: BillingActivity }[] | null };
  const rows = (pays ?? []) as unknown as P[];
  const allocated = rows.reduce((s, p) => s + num(p.amount_chf), 0);
  const inv = (p: P) => (Array.isArray(p.invoices) ? p.invoices[0] : p.invoices) ?? null;
  return ok({
    id: r.id, status: r.status, amount: num(r.amount), allocated, unallocated: num(r.amount) - allocated, currency: r.currency,
    receivedOn: r.received_on, method: r.method, reference: r.reference, note: r.note, payerName: r.payer_name, familyId: r.family_id,
    bankEntryId: r.bank_entry_id,
    allocations: rows.filter((p) => !p.reverses_payment_id).map((p) => ({
      paymentId: p.id, invoiceId: p.invoice_id, invoiceNumber: inv(p)?.number ?? null, activity: inv(p)?.activity ?? "other",
      amount: num(p.amount_chf), installmentId: p.installment_id, voided: Boolean(p.voided_at),
    })),
  });
}

// ---------------------------------------------------------------------------
// Balances, memberships, invoice source, review flags
// ---------------------------------------------------------------------------
export type ActivityBalance = {
  activity: BillingActivity | "unassigned"; currency: string; openCount: number; amountDue: number; paid: number; balance: number;
  overdueCount: number; overdueBalance: number; credit: number;
};

/** Open money and credit per activity for one family (RLS: staff, or a guardian for what they pay). */
export async function getFamilyBalanceByActivity(familyId: string): Promise<Result<ActivityBalance[]>> {
  const me = await getSessionUser();
  if (!me?.orgId) return fail("NOT_AUTHORIZED");
  const db = await createClient();
  const { data, error } = await db.rpc("family_balance_by_activity", { p_family: familyId });
  if (error) return fail(error.message);
  return ok((data ?? []).map((r) => ({
    activity: r.activity as ActivityBalance["activity"], currency: r.currency, openCount: num(r.open_count), amountDue: num(r.amount_due),
    paid: num(r.paid), balance: num(r.balance), overdueCount: num(r.overdue_count), overdueBalance: num(r.overdue_balance), credit: num(r.credit),
  })));
}

export type MembershipMoney = { invoiced: number; paid: number; balance: number };
export type MembershipSummary = {
  membershipId: string; seasonId: string | null; agreedFee: number | null; currency: string; sponsored: boolean;
  /** Season fee only (charge_kind season_fee). */
  seasonFee: MembershipMoney;
  /** Carried forward from an earlier season: never part of the season fee. */
  carryForward: MembershipMoney;
  invoiceIds: string[];
};

export async function getMembershipSummary(membershipId: string): Promise<Result<MembershipSummary | null>> {
  const me = await getSessionUser();
  if (!me?.orgId) return fail("NOT_AUTHORIZED");
  const db = await createClient();
  const { data, error } = await db.rpc("membership_summary", { p_membership: membershipId });
  if (error) return fail(error.message);
  if (!data) return ok(null);
  const j = data as unknown as Record<string, unknown>;
  const money = (o: unknown): MembershipMoney => {
    const m = (o ?? {}) as Record<string, unknown>;
    return { invoiced: num(m.invoiced), paid: num(m.paid), balance: num(m.balance) };
  };
  return ok({
    membershipId: String(j.membership_id), seasonId: (j.season_id as string | null) ?? null,
    agreedFee: j.agreed_fee == null ? null : num(j.agreed_fee), currency: String(j.currency ?? "CHF"), sponsored: Boolean(j.sponsored),
    seasonFee: money(j.season_fee), carryForward: money(j.carry_forward), invoiceIds: (j.invoice_ids as string[] | undefined) ?? [],
  });
}

export type InvoiceSourceKind = "membership" | "programme" | "registration" | "booking" | "training_package" | "shop";
export type InvoiceSource = { kind: InvoiceSourceKind; id: string; label: string | null; programId?: string | null };

/** The record an invoice was raised for (null when none / not visible to the caller). */
export async function getInvoiceSource(invoiceId: string): Promise<Result<InvoiceSource | null>> {
  const me = await getSessionUser();
  if (!me?.orgId) return fail("NOT_AUTHORIZED");
  const db = await createClient();
  const { data, error } = await db.rpc("invoice_source", { p_invoice: invoiceId });
  if (error) return fail(error.message);
  if (!data) return ok(null);
  const j = data as Record<string, unknown>;
  return ok({ kind: j.kind as InvoiceSourceKind, id: String(j.id), label: (j.label as string | null) ?? null, programId: (j.program_id as string | null) ?? null });
}

export type MembershipPayer = {
  id: string; sort: number; payerKind: "guardian" | "family" | "sponsor" | "other"; payerProfileId: string | null; familyId: string | null;
  payerName: string | null; payerEmail: string | null; shareKind: "fixed" | "percent"; shareValue: number; amount: number; currency: string;
  invoiceId: string | null;
};

export async function listMembershipPayers(membershipId: string): Promise<Result<MembershipPayer[]>> {
  const me = await getSessionUser();
  if (!me?.orgId) return fail("NOT_AUTHORIZED");
  const db = await createClient();
  const { data, error } = await db.from("membership_payers").select("*").eq("membership_id", membershipId).order("sort");
  if (error) return fail(error.message);
  return ok((data ?? []).map((p) => ({
    id: p.id, sort: p.sort, payerKind: p.payer_kind, payerProfileId: p.payer_profile_id, familyId: p.family_id, payerName: p.payer_name,
    payerEmail: p.payer_email, shareKind: p.share_kind, shareValue: num(p.share_value), amount: num(p.amount), currency: p.currency,
    invoiceId: p.invoice_id,
  })));
}

export type ReviewFlag = {
  id: string; entityTable: string; entityId: string | null; reasonCode: string; details: Record<string, unknown>;
  originalReference: string | null; resolvedAt: string | null; resolutionNote: string | null; createdAt: string;
};

/** Data review flags of the club (open first). */
export async function listReviewFlags(opts: { includeResolved?: boolean; limit?: number } = {}): Promise<Result<ReviewFlag[]>> {
  const me = await staff();
  if (!me) return fail("NOT_AUTHORIZED");
  const db = await createClient();
  let q = db.from("data_review_flags").select("*").eq("org_id", me.orgId);
  if (!opts.includeResolved) q = q.is("resolved_at", null);
  const { data, error } = await q.order("resolved_at", { ascending: true, nullsFirst: true }).order("created_at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 500, 1), 1000));
  if (error) return fail(error.message);
  return ok((data ?? []).map((f) => ({
    id: f.id, entityTable: f.entity_table, entityId: f.entity_id, reasonCode: f.reason_code, details: (f.details ?? {}) as Record<string, unknown>,
    originalReference: f.original_reference, resolvedAt: f.resolved_at, resolutionNote: f.resolution_note, createdAt: f.created_at,
  })));
}

// ---------------------------------------------------------------------------
// Invoices by revenue category (data support for the Finance list / exports)
// ---------------------------------------------------------------------------
export type BillingInvoiceFilter = {
  category?: BillingActivity | null;
  entityId?: string | null;
  status?: string | null;
  /** Issue date range, inclusive (YYYY-MM-DD). */
  from?: string | null;
  to?: string | null;
  /** Part of the number or prefix, case-insensitive (e.g. "DL EYBL" or "2026-00"). */
  numberSearch?: string | null;
  page?: number;
  pageSize?: number;
};
export type BillingInvoiceRow = {
  id: string; number: string; category: BillingActivity; activitySource: string; status: string; issuedAt: string; dueDate: string | null;
  currency: string; total: number; adjustmentsTotal: number; familyId: string; athleteId: string | null; programId: string | null;
  membershipId: string | null; chargeKind: string | null; sourceLabel: string | null; payerKind: string | null; payerName: string | null;
  billingEntityId: string | null; billingEntityName: string | null;
};

/** One page of the club's invoices with category, number and issuing entity (staff only; RLS + explicit org filter). */
export async function listBillingInvoices(filter: BillingInvoiceFilter = {}): Promise<Result<{ rows: BillingInvoiceRow[]; total: number }>> {
  const me = await staff();
  if (!me) return fail("NOT_AUTHORIZED");
  const db = await createClient();
  const size = Math.min(Math.max(filter.pageSize ?? 50, 1), 500);
  const page = Math.max(filter.page ?? 0, 0);
  let q = db.from("invoices")
    .select("id,number,activity,activity_source,status,issued_at,due_date,currency,total_chf,adjustments_total,family_id,athlete_id,program_id,membership_id,charge_kind,source_label,payer_kind,payer_name,billing_entity_id,billing_entity_snapshot", { count: "exact" })
    .eq("org_id", me.orgId);
  if (filter.category) q = q.eq("activity", filter.category);
  if (filter.entityId) q = q.eq("billing_entity_id", filter.entityId);
  if (filter.status) q = q.eq("status", filter.status as never);
  if (filter.from && /^\d{4}-\d{2}-\d{2}$/.test(filter.from)) q = q.gte("issued_at", `${filter.from}T00:00:00`);
  if (filter.to && /^\d{4}-\d{2}-\d{2}$/.test(filter.to)) q = q.lte("issued_at", `${filter.to}T23:59:59.999`);
  const search = (filter.numberSearch ?? "").replace(/[%_,()*\\]/g, " ").trim().slice(0, 40);
  if (search) q = q.ilike("number", `%${search}%`);
  const { data, error, count } = await q.order("issued_at", { ascending: false }).order("number", { ascending: false })
    .range(page * size, page * size + size - 1);
  if (error) return fail(error.message);
  return ok({
    total: count ?? 0,
    rows: (data ?? []).map((i) => ({
      id: i.id, number: i.number, category: i.activity as BillingActivity, activitySource: i.activity_source, status: i.status,
      issuedAt: i.issued_at, dueDate: i.due_date, currency: i.currency, total: num(i.total_chf), adjustmentsTotal: num(i.adjustments_total),
      familyId: i.family_id, athleteId: i.athlete_id, programId: i.program_id, membershipId: i.membership_id, chargeKind: i.charge_kind,
      sourceLabel: i.source_label, payerKind: i.payer_kind, payerName: i.payer_name, billingEntityId: i.billing_entity_id,
      billingEntityName: ((i.billing_entity_snapshot ?? null) as { name?: string } | null)?.name ?? null,
    })),
  });
}

export type CategoryTotals = { category: BillingActivity; currency: string; invoiceCount: number; invoiced: number; received: number; outstanding: number };

/** Invoiced / received / outstanding per stored category (credit notes count under the original invoice's category). */
export async function getInvoiceTotalsByCategory(input: { from?: string | null; to?: string | null; entityId?: string | null; status?: string | null } = {}): Promise<Result<CategoryTotals[]>> {
  if (!(await staff())) return fail("NOT_AUTHORIZED");
  const db = await createClient();
  const { data, error } = await db.rpc("invoice_totals_by_category", {
    p_from: input.from ?? null, p_to: input.to ?? null, p_entity: input.entityId ?? null, p_status: input.status ?? null,
  });
  if (error) return fail(error.message);
  return ok((data ?? []).map((r) => ({
    category: r.category as BillingActivity, currency: r.currency, invoiceCount: num(r.invoice_count), invoiced: num(r.invoiced),
    received: num(r.received), outstanding: num(r.outstanding),
  })));
}

export type InvoiceCategoryInfo = { category: BillingActivity; number: string; sourceLabel: string | null; categoryLabel: string | null; entityName: string | null };

/** Category, number, printed source and entity of one invoice (any caller allowed to see the invoice; RLS applies). */
export async function getInvoiceCategoryInfo(invoiceId: string): Promise<Result<InvoiceCategoryInfo | null>> {
  const me = await getSessionUser();
  if (!me?.orgId) return fail("NOT_AUTHORIZED");
  const db = await createClient();
  const [{ data, error }, label] = await Promise.all([
    db.from("invoices").select("activity,number,source_label,billing_entity_snapshot").eq("id", invoiceId).maybeSingle(),
    db.rpc("billing_category_label", { p_invoice: invoiceId }),
  ]);
  if (error) return fail(error.message);
  if (!data) return ok(null);
  return ok({
    category: data.activity as BillingActivity, number: data.number, sourceLabel: data.source_label,
    categoryLabel: (label.data as string | null) ?? null,
    entityName: ((data.billing_entity_snapshot ?? null) as { name?: string } | null)?.name ?? null,
  });
}
