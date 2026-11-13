import "server-only";
import { financeDb, type FinanceClient } from "./db";
import { clockMinutesForPayouts } from "./clock-hook";
import {
  computeCoachPayout, familyBalances, inRange, isSettled, monthBounds, sumMoney,
  type CoachActivity, type CreditFact, type ExpenseFact, type FamilyBalance, type InvoiceFact, type PaymentFact,
  type PayoutCalc, type Range, type RateType, type UpcomingFact,
} from "./math";

/**
 * Server-side reads for the finance module. Every query runs with the
 * signed-in user's RLS client AND filters on the org id that came from the
 * session (never from the client). Callers check the admin / finance role.
 */
export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(d: T): Result<T> => ({ data: d, error: null });
const fail = (e: string): Result<never> => ({ data: null, error: e });
const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v));
const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => Boolean(x))));
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const endIso = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString();
export const todayKey = () => new Date().toISOString().slice(0, 10);

/** Default length of a led session when its schedule has no end time. */
export const DEFAULT_SESSION_MINUTES = 60;

/** Pages through a PostgREST query (servers cap a response at ~1000 rows). */
async function fetchAll<R>(page: (from: number, to: number) => PromiseLike<{ data: R[] | null; error: { message: string } | null }>, max = 50_000): Promise<R[]> {
  const out: R[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function inChunks<R>(ids: string[], run: (chunk: string[]) => PromiseLike<{ data: R[] | null; error: { message: string } | null }>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await run(ids.slice(i, i + 300));
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reference data (labels and select options)
// ---------------------------------------------------------------------------
export type Option = { id: string; name: string; active?: boolean };
export type FinanceRefs = {
  categories: Option[]; suppliers: (Option & { contact: string | null; notes: string | null })[];
  coaches: Option[]; programs: (Option & { location: string | null })[]; camps: (Option & { programId: string; location: string | null; startsOn: string })[];
  teams: Option[]; venues: Option[];
};

export async function loadRefs(orgId: string, db?: FinanceClient): Promise<FinanceRefs> {
  const c = db ?? (await financeDb());
  const [cats, sups, coaches, programs, camps, teams, venues] = await Promise.all([
    c.from("expense_categories").select("id,name,is_active,sort").eq("org_id", orgId).order("sort").order("name"),
    c.from("expense_suppliers").select("id,name,contact,notes,is_active").eq("org_id", orgId).order("name"),
    c.from("coaches").select("id,display_name,is_active").eq("org_id", orgId).order("display_name"),
    c.from("programs").select("id,name,location,is_active").eq("org_id", orgId).order("name"),
    c.from("camp_editions").select("id,program_id,name,starts_on,ends_on,venue_id,location_name,city,status").eq("org_id", orgId).order("starts_on", { ascending: false }),
    c.from("teams").select("id,name,is_active").eq("org_id", orgId).order("name"),
    c.from("venues").select("id,name,city,is_active").eq("org_id", orgId).order("name"),
  ]);
  const venueName = new Map((venues.data ?? []).map((v) => [v.id, v.name]));
  const programName = new Map((programs.data ?? []).map((p) => [p.id, p.name]));
  return {
    categories: (cats.data ?? []).map((x) => ({ id: x.id, name: x.name, active: x.is_active })),
    suppliers: (sups.data ?? []).map((x) => ({ id: x.id, name: x.name, active: x.is_active, contact: x.contact, notes: x.notes })),
    coaches: (coaches.data ?? []).map((x) => ({ id: x.id, name: x.display_name, active: x.is_active })),
    programs: (programs.data ?? []).map((x) => ({ id: x.id, name: x.name, active: x.is_active, location: x.location })),
    camps: (camps.data ?? []).map((x) => ({
      id: x.id, programId: x.program_id, startsOn: x.starts_on, active: x.status !== "archived" && x.status !== "cancelled",
      name: `${programName.get(x.program_id) ?? ""}${x.name ? ` · ${x.name}` : ""} (${x.starts_on})`,
      location: (x.venue_id ? venueName.get(x.venue_id) : null) ?? x.location_name ?? x.city ?? null,
    })),
    teams: (teams.data ?? []).map((x) => ({ id: x.id, name: x.name, active: x.is_active })),
    venues: (venues.data ?? []).map((x) => ({ id: x.id, name: x.name, active: x.is_active })),
  };
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
export type ExpenseFilters = {
  from?: string; to?: string; categoryId?: string; supplierId?: string; coachId?: string; programId?: string;
  status?: "paid" | "unpaid"; q?: string; recurring?: boolean;
};
export type ExpenseListItem = {
  id: string; date: string; amount: number; currency: string; status: "paid" | "unpaid"; paidOn: string | null;
  categoryId: string | null; supplierId: string | null; coachId: string | null; programId: string | null;
  campEditionId: string | null; teamId: string | null; venueId: string | null;
  description: string | null; method: string; hasReceipt: boolean; receiptName: string | null;
  recurringMonthly: boolean; isRecurringCopy: boolean; payoutId: string | null;
};

const EXPENSE_COLS = "id,expense_date,amount,currency,status,paid_on,category_id,supplier_id,coach_id,program_id,camp_edition_id,team_id,venue_id,description,payment_method,receipt_path,receipt_name,recurring_monthly,recurrence_parent_id,coach_payout_id";

type ExpenseSel = {
  id: string; expense_date: string; amount: number | string; currency: string; status: "paid" | "unpaid"; paid_on: string | null;
  category_id: string | null; supplier_id: string | null; coach_id: string | null; program_id: string | null;
  camp_edition_id: string | null; team_id: string | null; venue_id: string | null; description: string | null;
  payment_method: string; receipt_path: string | null; receipt_name: string | null; recurring_monthly: boolean;
  recurrence_parent_id: string | null; coach_payout_id: string | null;
};
const toItem = (e: ExpenseSel): ExpenseListItem => ({
  id: e.id, date: e.expense_date, amount: num(e.amount), currency: e.currency, status: e.status, paidOn: e.paid_on,
  categoryId: e.category_id, supplierId: e.supplier_id, coachId: e.coach_id, programId: e.program_id,
  campEditionId: e.camp_edition_id, teamId: e.team_id, venueId: e.venue_id, description: e.description,
  method: e.payment_method, hasReceipt: !!e.receipt_path, receiptName: e.receipt_name,
  recurringMonthly: e.recurring_monthly, isRecurringCopy: !!e.recurrence_parent_id, payoutId: e.coach_payout_id,
});

export async function listExpenses(orgId: string, f: ExpenseFilters = {}): Promise<Result<ExpenseListItem[]>> {
  try {
    const db = await financeDb();
    const rows = await fetchAll<ExpenseSel>((a, b) => {
      let q = db.from("expenses").select(EXPENSE_COLS).eq("org_id", orgId).is("deleted_at", null);
      if (f.from) q = q.gte("expense_date", f.from);
      if (f.to) q = q.lte("expense_date", f.to);
      if (f.categoryId) q = q.eq("category_id", f.categoryId);
      if (f.supplierId) q = q.eq("supplier_id", f.supplierId);
      if (f.coachId) q = q.eq("coach_id", f.coachId);
      if (f.programId) q = q.eq("program_id", f.programId);
      if (f.status) q = q.eq("status", f.status);
      if (f.recurring) q = q.eq("recurring_monthly", true);
      return q.order("expense_date", { ascending: false }).order("created_at", { ascending: false }).range(a, b) as unknown as PromiseLike<{ data: ExpenseSel[] | null; error: { message: string } | null }>;
    }, 10_000);
    const needle = (f.q ?? "").trim().toLowerCase();
    const items = rows.map(toItem);
    return ok(needle ? items.filter((e) => (e.description ?? "").toLowerCase().includes(needle)) : items);
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function getExpense(orgId: string, id: string): Promise<ExpenseListItem | null> {
  const db = await financeDb();
  const { data } = await db.from("expenses").select(EXPENSE_COLS).eq("org_id", orgId).eq("id", id).is("deleted_at", null).maybeSingle();
  return data ? toItem(data as unknown as ExpenseSel) : null;
}

// ---------------------------------------------------------------------------
// Facts for reports, balances and the ledger
// ---------------------------------------------------------------------------
export type FinanceFacts = {
  payments: (PaymentFact & { reference: string | null; voided: boolean; createdAt: string })[];
  invoices: (InvoiceFact & { familyName: string })[];
  expenses: (ExpenseFact & { description: string | null; supplierId: string | null; method: string })[];
  adjustments: { id: string; invoiceId: string; number: string; kind: string; amount: number; currency: string; date: string; reason: string }[];
  credits: (CreditFact & { kind: string; date: string; reason: string })[];
  upcoming: UpcomingFact[];
  refs: FinanceRefs;
  families: Map<string, string>;
};

export async function loadFacts(orgId: string, orgCurrency: string): Promise<Result<FinanceFacts>> {
  try {
    const db = await financeDb();
    const today = todayKey();
    const [refs, invoices, payments, expenses, adjustments, credits, families, regs, bookings] = await Promise.all([
      loadRefs(orgId, db),
      fetchAll((a, b) => db.from("invoices")
        .select("id,number,family_id,program_id,registration_id,currency,total_chf,adjustments_total,status,due_date,issued_at")
        .eq("org_id", orgId).order("issued_at").range(a, b)),
      fetchAll((a, b) => db.from("payments")
        .select("id,invoice_id,amount_chf,currency,method,status,paid_at,created_at,qr_reference,voided_at,reverses_payment_id")
        .eq("org_id", orgId).order("created_at").range(a, b)),
      fetchAll((a, b) => db.from("expenses")
        .select("id,expense_date,amount,currency,status,category_id,supplier_id,program_id,camp_edition_id,venue_id,description,payment_method")
        .eq("org_id", orgId).is("deleted_at", null).order("expense_date").range(a, b)),
      fetchAll((a, b) => db.from("invoice_adjustments")
        .select("id,invoice_id,number,kind,amount,currency,created_at,reason,voided_at")
        .eq("org_id", orgId).is("voided_at", null).order("created_at").range(a, b)),
      fetchAll((a, b) => db.from("family_credit_entries")
        .select("id,family_id,amount,currency,kind,created_at,reason").eq("org_id", orgId).order("created_at").range(a, b)),
      fetchAll((a, b) => db.from("families").select("id,name").eq("org_id", orgId).range(a, b)),
      fetchAll((a, b) => db.from("registrations")
        .select("id,invoice_id,camp_edition_id,status,price_amount,price_currency")
        .eq("org_id", orgId).not("camp_edition_id", "is", null).range(a, b)),
      fetchAll((a, b) => db.from("training_bookings")
        .select("id,slot_start,status,invoice_id,price_chf,credits_used")
        .eq("org_id", orgId).eq("status", "booked").gte("slot_start", `${today}T00:00:00Z`).is("invoice_id", null).range(a, b)),
    ]);

    const famName = new Map(families.map((f) => [f.id, f.name]));
    const programLoc = new Map(refs.programs.map((p) => [p.id, p.location]));
    const camp = new Map(refs.camps.map((c) => [c.id, c]));
    const venueName = new Map(refs.venues.map((v) => [v.id, v.name]));
    const editionByInvoice = new Map<string, string>();
    const editionByReg = new Map<string, string>();
    for (const r of regs) {
      if (!r.camp_edition_id) continue;
      editionByReg.set(r.id, r.camp_edition_id);
      if (r.invoice_id) editionByInvoice.set(r.invoice_id, r.camp_edition_id);
    }

    const inv = invoices.map((i) => {
      const editionId = editionByInvoice.get(i.id) ?? (i.registration_id ? editionByReg.get(i.registration_id) ?? null : null);
      const programId = i.program_id ?? (editionId ? camp.get(editionId)?.programId ?? null : null);
      return {
        id: i.id, number: i.number, familyId: i.family_id, familyName: famName.get(i.family_id) ?? "—",
        currency: i.currency, status: i.status, total: num(i.total_chf), adjustmentsTotal: num(i.adjustments_total),
        issuedDate: day(i.issued_at), dueDate: i.due_date, programId, campEditionId: editionId,
        location: (editionId ? camp.get(editionId)?.location : null) ?? (programId ? programLoc.get(programId) ?? null : null),
      };
    });
    const pays = payments.map((p) => ({
      id: p.id, invoiceId: p.invoice_id, amount: num(p.amount_chf), currency: p.currency, status: p.status, method: p.method,
      date: day(p.paid_at ?? p.created_at), createdAt: p.created_at, reference: p.qr_reference,
      voided: !!p.voided_at, isReversal: !!p.reverses_payment_id,
    }));
    const exps = expenses.map((e) => ({
      id: e.id, date: e.expense_date, amount: num(e.amount), currency: e.currency, status: e.status,
      categoryId: e.category_id, supplierId: e.supplier_id, programId: e.program_id ?? (e.camp_edition_id ? camp.get(e.camp_edition_id)?.programId ?? null : null),
      campEditionId: e.camp_edition_id, description: e.description, method: e.payment_method,
      location: (e.venue_id ? venueName.get(e.venue_id) ?? null : null)
        ?? (e.camp_edition_id ? camp.get(e.camp_edition_id)?.location ?? null : null)
        ?? (e.program_id ? programLoc.get(e.program_id) ?? null : null),
    }));
    const upcoming: UpcomingFact[] = [
      ...bookings.filter((b) => num(b.price_chf) > 0 && !b.credits_used)
        .map((b) => ({ date: day(b.slot_start), amount: num(b.price_chf), currency: orgCurrency, source: "training" as const })),
      ...regs.filter((r) => !r.invoice_id && (r.status === "pending" || r.status === "confirmed") && num(r.price_amount) > 0 && r.camp_edition_id)
        .map((r) => ({ date: camp.get(r.camp_edition_id!)?.startsOn ?? today, amount: num(r.price_amount), currency: r.price_currency ?? orgCurrency, source: "camp" as const }))
        .filter((u) => u.date >= today),
    ];
    return ok({
      payments: pays, invoices: inv, expenses: exps,
      adjustments: adjustments.map((a) => ({ id: a.id, invoiceId: a.invoice_id, number: a.number, kind: a.kind, amount: num(a.amount), currency: a.currency, date: day(a.created_at), reason: a.reason })),
      credits: credits.map((c) => ({ familyId: c.family_id, amount: num(c.amount), currency: c.currency, kind: c.kind, date: day(c.created_at), reason: c.reason })),
      upcoming, refs, families: famName,
    });
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** Currencies that appear in the org's money, org currency first. */
export function currenciesIn(facts: FinanceFacts, orgCurrency: string): string[] {
  const set = new Set<string>([orgCurrency]);
  for (const x of [...facts.payments, ...facts.invoices, ...facts.expenses]) set.add(x.currency);
  return Array.from(set);
}

// ---------------------------------------------------------------------------
// Balances per family
// ---------------------------------------------------------------------------
export type BalanceRow = FamilyBalance & { familyName: string };
export function balancesFromFacts(facts: FinanceFacts): BalanceRow[] {
  return familyBalances(facts.invoices, facts.payments, facts.credits).map((b) => ({ ...b, familyName: facts.families.get(b.familyId) ?? "—" }));
}

// ---------------------------------------------------------------------------
// Transactions ledger (payments, refunds, reversals, credit notes, expenses)
// ---------------------------------------------------------------------------
export const LEDGER_TYPES = ["payment", "refund", "reversal", "credit_note", "debit_note", "write_off", "cancellation", "family_credit", "expense"] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];
export type LedgerEntry = {
  id: string; date: string; type: LedgerType; reference: string; party: string; description: string;
  /** Signed effect: money in / receivable reduction negative for credits, expenses negative. */
  amount: number; currency: string; cash: boolean; href: string | null;
};

export function ledgerFromFacts(facts: FinanceFacts, r: Range, opts: { types?: LedgerType[]; currency?: string } = {}): LedgerEntry[] {
  const invById = new Map(facts.invoices.map((i) => [i.id, i]));
  const cat = new Map(facts.refs.categories.map((c) => [c.id, c.name]));
  const sup = new Map(facts.refs.suppliers.map((s) => [s.id, s.name]));
  const out: LedgerEntry[] = [];
  for (const p of facts.payments) {
    if (!inRange(p.date, r) || p.status === "failed" || p.status === "pending") continue;
    if (!isSettled(p) && p.amount < 0) continue;
    const i = p.invoiceId ? invById.get(p.invoiceId) : undefined;
    const type: LedgerType = p.amount >= 0 ? "payment" : p.isReversal || p.status === "succeeded" ? "reversal" : "refund";
    out.push({ id: `p:${p.id}`, date: p.date, type, reference: i?.number ?? "", party: i?.familyName ?? "", description: p.method,
      amount: p.amount, currency: p.currency, cash: true, href: i ? `/admin/invoices/${i.id}` : null });
  }
  for (const a of facts.adjustments) {
    if (!inRange(a.date, r)) continue;
    const i = invById.get(a.invoiceId);
    out.push({ id: `a:${a.id}`, date: a.date, type: a.kind as LedgerType, reference: a.number, party: i?.familyName ?? "",
      description: a.reason, amount: a.kind === "debit_note" ? Math.abs(a.amount) : -Math.abs(a.amount), currency: a.currency, cash: false,
      href: i ? `/admin/invoices/${i.id}` : null });
  }
  for (const c of facts.credits) {
    if (!inRange(c.date, r)) continue;
    out.push({ id: `c:${c.familyId}:${c.date}:${out.length}`, date: c.date, type: "family_credit", reference: c.kind, party: facts.families.get(c.familyId) ?? "",
      description: c.reason, amount: c.amount, currency: c.currency, cash: false, href: `/admin/families/${c.familyId}` });
  }
  for (const e of facts.expenses) {
    if (!inRange(e.date, r)) continue;
    out.push({ id: `e:${e.id}`, date: e.date, type: "expense", reference: e.categoryId ? cat.get(e.categoryId) ?? "" : "",
      party: e.supplierId ? sup.get(e.supplierId) ?? "" : "", description: e.description ?? "", amount: -e.amount, currency: e.currency,
      cash: e.status === "paid", href: `/admin/finance/expenses/${e.id}` });
  }
  return out
    .filter((x) => (!opts.types?.length || opts.types.includes(x.type)) && (!opts.currency || x.currency === opts.currency))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Coach payouts
// ---------------------------------------------------------------------------
export type PayoutLine = {
  coachId: string; coachName: string; active: boolean;
  rate: { rateType: RateType; amount: number; currency: string; notes: string | null } | null;
  activity: CoachActivity; clockMinutes: number | null; calc: PayoutCalc | null;
  payout: { id: string; amount: number; currency: string; paidOn: string; expenseId: string | null } | null;
};

/** Sessions a coach led (submitted, or with a present / late mark) and completed bookings, in [from, to]. */
export async function loadCoachActivity(orgId: string, r: Range): Promise<Map<string, CoachActivity>> {
  const db = await financeDb();
  const startIso = `${r.from}T00:00:00Z`;
  const stopIso = endIso(r.to);
  const [sessions, bookings] = await Promise.all([
    fetchAll((a, b) => db.from("attendance_sessions").select("id,coach_id,program_session_id,status,session_date")
      .eq("org_id", orgId).not("coach_id", "is", null).gte("session_date", startIso).lt("session_date", stopIso).range(a, b)),
    fetchAll((a, b) => db.from("training_bookings").select("id,coach_id,slot_start,slot_end,status")
      .eq("org_id", orgId).eq("status", "completed").gte("slot_start", startIso).lt("slot_start", stopIso).range(a, b)),
  ]);
  const openIds = sessions.filter((s) => s.status === "open").map((s) => s.id);
  const attended = new Set(
    (await inChunks(openIds, (c) => db.from("attendance_marks").select("attendance_session_id").in("attendance_session_id", c).in("status", ["present", "late"])))
      .map((m) => m.attendance_session_id),
  );
  const psIds = uniq(sessions.map((s) => s.program_session_id));
  const ps = new Map((await inChunks(psIds, (c) => db.from("program_sessions").select("id,starts_at,ends_at").eq("org_id", orgId).in("id", c)))
    .map((p) => [p.id, p]));
  const minutesOf = (a: string | null | undefined, b: string | null | undefined) => {
    if (!a || !b) return DEFAULT_SESSION_MINUTES;
    const m = Math.round((Date.parse(b) - Date.parse(a)) / 60000);
    return m > 0 && m <= 24 * 60 ? m : DEFAULT_SESSION_MINUTES;
  };
  const out = new Map<string, CoachActivity>();
  const get = (id: string) => {
    let a = out.get(id);
    if (!a) { a = { sessions: 0, sessionMinutes: 0, bookings: 0, bookingMinutes: 0 }; out.set(id, a); }
    return a;
  };
  for (const s of sessions) {
    if (!s.coach_id || (s.status === "open" && !attended.has(s.id))) continue;
    const p = s.program_session_id ? ps.get(s.program_session_id) : undefined;
    const a = get(s.coach_id);
    a.sessions += 1;
    a.sessionMinutes += minutesOf(p?.starts_at, p?.ends_at);
  }
  for (const b of bookings) {
    const a = get(b.coach_id);
    a.bookings += 1;
    a.bookingMinutes += minutesOf(b.slot_start, b.slot_end);
  }
  return out;
}

export async function payoutReport(orgId: string, month: string): Promise<Result<PayoutLine[]>> {
  try {
    const r = monthBounds(`${month}-01`);
    const db = await financeDb();
    const [coaches, rates, payouts, activity, clock] = await Promise.all([
      db.from("coaches").select("id,display_name,is_active").eq("org_id", orgId).order("display_name"),
      db.from("coach_pay_rates").select("coach_id,rate_type,amount,currency,notes").eq("org_id", orgId),
      db.from("coach_payouts").select("id,coach_id,amount,currency,paid_on,expense_id,status").eq("org_id", orgId).eq("period_month", r.from).eq("status", "paid"),
      loadCoachActivity(orgId, r),
      clockMinutesForPayouts(orgId, r.from, r.to),
    ]);
    if (coaches.error) return fail(coaches.error.message);
    const rateBy = new Map((rates.data ?? []).map((x) => [x.coach_id, x]));
    const payBy = new Map((payouts.data ?? []).map((x) => [x.coach_id, x]));
    const lines: PayoutLine[] = (coaches.data ?? [])
      .filter((c) => c.is_active || activity.has(c.id) || payBy.has(c.id))
      .map((c) => {
        const rate = rateBy.get(c.id);
        const act = activity.get(c.id) ?? { sessions: 0, sessionMinutes: 0, bookings: 0, bookingMinutes: 0 };
        const cm = clock.get(c.id) ?? null;
        const rr = rate ? { rateType: rate.rate_type, amount: num(rate.amount), currency: rate.currency, notes: rate.notes } : null;
        const p = payBy.get(c.id);
        return {
          coachId: c.id, coachName: c.display_name, active: c.is_active, rate: rr, activity: act, clockMinutes: cm,
          calc: rr ? computeCoachPayout(rr, act, cm) : null,
          payout: p ? { id: p.id, amount: num(p.amount), currency: p.currency, paidOn: p.paid_on, expenseId: p.expense_id } : null,
        };
      });
    return ok(lines);
  } catch (e) {
    return fail((e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export type StudentFacts = { createdDate: string; status: string }[];

export async function loadStudents(orgId: string): Promise<StudentFacts> {
  const db = await financeDb();
  const rows = await fetchAll((a, b) => db.from("athletes").select("created_at,status").eq("org_id", orgId).range(a, b));
  return rows.map((x) => ({ createdDate: day(x.created_at), status: x.status }));
}

export async function registrationsByProgramCount(orgId: string, r: Range): Promise<{ programId: string; count: number }[]> {
  const db = await financeDb();
  const rows = await fetchAll((a, b) => db.from("registrations").select("program_id,status,created_at").eq("org_id", orgId)
    .gte("created_at", `${r.from}T00:00:00Z`).lt("created_at", endIso(r.to)).range(a, b));
  const by = new Map<string, number>();
  for (const x of rows) if (x.status !== "cancelled") by.set(x.program_id, (by.get(x.program_id) ?? 0) + 1);
  return Array.from(by.entries()).map(([programId, count]) => ({ programId, count })).sort((a, b) => b.count - a.count);
}

export { sumMoney };
