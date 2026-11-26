import { asBillingClient } from "@/lib/people/billing-athletes";
import "server-only";
import { accountingDb, type AccountRow, type BankEntryRow, type DunningCaseRow, type DunningNoticeRow, type DunningPauseRow,
  type DunningSettingsRow, type ImportRow, type MappingRow, type OpenItemRow, type PeriodLockRow, type ReimbursementRow,
  type RefundPolicyRow, type RefundRequestRow, type SupportDiscountRow } from "./db";
import { buildJournal, type Journal, type JournalSource, type Mapping } from "./journal";
import type { OpenInvoice } from "./matching";
import { DEFAULT_DUNNING, type DunningSettings } from "./dunning";
import { pagedIn } from "@/lib/data/paged";

/**
 * Server-side reads for the accounting screens. Every read uses the user's
 * session (RLS: admin / finance of the caller's club) and filters by the org
 * explicitly as well.
 */
export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(data: T): Result<T> => ({ data, error: null });
const fail = <T>(e: { message?: string } | null | undefined): Result<T> => ({ data: null, error: e?.message ?? "error" });

type Named = { id: string; name: string };
async function familyNames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const db = await accountingDb();
  const { data } = await db.from("families").select("id,name").in("id", Array.from(new Set(ids)));
  return new Map(((data ?? []) as Named[]).map((f) => [f.id, f.name]));
}
async function invoiceNumbers(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const db = await accountingDb();
  const { data } = await db.from("invoices").select("id,number").in("id", Array.from(new Set(ids)));
  return new Map(((data ?? []) as { id: string; number: string }[]).map((i) => [i.id, i.number]));
}

// ---------------------------------------------------------------------------
// Bank files
// ---------------------------------------------------------------------------
export async function listImports(orgId: string): Promise<Result<ImportRow[]>> {
  const db = await accountingDb();
  const { data, error } = await db.from("bank_statement_imports").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(100);
  return error ? fail(error) : ok((data ?? []) as ImportRow[]);
}

export type EntryView = BankEntryRow & { invoiceNumber: string | null; familyName: string | null };
export async function getImport(orgId: string, id: string): Promise<Result<{ file: ImportRow; entries: EntryView[] } | null>> {
  const db = await accountingDb();
  const [{ data: file, error }, { data: entries, error: e2 }] = await Promise.all([
    db.from("bank_statement_imports").select("*").eq("org_id", orgId).eq("id", id).maybeSingle(),
    db.from("bank_entries").select("*").eq("org_id", orgId).eq("import_id", id).order("value_date").order("bank_ref"),
  ]);
  if (error || e2) return fail(error ?? e2);
  if (!file) return ok(null);
  const rows = (entries ?? []) as BankEntryRow[];
  const invIds = rows.map((r) => r.invoice_id).filter((x): x is string => !!x);
  const db2 = await accountingDb();
  const { data: invs } = invIds.length
    ? await db2.from("invoices").select("id,number,family_id").in("id", Array.from(new Set(invIds)))
    : { data: [] as { id: string; number: string; family_id: string }[] };
  const fams = await familyNames(((invs ?? []) as { family_id: string }[]).map((i) => i.family_id));
  const byInv = new Map(((invs ?? []) as { id: string; number: string; family_id: string }[]).map((i) => [i.id, i]));
  return ok({
    file: file as ImportRow,
    entries: rows.map((r) => {
      const inv = r.invoice_id ? byInv.get(r.invoice_id) : undefined;
      return { ...r, invoiceNumber: inv?.number ?? null, familyName: inv ? fams.get(inv.family_id) ?? null : null };
    }),
  });
}

export async function unmatchedCount(orgId: string): Promise<number> {
  const db = await accountingDb();
  const { count } = await db.from("bank_entries").select("id", { count: "exact", head: true }).eq("org_id", orgId).in("status", ["unmatched", "suggested"]);
  return count ?? 0;
}

/** Open invoices of the club for matching and manual assignment. */
export async function openInvoicesForMatching(orgId: string): Promise<OpenInvoice[]> {
  const db = await accountingDb();
  const { data: invs } = await db.from("invoices")
    .select("id,number,family_id,currency,total_chf,adjustments_total,payment_reference,status")
    .eq("org_id", orgId).in("status", ["sent", "partially_paid", "overdue"]).order("due_date").limit(2000);
  const list = (invs ?? []) as { id: string; number: string; family_id: string; currency: string; total_chf: number; adjustments_total: number; payment_reference: string | null }[];
  if (!list.length) return [];
  const ids = list.map((i) => i.id);
  // Up to 2000 invoices: chunked (URL length) and paged (row cap), else paid
  // amounts went missing and paid invoices looked open for matching.
  const [{ rows: pays }, { rows: inst }, fams] = await Promise.all([
    pagedIn(ids, (c, a, b) => db.from("payments").select("id,invoice_id,amount_chf,status").in("invoice_id", c).order("id").range(a, b)),
    pagedIn(ids, (c, a, b) => db.from("payment_plan_installments").select("id,invoice_id,amount,amount_paid,status").in("invoice_id", c).eq("status", "scheduled").order("id").range(a, b)),
    familyNames(list.map((i) => i.family_id)),
  ]);
  const paid = new Map<string, number>();
  for (const p of (pays ?? []) as { invoice_id: string; amount_chf: number; status: string }[]) {
    if (p.status === "succeeded" || ((p.status === "refunded" || p.status === "partially_refunded") && Number(p.amount_chf) < 0)) {
      paid.set(p.invoice_id, (paid.get(p.invoice_id) ?? 0) + Math.round(Number(p.amount_chf) * 100));
    }
  }
  const instBy = new Map<string, number[]>();
  for (const r of (inst ?? []) as { invoice_id: string; amount: number; amount_paid: number }[]) {
    const arr = instBy.get(r.invoice_id) ?? [];
    arr.push((Math.round(Number(r.amount) * 100) - Math.round(Number(r.amount_paid) * 100)) / 100);
    instBy.set(r.invoice_id, arr);
  }
  return list.map((i) => ({
    id: i.id, number: i.number, familyName: fams.get(i.family_id) ?? null, reference: i.payment_reference, currency: i.currency,
    balance: (Math.round((Number(i.total_chf) + Number(i.adjustments_total ?? 0)) * 100) - (paid.get(i.id) ?? 0)) / 100,
    instalments: instBy.get(i.id),
  })).filter((i) => i.balance > 0);
}

// ---------------------------------------------------------------------------
// Chart, mappings, locks
// ---------------------------------------------------------------------------
export async function getChart(orgId: string): Promise<Result<{ accounts: AccountRow[]; mappings: MappingRow[]; categories: Named[] }>> {
  const db = await accountingDb();
  const [a, m, c] = await Promise.all([
    db.from("accounting_accounts").select("*").eq("org_id", orgId).order("number"),
    db.from("accounting_mappings").select("*").eq("org_id", orgId).order("key"),
    db.from("expense_categories").select("id,name").eq("org_id", orgId).order("name"),
  ]);
  if (a.error || m.error) return fail(a.error ?? m.error);
  return ok({ accounts: (a.data ?? []) as AccountRow[], mappings: (m.data ?? []) as MappingRow[], categories: (c.data ?? []) as Named[] });
}

export function mappingFrom(rows: MappingRow[]): Mapping {
  return Object.fromEntries(rows.map((r) => [r.key, { account: r.account_number, vatCode: r.vat_code }]));
}

export async function listLocks(orgId: string): Promise<Result<PeriodLockRow[]>> {
  const db = await accountingDb();
  const { data, error } = await db.from("accounting_period_locks").select("*").eq("org_id", orgId).order("period_start", { ascending: false }).order("closed_at", { ascending: false });
  return error ? fail(error) : ok((data ?? []) as PeriodLockRow[]);
}

export async function loadJournal(orgId: string, range: { from: string; to: string }): Promise<Result<Journal>> {
  const db = await accountingDb();
  const [{ data, error }, { data: maps, error: e2 }] = await Promise.all([
    db.rpc("accounting_journal_source", { p_from: range.from, p_to: range.to }),
    db.from("accounting_mappings").select("*").eq("org_id", orgId),
  ]);
  if (error || e2) return fail(error ?? e2);
  return ok(buildJournal(data as unknown as JournalSource, mappingFrom((maps ?? []) as MappingRow[]), range));
}

export async function loadOpenItems(at: string): Promise<Result<OpenItemRow[]>> {
  const db = await accountingDb();
  const { data, error } = await db.rpc("accounting_open_items", { p_date: at });
  return error ? fail(error) : ok(((data ?? []) as OpenItemRow[]).map((r) => ({
    ...r, amount_due: Number(r.amount_due), paid: Number(r.paid), open_amount: Number(r.open_amount),
  })));
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------
export async function listPolicies(orgId: string): Promise<RefundPolicyRow[]> {
  const db = await accountingDb();
  const { data } = await db.from("refund_policies").select("*").eq("org_id", orgId);
  return (data ?? []) as RefundPolicyRow[];
}

export type RequestView = RefundRequestRow & { familyName: string | null; invoiceNumber: string | null; subject: string | null };
export async function listRefundRequests(orgId: string, opts: { familyIds?: string[] } = {}): Promise<Result<RequestView[]>> {
  const db = await accountingDb();
  let q = db.from("refund_requests").select("*").eq("org_id", orgId).order("requested_at", { ascending: false }).limit(300);
  if (opts.familyIds) q = q.in("family_id", opts.familyIds.length ? opts.familyIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await q;
  if (error) return fail(error);
  const rows = (data ?? []) as RefundRequestRow[];
  const [fams, nums, subjects] = await Promise.all([
    familyNames(rows.map((r) => r.family_id)),
    invoiceNumbers(rows.map((r) => r.invoice_id).filter((x): x is string => !!x)),
    subjectNames(rows),
  ]);
  return ok(rows.map((r) => ({
    ...r, familyName: fams.get(r.family_id) ?? null, invoiceNumber: r.invoice_id ? nums.get(r.invoice_id) ?? null : null,
    subject: subjects.get(r.id) ?? null,
  })));
}

async function subjectNames(rows: RefundRequestRow[]): Promise<Map<string, string>> {
  const db = await accountingDb();
  const regIds = rows.map((r) => r.registration_id).filter((x): x is string => !!x);
  const bookIds = rows.map((r) => r.booking_id).filter((x): x is string => !!x);
  const out = new Map<string, string>();
  if (regIds.length) {
    const { data } = await db.from("registrations").select("id,program_id,programs(name)").in("id", regIds);
    const byId = new Map(((data ?? []) as unknown as { id: string; programs: { name: string } | null }[]).map((r) => [r.id, r.programs?.name ?? ""]));
    for (const r of rows) if (r.registration_id && byId.get(r.registration_id)) out.set(r.id, byId.get(r.registration_id)!);
  }
  if (bookIds.length) {
    const { data } = await db.from("training_bookings").select("id,training_services(name)").in("id", bookIds);
    const byId = new Map(((data ?? []) as unknown as { id: string; training_services: { name: string } | null }[]).map((r) => [r.id, r.training_services?.name ?? ""]));
    for (const r of rows) if (r.booking_id && byId.get(r.booking_id)) out.set(r.id, byId.get(r.booking_id)!);
  }
  return out;
}

/** Registrations / bookings a parent (or finance) can still cancel. */
export type Cancellable = { kind: "registration" | "booking"; id: string; label: string; athlete: string; startsOn: string | null };
export async function listCancellable(orgId: string, familyIds: string[] | null): Promise<Cancellable[]> {
  const db = await accountingDb();
  let athletesQ = asBillingClient(db).from("billing_athletes").select("id,first_name,family_id").eq("org_id", orgId);
  if (familyIds) athletesQ = athletesQ.in("family_id", familyIds.length ? familyIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: athletes } = await athletesQ.limit(2000);
  const aList = (athletes ?? []) as { id: string; first_name: string; family_id: string }[];
  if (!aList.length) return [];
  const aIds = aList.map((a) => a.id);
  const aName = new Map(aList.map((a) => [a.id, a.first_name]));
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: regs }, { data: books }, { data: open }] = await Promise.all([
    db.from("registrations").select("id,athlete_id,status,programs(name,starts_on,ends_on),camp_editions(starts_on)")
      .eq("org_id", orgId).in("athlete_id", aIds).in("status", ["pending", "confirmed", "waitlist"]).limit(500),
    db.from("training_bookings").select("id,athlete_id,slot_start,status,training_services(name)")
      .eq("org_id", orgId).in("athlete_id", aIds).eq("status", "booked").gte("slot_start", today).limit(500),
    db.from("refund_requests").select("registration_id,booking_id,status").eq("org_id", orgId).neq("status", "rejected"),
  ]);
  const taken = new Set(((open ?? []) as { registration_id: string | null; booking_id: string | null }[]).flatMap((r) => [r.registration_id, r.booking_id]).filter(Boolean));
  const out: Cancellable[] = [];
  type Reg = { id: string; athlete_id: string; programs: { name: string; starts_on: string | null; ends_on: string | null } | null; camp_editions: { starts_on: string } | null };
  for (const r of (regs ?? []) as unknown as Reg[]) {
    if (taken.has(r.id)) continue;
    const end = r.programs?.ends_on;
    if (end && end < today) continue;
    out.push({ kind: "registration", id: r.id, label: r.programs?.name ?? "", athlete: aName.get(r.athlete_id) ?? "", startsOn: r.camp_editions?.starts_on ?? r.programs?.starts_on ?? null });
  }
  type Book = { id: string; athlete_id: string; slot_start: string; training_services: { name: string } | null };
  for (const b of (books ?? []) as unknown as Book[]) {
    if (taken.has(b.id)) continue;
    out.push({ kind: "booking", id: b.id, label: b.training_services?.name ?? "", athlete: aName.get(b.athlete_id) ?? "", startsOn: b.slot_start.slice(0, 10) });
  }
  return out.sort((a, b) => (a.startsOn ?? "9999").localeCompare(b.startsOn ?? "9999"));
}

export type QuoteView = {
  orgId: string; familyId: string; invoiceId: string | null; productType: string; startsOn: string | null; base: number; label: string | null;
  currency: string; hasPolicy: boolean; policy: { full_until_days: number | null; partial_percent: number; partial_until_days: number | null;
    medical_mode: string; medical_percent: number; notes: string | null } | null;
  daysBefore: number | null; percent: number; medical: boolean; refund: number; amountDue: number; paid: number; payout: number;
  stillOwed: number; stripeAvailable: boolean; needsReview: boolean;
};

export function toQuoteView(q: Record<string, unknown>): QuoteView {
  const n = (k: string) => Number(q[k] ?? 0);
  return {
    orgId: String(q.org_id), familyId: String(q.family_id), invoiceId: (q.invoice_id as string | null) ?? null,
    productType: String(q.product_type), startsOn: (q.starts_on as string | null) ?? null, base: n("base"), label: (q.label as string | null) ?? null,
    currency: String(q.currency), hasPolicy: Boolean(q.has_policy), policy: (q.policy as QuoteView["policy"]) ?? null,
    daysBefore: q.days_before == null ? null : n("days_before"), percent: n("percent"), medical: Boolean(q.medical), refund: n("refund"),
    amountDue: n("amount_due"), paid: n("paid"), payout: n("payout"), stillOwed: n("still_owed"), stripeAvailable: Boolean(q.stripe_available),
    needsReview: Boolean(q.needs_review),
  };
}

export async function getQuote(subject: { registrationId?: string; bookingId?: string; invoiceId?: string }, medical: boolean): Promise<Result<QuoteView>> {
  const db = await accountingDb();
  const { data, error } = await db.rpc("refund_quote", {
    p_registration: subject.registrationId ?? null, p_booking: subject.bookingId ?? null, p_invoice: subject.invoiceId ?? null, p_medical: medical,
  });
  return error ? fail(error) : ok(toQuoteView((data ?? {}) as Record<string, unknown>));
}

// ---------------------------------------------------------------------------
// Dunning
// ---------------------------------------------------------------------------
export function dunningFromRow(r: DunningSettingsRow | null): DunningSettings {
  if (!r) return DEFAULT_DUNNING;
  return {
    enabled: r.enabled, level1Days: r.level1_days, level2Days: r.level2_days, level2Fee: Number(r.level2_fee), level3Days: r.level3_days,
    level3Fee: Number(r.level3_fee), collectionDays: r.collection_days, minBalance: Number(r.min_balance),
  };
}

export type CaseView = DunningCaseRow & { invoiceNumber: string | null; familyName: string | null; notices: DunningNoticeRow[] };
export async function getDunning(orgId: string): Promise<Result<{ settings: DunningSettings; cases: CaseView[]; pauses: (DunningPauseRow & { familyName: string | null })[]; families: Named[] }>> {
  const db = await accountingDb();
  const [s, c, n, p, f] = await Promise.all([
    db.from("dunning_settings").select("*").eq("org_id", orgId).maybeSingle(),
    db.from("dunning_cases").select("*").eq("org_id", orgId).order("updated_at", { ascending: false }).limit(500),
    db.from("dunning_notices").select("*").eq("org_id", orgId).order("created_at").limit(2000),
    db.from("dunning_family_pauses").select("*").eq("org_id", orgId),
    db.from("families").select("id,name").eq("org_id", orgId).order("name").limit(2000),
  ]);
  if (s.error || c.error) return fail(s.error ?? c.error);
  const cases = (c.data ?? []) as DunningCaseRow[];
  const notices = (n.data ?? []) as DunningNoticeRow[];
  const pauses = (p.data ?? []) as DunningPauseRow[];
  const [nums, fams] = await Promise.all([
    invoiceNumbers(cases.map((x) => x.invoice_id)),
    familyNames([...cases.map((x) => x.family_id), ...pauses.map((x) => x.family_id)]),
  ]);
  return ok({
    settings: dunningFromRow((s.data ?? null) as DunningSettingsRow | null),
    cases: cases.map((x) => ({ ...x, invoiceNumber: nums.get(x.invoice_id) ?? null, familyName: fams.get(x.family_id) ?? null, notices: notices.filter((y) => y.case_id === x.id) })),
    pauses: pauses.map((x) => ({ ...x, familyName: fams.get(x.family_id) ?? null })),
    families: (f.data ?? []) as Named[],
  });
}

// ---------------------------------------------------------------------------
// Family support + reimbursements
// ---------------------------------------------------------------------------
export type SupportView = SupportDiscountRow & { familyName: string | null; granted: number };
export async function getSupport(orgId: string): Promise<Result<{ discounts: SupportView[]; reimbursements: (ReimbursementRow & { familyName: string | null; invoiceNumber: string | null })[]; families: Named[] }>> {
  const db = await accountingDb();
  const [d, r, f, used] = await Promise.all([
    db.from("discounts").select("*").eq("org_id", orgId).eq("rule", "family_support").order("created_at", { ascending: false }),
    db.from("external_reimbursements").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(500),
    db.from("families").select("id,name").eq("org_id", orgId).order("name").limit(2000),
    db.from("applied_discounts").select("discount_id,amount").eq("org_id", orgId).eq("source", "family_support").is("voided_at", null),
  ]);
  if (d.error || r.error) return fail(d.error ?? r.error);
  const fams = new Map(((f.data ?? []) as Named[]).map((x) => [x.id, x.name]));
  const granted = new Map<string, number>();
  for (const u of (used.data ?? []) as { discount_id: string; amount: number }[]) {
    granted.set(u.discount_id, Math.round(((granted.get(u.discount_id) ?? 0) + Number(u.amount)) * 100) / 100);
  }
  const reimb = (r.data ?? []) as ReimbursementRow[];
  const nums = await invoiceNumbers(reimb.map((x) => x.invoice_id).filter((x): x is string => !!x));
  return ok({
    discounts: ((d.data ?? []) as SupportDiscountRow[]).map((x) => ({ ...x, familyName: x.scope_family_id ? fams.get(x.scope_family_id) ?? null : null, granted: granted.get(x.id) ?? 0 })),
    reimbursements: reimb.map((x) => ({ ...x, familyName: x.family_id ? fams.get(x.family_id) ?? null : null, invoiceNumber: x.invoice_id ? nums.get(x.invoice_id) ?? null : null })),
    families: (f.data ?? []) as Named[],
  });
}

/** Totals per funder kind and status (report). */
export function reimbursementReport(rows: ReimbursementRow[]): { key: string; currency: string; expected: number; received: number; open: number; count: number }[] {
  const m = new Map<string, { key: string; currency: string; expected: number; received: number; open: number; count: number }>();
  for (const r of rows) {
    if (r.status === "rejected") continue;
    const key = `${r.funder_kind}|${r.currency}`;
    const cur = m.get(key) ?? { key: r.funder_kind, currency: r.currency, expected: 0, received: 0, open: 0, count: 0 };
    cur.expected += Math.round(Number(r.amount_expected) * 100);
    cur.received += Math.round(Number(r.amount_received ?? 0) * 100);
    if (r.status !== "received") cur.open += Math.round(Number(r.amount_expected) * 100);
    cur.count += 1;
    m.set(key, cur);
  }
  return Array.from(m.values()).map((v) => ({ ...v, expected: v.expected / 100, received: v.received / 100, open: v.open / 100 }));
}
