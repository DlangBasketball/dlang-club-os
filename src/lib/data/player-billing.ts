import "server-only";
import { getSessionUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";
import { invoiceMoney, netPaid } from "@/lib/payments/adjustments";
import { instalmentStatus, todayIn, type InstalmentStatus } from "@/lib/payments/plans";
import { fromMinorUnits, toMinorUnits } from "@/lib/payments/currency";
import { isBillingActivity, type BillingActivity } from "@/lib/billing/activities";
import { moneyStatus, type MoneyStatus } from "@/lib/billing/player-billing";

/*
 * Player billing reads (profile tabs, club memberships, record a payment,
 * receipts, related records). Every read uses the signed-in user's client,
 * so RLS decides what a caller sees (admin / finance: their club; a guardian:
 * the invoices they pay; coaches: no money). Staff-only reads also check the
 * role here and filter by the caller's org explicitly. The org is never taken
 * from the client. Backend contract: docs/billing-foundation.md.
 */

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T,>(data: T): Result<T> => ({ data, error: null });
const fail = <T,>(error: string): Result<T> => ({ data: null, error });
const num = (v: unknown) => Number(v ?? 0);
const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => !!x)));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/*
 * Several tables used here (teams, plans, receipts' payment links) are not in
 * the generated types yet; this module reads them through an untyped view of
 * the same RLS-scoped client and maps every row to an explicit type below.
 */
type Res = { data: unknown; error: { message: string } | null; count?: number | null };
// The PostgREST builder is chainable and thenable; typed loosely on purpose.
type Builder = any;
type LooseDb = { from: (table: string) => Builder; rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<Res> };
async function looseDb(): Promise<LooseDb> {
  return (await createClient()) as unknown as LooseDb;
}
const rows = <T,>(r: Res): T[] => (r.error ? [] : ((r.data ?? []) as T[]));

type Staff = { orgId: string; isAdmin: boolean; isFinance: boolean };
async function staff(): Promise<Staff | null> {
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) return null;
  return { orgId: me.orgId, isAdmin: me.roles.includes("admin"), isFinance: true };
}

// ---------------------------------------------------------------------------
// Invoice money (shared)
// ---------------------------------------------------------------------------
type InvoiceRaw = {
  id: string; number: string; status: string; activity: string | null; currency: string | null; total_chf: number | null;
  adjustments_total: number | null; due_date: string | null; issued_at: string; family_id: string; athlete_id: string | null;
  program_id: string | null; membership_id: string | null; charge_kind: string | null; payer_kind: string | null; payer_name: string | null;
  source_label: string | null; description: string | null;
};
const INVOICE_COLS =
  "id,number,status,activity,currency,total_chf,adjustments_total,due_date,issued_at,family_id,athlete_id,program_id,membership_id,charge_kind,payer_kind,payer_name,source_label,description";

export type BillingInvoice = {
  id: string; number: string; status: string; category: BillingActivity; categoryLabel: string | null; currency: string;
  total: number; amountDue: number; paid: number; balance: number; dueDate: string | null; issuedAt: string; familyId: string;
  athleteId: string | null; programId: string | null; membershipId: string | null; chargeKind: string | null;
  payerKind: string | null; payerName: string | null; sourceLabel: string | null; description: string | null;
  paymentStatus: MoneyStatus; overdue: boolean;
};

type PaymentRaw = {
  id: string; invoice_id: string; amount_chf: number; currency: string | null; status: string; method: string; paid_at: string | null;
  created_at: string; reference?: string | null; notes: string | null; receipt_id: string | null; installment_id: string | null;
  voided_at: string | null; reverses_payment_id: string | null; method_detail: string | null;
};

const CLOSED = new Set(["cancelled", "void", "written_off", "refunded", "draft"]);
const OPEN = ["pending", "sent", "partially_paid", "overdue"];

async function paymentsFor(db: LooseDb, invoiceIds: string[]): Promise<PaymentRaw[]> {
  const out: PaymentRaw[] = [];
  for (let i = 0; i < invoiceIds.length; i += 200) {
    const r = await db.from("payments")
      .select("id,invoice_id,amount_chf,currency,status,method,paid_at,created_at,notes,receipt_id,installment_id,voided_at,reverses_payment_id,method_detail")
      .in("invoice_id", invoiceIds.slice(i, i + 200)).order("created_at");
    if (r.error) throw new Error(r.error.message);
    out.push(...((r.data ?? []) as PaymentRaw[]));
  }
  return out;
}

/** Selection invoices print the programme series ("EYBL") as their category label. */
async function seriesLabels(db: LooseDb, invoices: InvoiceRaw[]): Promise<Map<string, string>> {
  const ids = uniq(invoices.filter((i) => i.activity === "selection").map((i) => i.program_id));
  if (!ids.length) return new Map();
  const r = await db.from("programs").select("id,name,series").in("id", ids);
  return new Map(rows<{ id: string; name: string; series: string | null }>(r).map((p) => [p.id, (p.series ?? "").trim() || p.name]));
}

function decorateInvoices(invoices: InvoiceRaw[], payments: PaymentRaw[], labels: Map<string, string>, today: string): BillingInvoice[] {
  const byInv = new Map<string, PaymentRaw[]>();
  for (const p of payments) byInv.set(p.invoice_id, [...(byInv.get(p.invoice_id) ?? []), p]);
  return invoices.map((i) => {
    const currency = (i.currency ?? "CHF").toUpperCase();
    const m = invoiceMoney({
      total: num(i.total_chf), adjustmentsTotal: num(i.adjustments_total), currency,
      paid: netPaid((byInv.get(i.id) ?? []).map((p) => ({ amount: num(p.amount_chf), status: p.status })), currency),
    });
    const closed = CLOSED.has(i.status);
    const balance = closed ? 0 : Math.max(m.balance, 0);
    const category: BillingActivity = isBillingActivity(i.activity) ? i.activity : "other";
    return {
      id: i.id, number: i.number, status: i.status, category,
      categoryLabel: category === "selection" && i.program_id ? labels.get(i.program_id) ?? null : null,
      currency, total: m.total, amountDue: m.amountDue, paid: m.paid, balance, dueDate: i.due_date, issuedAt: i.issued_at,
      familyId: i.family_id, athleteId: i.athlete_id, programId: i.program_id, membershipId: i.membership_id, chargeKind: i.charge_kind,
      payerKind: i.payer_kind, payerName: i.payer_name, sourceLabel: i.source_label, description: i.description,
      paymentStatus: closed && i.status !== "draft" ? (m.paid > 0 ? "paid" : "none") : moneyStatus(m.amountDue, balance, currency),
      overdue: !closed && balance > 0 && (i.status === "overdue" || (!!i.due_date && i.due_date < today)),
    };
  });
}

async function invoicesWithMoney(db: LooseDb, invoices: InvoiceRaw[], today: string) {
  const [payments, labels] = await Promise.all([paymentsFor(db, invoices.map((i) => i.id)), seriesLabels(db, invoices)]);
  return { invoices: decorateInvoices(invoices, payments, labels, today), payments };
}

async function clubTodayFor(db: LooseDb, orgId: string): Promise<string> {
  const r = await db.from("organizations").select("timezone").eq("id", orgId).maybeSingle();
  const tz = (r.data as { timezone?: string | null } | null)?.timezone || "Europe/Zurich";
  try { return todayIn(tz); } catch { return new Date().toISOString().slice(0, 10); }
}

// ---------------------------------------------------------------------------
// Instalments of invoices
// ---------------------------------------------------------------------------
export type InstallmentView = {
  id: string; invoiceId: string; seq: number; dueDate: string; amount: number; amountPaid: number; outstanding: number; currency: string;
  status: InstalmentStatus; rawStatus: string;
};

async function installmentsFor(db: LooseDb, invoiceIds: string[], today: string): Promise<InstallmentView[]> {
  if (!invoiceIds.length) return [];
  const plans = rows<{ id: string; invoice_id: string }>(
    await db.from("payment_plans").select("id,invoice_id").in("invoice_id", invoiceIds).eq("kind", "installments")
      .in("status", ["active", "paused", "completed"]),
  );
  if (!plans.length) return [];
  const invOf = new Map(plans.map((p) => [p.id, p.invoice_id]));
  const inst = rows<{ id: string; plan_id: string; seq: number; due_date: string; amount: number; amount_paid: number; currency: string; status: string }>(
    await db.from("payment_plan_installments").select("id,plan_id,seq,due_date,amount,amount_paid,currency,status").in("plan_id", plans.map((p) => p.id)),
  );
  return inst.map((r) => {
    const cur = r.currency || "CHF";
    const outstanding = ["paid", "cancelled", "skipped"].includes(r.status)
      ? 0 : fromMinorUnits(Math.max(toMinorUnits(num(r.amount), cur) - toMinorUnits(num(r.amount_paid), cur), 0), cur);
    return {
      id: r.id, invoiceId: invOf.get(r.plan_id) ?? "", seq: r.seq, dueDate: r.due_date, amount: num(r.amount), amountPaid: num(r.amount_paid),
      outstanding, currency: cur, rawStatus: r.status, status: instalmentStatus({ status: r.status, dueDate: r.due_date, outstanding }, today),
    };
  }).sort((a, b) => a.invoiceId.localeCompare(b.invoiceId) || a.seq - b.seq);
}

// ---------------------------------------------------------------------------
// Club memberships (profile tab, membership list, membership page)
// ---------------------------------------------------------------------------
export type MembershipPayerView = {
  id: string; kind: string; name: string | null; email: string | null; shareKind: "fixed" | "percent"; shareValue: number; amount: number;
  invoiceId: string | null;
};
export type MembershipPaymentView = {
  id: string; invoiceId: string; invoiceNumber: string; amount: number; currency: string; paidAt: string | null; method: string;
  voided: boolean; isReversal: boolean; receiptId: string | null;
};
export type MembershipMoney = { invoiced: number; paid: number; balance: number };
export type MembershipView = {
  id: string; athleteId: string | null; athleteName: string; familyId: string; familyName: string | null;
  seasonId: string | null; seasonName: string | null; seasonStartsOn: string | null; seasonEndsOn: string | null; isCurrentSeason: boolean;
  /** season_fee = club season membership; null = typed membership (membership type). */
  kind: "season_fee" | null; typeName: string | null; status: string; validFrom: string; validUntil: string;
  agreedFee: number; currency: string; sponsored: boolean; sponsoredNotes: string | null;
  installmentCount: number | null; firstDueMonth: string | null; dueDay: number | null;
  payers: MembershipPayerView[];
  /** Season-fee invoices (and adjustments) — the carry-forward invoices are listed separately. */
  invoices: BillingInvoice[];
  carryForwardInvoices: BillingInvoice[];
  installments: InstallmentView[];
  payments: MembershipPaymentView[];
  seasonFee: MembershipMoney;
  carryForward: MembershipMoney;
  paymentStatus: MoneyStatus;
  overdue: boolean;
  teams: { id: string; name: string }[];
  createdAt: string;
};

type MembershipRaw = {
  id: string; org_id: string; membership_type_id: string | null; family_id: string; athlete_id: string | null; valid_from: string; valid_until: string;
  status: string; price_amount: number; currency: string; invoice_id: string | null; season_id: string | null; kind: "season_fee" | null;
  agreed_fee: number | null; installment_count: number | null; first_due_month: string | null; due_day: number | null; sponsored: boolean | null;
  sponsored_notes: string | null; created_at: string;
};

function sumMoney(invs: BillingInvoice[], cur: string): MembershipMoney {
  const live = invs.filter((i) => !["cancelled", "void", "draft"].includes(i.status));
  const s = (f: (i: BillingInvoice) => number) => fromMinorUnits(live.reduce((a, i) => a + toMinorUnits(f(i), cur), 0), cur);
  return { invoiced: s((i) => i.amountDue), paid: s((i) => i.paid), balance: s((i) => i.balance) };
}

async function decorateMemberships(db: LooseDb, orgId: string, list: MembershipRaw[], opts: { withTeams?: boolean } = {}): Promise<MembershipView[]> {
  if (!list.length) return [];
  const ids = list.map((m) => m.id);
  const today = await clubTodayFor(db, orgId);
  const [athletes, families, seasons, types, payers, invByMembership, legacyInv] = await Promise.all([
    db.from("athletes").select("id,first_name,last_name").in("id", uniq(list.map((m) => m.athlete_id))),
    db.from("families").select("id,name").in("id", uniq(list.map((m) => m.family_id))),
    db.from("seasons").select("id,name,starts_on,ends_on,is_current").in("id", uniq(list.map((m) => m.season_id))),
    db.from("membership_types").select("id,name").in("id", uniq(list.map((m) => m.membership_type_id))),
    db.from("membership_payers").select("id,membership_id,sort,payer_kind,payer_name,payer_email,share_kind,share_value,amount,invoice_id")
      .in("membership_id", ids).order("sort"),
    db.from("invoices").select(INVOICE_COLS).in("membership_id", ids).order("issued_at"),
    db.from("invoices").select(INVOICE_COLS).in("id", uniq(list.map((m) => m.invoice_id))),
  ]);
  const aName = new Map(rows<{ id: string; first_name: string; last_name: string }>(athletes).map((a) => [a.id, `${a.first_name} ${a.last_name}`.trim()]));
  const fName = new Map(rows<{ id: string; name: string }>(families).map((f) => [f.id, f.name]));
  const sMap = new Map(rows<{ id: string; name: string; starts_on: string; ends_on: string; is_current: boolean }>(seasons).map((s) => [s.id, s]));
  const tName = new Map(rows<{ id: string; name: string }>(types).map((t) => [t.id, t.name]));
  const pRows = rows<{ id: string; membership_id: string; payer_kind: string; payer_name: string | null; payer_email: string | null; share_kind: "fixed" | "percent"; share_value: number; amount: number; invoice_id: string | null }>(payers);

  // Invoices: linked by membership_id, plus the legacy membership.invoice_id.
  const invRaw = new Map<string, InvoiceRaw>();
  for (const i of [...rows<InvoiceRaw>(invByMembership), ...rows<InvoiceRaw>(legacyInv)]) invRaw.set(i.id, i);
  const { invoices, payments } = await invoicesWithMoney(db, Array.from(invRaw.values()), today);
  const invById = new Map(invoices.map((i) => [i.id, i]));
  const installments = await installmentsFor(db, invoices.map((i) => i.id), today);

  // Team assignments (display only: team changes never change the fee).
  const teamsByAthlete = new Map<string, { id: string; name: string; seasonId: string | null }[]>();
  if (opts.withTeams !== false) {
    const athleteIds = uniq(list.map((m) => m.athlete_id));
    if (athleteIds.length) {
      const tm = rows<{ athlete_id: string; team_id: string; status: string; left_on: string | null }>(
        await db.from("team_memberships").select("athlete_id,team_id,status,left_on").in("athlete_id", athleteIds),
      ).filter((x) => !x.left_on);
      const teams = rows<{ id: string; name: string; season_id: string | null }>(
        tm.length ? await db.from("teams").select("id,name,season_id").in("id", uniq(tm.map((x) => x.team_id))) : { data: [], error: null },
      );
      const teamMap = new Map(teams.map((t) => [t.id, t]));
      for (const x of tm) {
        const t = teamMap.get(x.team_id);
        if (!t) continue;
        const arr = teamsByAthlete.get(x.athlete_id) ?? [];
        if (!arr.some((a) => a.id === t.id)) arr.push({ id: t.id, name: t.name, seasonId: t.season_id });
        teamsByAthlete.set(x.athlete_id, arr);
      }
    }
  }

  return list.map((m) => {
    const cur = (m.currency || "CHF").toUpperCase();
    const own = invoices.filter((i) => i.membershipId === m.id || i.id === m.invoice_id);
    const carry = own.filter((i) => i.chargeKind === "carry_forward");
    const seasonInv = own.filter((i) => i.chargeKind !== "carry_forward");
    const ownIds = new Set(own.map((i) => i.id));
    const season = m.season_id ? sMap.get(m.season_id) : undefined;
    const seasonFee = sumMoney(seasonInv, cur);
    const teams = (m.athlete_id ? teamsByAthlete.get(m.athlete_id) ?? [] : [])
      .filter((t) => !m.season_id || !t.seasonId || t.seasonId === m.season_id)
      .map((t) => ({ id: t.id, name: t.name }));
    return {
      id: m.id, athleteId: m.athlete_id, athleteName: m.athlete_id ? aName.get(m.athlete_id) ?? "" : "", familyId: m.family_id,
      familyName: fName.get(m.family_id) ?? null, seasonId: m.season_id, seasonName: season?.name ?? null,
      seasonStartsOn: season?.starts_on ?? null, seasonEndsOn: season?.ends_on ?? null, isCurrentSeason: !!season?.is_current,
      kind: m.kind, typeName: m.membership_type_id ? tName.get(m.membership_type_id) ?? null : null, status: m.status,
      validFrom: m.valid_from, validUntil: m.valid_until, agreedFee: num(m.agreed_fee ?? m.price_amount), currency: cur,
      sponsored: !!m.sponsored, sponsoredNotes: m.sponsored_notes, installmentCount: m.installment_count,
      firstDueMonth: m.first_due_month, dueDay: m.due_day,
      payers: pRows.filter((p) => p.membership_id === m.id).map((p) => ({
        id: p.id, kind: p.payer_kind, name: p.payer_name, email: p.payer_email, shareKind: p.share_kind, shareValue: num(p.share_value),
        amount: num(p.amount), invoiceId: p.invoice_id,
      })),
      invoices: seasonInv, carryForwardInvoices: carry,
      installments: installments.filter((x) => ownIds.has(x.invoiceId)),
      payments: payments.filter((p) => ownIds.has(p.invoice_id)).map((p) => ({
        id: p.id, invoiceId: p.invoice_id, invoiceNumber: invById.get(p.invoice_id)?.number ?? "", amount: num(p.amount_chf),
        currency: (p.currency ?? cur).toUpperCase(), paidAt: p.paid_at ?? p.created_at, method: p.method, voided: !!p.voided_at,
        isReversal: !!p.reverses_payment_id, receiptId: p.receipt_id,
      })),
      seasonFee, carryForward: sumMoney(carry, cur),
      paymentStatus: m.status === "cancelled" ? "none" : m.sponsored && seasonFee.invoiced === 0 ? "paid" : moneyStatus(seasonFee.invoiced, seasonFee.balance, cur),
      overdue: seasonInv.some((i) => i.overdue) || installments.some((x) => ownIds.has(x.invoiceId) && x.status === "overdue"),
      teams, createdAt: m.created_at,
    };
  });
}

/** Club memberships of one player (every season, newest first). Staff only. */
export async function getPlayerMemberships(athleteId: string): Promise<Result<MembershipView[]>> {
  const me = await staff();
  if (!me) return fail("NOT_AUTHORIZED");
  if (!isUuid(athleteId)) return ok([]);
  try {
    const db = await looseDb();
    const r = await db.from("memberships").select("*").eq("org_id", me.orgId).eq("athlete_id", athleteId).order("valid_from", { ascending: false });
    if (r.error) return fail(r.error.message);
    return ok(await decorateMemberships(db, me.orgId, rows<MembershipRaw>(r)));
  } catch (e) {
    logError("playerBilling.memberships", e);
    return fail("LOAD_FAILED");
  }
}

/** One membership (club membership page). Staff only. */
export async function getMembershipDetail(id: string): Promise<Result<MembershipView | null>> {
  const me = await staff();
  if (!me) return fail("NOT_AUTHORIZED");
  if (!isUuid(id)) return ok(null);
  try {
    const db = await looseDb();
    const r = await db.from("memberships").select("*").eq("org_id", me.orgId).eq("id", id).maybeSingle();
    if (r.error) return fail(r.error.message);
    if (!r.data) return ok(null);
    const [m] = await decorateMemberships(db, me.orgId, [r.data as MembershipRaw]);
    return ok(m ?? null);
  } catch (e) {
    logError("playerBilling.membership", e);
    return fail("LOAD_FAILED");
  }
}

export type SeasonMembershipFilter = { seasonId?: string | null; teamId?: string | null; q?: string | null };

/**
 * Season memberships (club fee) of one season: one row per membership, so a
 * player on two teams is counted once (their teams are listed in the row).
 * Staff only; payment filters are applied by the caller on the result.
 */
export async function listSeasonMemberships(filter: SeasonMembershipFilter): Promise<Result<MembershipView[]>> {
  const me = await staff();
  if (!me) return fail("NOT_AUTHORIZED");
  if (!isUuid(filter.seasonId)) return ok([]);
  try {
    const db = await looseDb();
    let athleteFilter: string[] | null = null;
    if (isUuid(filter.teamId)) {
      const tm = rows<{ athlete_id: string }>(await db.from("team_memberships").select("athlete_id").eq("team_id", filter.teamId).is("left_on", null));
      athleteFilter = uniq(tm.map((x) => x.athlete_id));
      if (!athleteFilter.length) return ok([]);
    }
    const q = (filter.q ?? "").replace(/[%,()*\\]/g, " ").trim().slice(0, 80);
    if (q) {
      let aq = db.from("athletes").select("id").eq("org_id", me.orgId);
      for (const w of q.split(/\s+/).filter(Boolean).slice(0, 3)) aq = aq.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%`);
      const found = uniq(rows<{ id: string }>(await aq.limit(500)).map((a) => a.id));
      athleteFilter = athleteFilter ? athleteFilter.filter((id) => found.includes(id)) : found;
      if (!athleteFilter.length) return ok([]);
    }
    let mq = db.from("memberships").select("*").eq("org_id", me.orgId).eq("season_id", filter.seasonId).eq("kind", "season_fee");
    if (athleteFilter) mq = mq.in("athlete_id", athleteFilter.slice(0, 500));
    const r = await mq.order("created_at", { ascending: false }).limit(1000);
    if (r.error) return fail(r.error.message);
    const list = await decorateMemberships(db, me.orgId, rows<MembershipRaw>(r));
    return ok(list.sort((a, b) => a.athleteName.localeCompare(b.athleteName)));
  } catch (e) {
    logError("playerBilling.seasonMemberships", e);
    return fail("LOAD_FAILED");
  }
}

// ---------------------------------------------------------------------------
// Membership form context
// ---------------------------------------------------------------------------
export type MembershipFormSeason = { id: string; name: string; startsOn: string; endsOn: string; isCurrent: boolean };
export type MembershipFormType = { id: string; name: string; price: number; currency: string | null };
export type MembershipFormPlayer = {
  id: string; name: string; dob: string | null; familyId: string; familyName: string | null;
  familyContact: { name: string | null; email: string | null };
  guardians: { profileId: string; name: string | null; email: string | null; isPrimary: boolean }[];
  teams: { id: string; name: string; seasonId: string | null }[];
  /** Season id -> existing live membership id. */
  existing: Record<string, string>;
};

/** Seasons and membership types for the form (staff). */
export async function getMembershipFormOptions(): Promise<Result<{ seasons: MembershipFormSeason[]; types: MembershipFormType[] }>> {
  const me = await staff();
  if (!me) return fail("NOT_AUTHORIZED");
  const db = await looseDb();
  const [s, t] = await Promise.all([
    db.from("seasons").select("id,name,starts_on,ends_on,is_current").eq("org_id", me.orgId).order("starts_on", { ascending: false }).limit(50),
    db.from("membership_types").select("id,name,price,currency,is_active,scope").eq("org_id", me.orgId).eq("is_active", true).order("sort"),
  ]);
  if (s.error) return fail(s.error.message);
  return ok({
    seasons: rows<{ id: string; name: string; starts_on: string; ends_on: string; is_current: boolean }>(s)
      .map((x) => ({ id: x.id, name: x.name, startsOn: x.starts_on, endsOn: x.ends_on, isCurrent: x.is_current })),
    types: rows<{ id: string; name: string; price: number; currency: string | null; scope: string }>(t)
      .filter((x) => x.scope !== "family").map((x) => ({ id: x.id, name: x.name, price: num(x.price), currency: x.currency })),
  });
}

/** The chosen player with their family, guardians (possible payers), teams and existing memberships. */
export async function getMembershipFormPlayer(athleteId: string): Promise<Result<MembershipFormPlayer | null>> {
  const me = await staff();
  if (!me) return fail("NOT_AUTHORIZED");
  if (!isUuid(athleteId)) return ok(null);
  const db = await looseDb();
  const a = await db.from("athletes").select("id,first_name,last_name,dob,family_id").eq("org_id", me.orgId).eq("id", athleteId).maybeSingle();
  if (a.error) return fail(a.error.message);
  const ath = a.data as { id: string; first_name: string; last_name: string; dob: string | null; family_id: string } | null;
  if (!ath) return ok(null);
  const [fam, fm, tm, ms] = await Promise.all([
    db.from("families").select("id,name,contact_name,contact_email").eq("id", ath.family_id).maybeSingle(),
    db.from("family_members").select("profile_id,is_primary").eq("family_id", ath.family_id),
    db.from("team_memberships").select("team_id,left_on").eq("athlete_id", ath.id),
    db.from("memberships").select("id,season_id,status,kind").eq("org_id", me.orgId).eq("athlete_id", ath.id).eq("kind", "season_fee").neq("status", "cancelled"),
  ]);
  const members = rows<{ profile_id: string; is_primary: boolean }>(fm);
  const profiles = members.length
    ? rows<{ id: string; full_name: string | null; email: string | null }>(await db.from("profiles").select("id,full_name,email").in("id", members.map((m) => m.profile_id)))
    : [];
  const pMap = new Map(profiles.map((p) => [p.id, p]));
  const teamIds = uniq(rows<{ team_id: string; left_on: string | null }>(tm).filter((x) => !x.left_on).map((x) => x.team_id));
  const teams = teamIds.length ? rows<{ id: string; name: string; season_id: string | null }>(await db.from("teams").select("id,name,season_id").in("id", teamIds)) : [];
  const f = fam.data as { id: string; name: string; contact_name: string | null; contact_email: string | null } | null;
  const existing: Record<string, string> = {};
  for (const m of rows<{ id: string; season_id: string | null }>(ms)) if (m.season_id) existing[m.season_id] = m.id;
  return ok({
    id: ath.id, name: `${ath.first_name} ${ath.last_name}`.trim(), dob: ath.dob, familyId: ath.family_id, familyName: f?.name ?? null,
    familyContact: { name: f?.contact_name ?? null, email: f?.contact_email ?? null },
    guardians: members.map((m) => ({ profileId: m.profile_id, name: pMap.get(m.profile_id)?.full_name ?? null, email: pMap.get(m.profile_id)?.email ?? null, isPrimary: !!m.is_primary })),
    teams: teams.map((t) => ({ id: t.id, name: t.name, seasonId: t.season_id })),
    existing,
  });
}

// ---------------------------------------------------------------------------
// Profile: billing overview, bookings
// ---------------------------------------------------------------------------
export type PaymentAllocationView = {
  id: string; invoiceId: string; invoiceNumber: string; category: BillingActivity; categoryLabel: string | null; amount: number; currency: string;
  paidAt: string | null; method: string; voided: boolean; isReversal: boolean;
  receipt: { id: string; payerName: string | null; amount: number; receivedOn: string; reference: string | null } | null;
};
export type CategoryCredit = { activity: BillingActivity | "unassigned"; currency: string; credit: number };
export type PlayerBillingOverview = {
  invoices: BillingInvoice[];
  payments: PaymentAllocationView[];
  credits: CategoryCredit[];
};

/**
 * Billing tab: the player's invoices (and the family's invoices without a
 * player), their payments with receipt allocations, credit per category.
 * Staff only (finance sees billing, never medical data).
 */
export async function getPlayerBillingOverview(athleteId: string, familyId: string): Promise<Result<PlayerBillingOverview>> {
  const me = await staff();
  if (!me) return fail("NOT_AUTHORIZED");
  if (!isUuid(athleteId) || !isUuid(familyId)) return ok({ invoices: [], payments: [], credits: [] });
  try {
    const db = await looseDb();
    const today = await clubTodayFor(db, me.orgId);
    const r = await db.from("invoices").select(INVOICE_COLS).eq("org_id", me.orgId).eq("family_id", familyId)
      .or(`athlete_id.eq.${athleteId},athlete_id.is.null`).order("issued_at", { ascending: false }).limit(300);
    if (r.error) return fail(r.error.message);
    const { invoices, payments } = await invoicesWithMoney(db, rows<InvoiceRaw>(r), today);
    const receiptIds = uniq(payments.map((p) => p.receipt_id));
    const receipts = receiptIds.length
      ? rows<{ id: string; payer_name: string | null; amount: number; received_on: string; reference: string | null }>(
        await db.from("payment_receipts").select("id,payer_name,amount,received_on,reference").in("id", receiptIds))
      : [];
    const rMap = new Map(receipts.map((x) => [x.id, x]));
    const invById = new Map(invoices.map((i) => [i.id, i]));
    const bal = await db.rpc("family_balance_by_activity", { p_family: familyId });
    const credits = rows<{ activity: string; currency: string; credit: number }>(bal)
      .filter((x) => num(x.credit) !== 0)
      .map((x) => ({ activity: (isBillingActivity(x.activity) ? x.activity : "unassigned") as CategoryCredit["activity"], currency: x.currency, credit: num(x.credit) }));
    return ok({
      invoices,
      credits,
      payments: payments
        .filter((p) => p.status === "succeeded" || p.status === "refunded" || p.status === "partially_refunded" || !!p.voided_at)
        .map((p) => {
          const inv = invById.get(p.invoice_id);
          const rc = p.receipt_id ? rMap.get(p.receipt_id) : undefined;
          return {
            id: p.id, invoiceId: p.invoice_id, invoiceNumber: inv?.number ?? "", category: inv?.category ?? "other", categoryLabel: inv?.categoryLabel ?? null,
            amount: num(p.amount_chf), currency: (p.currency ?? inv?.currency ?? "CHF").toUpperCase(), paidAt: p.paid_at ?? p.created_at,
            method: p.method, voided: !!p.voided_at, isReversal: !!p.reverses_payment_id,
            receipt: rc ? { id: rc.id, payerName: rc.payer_name, amount: num(rc.amount), receivedOn: rc.received_on, reference: rc.reference } : null,
          };
        })
        .sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? "")),
    });
  } catch (e) {
    logError("playerBilling.overview", e);
    return fail("LOAD_FAILED");
  }
}

export type PlayerBookingView = {
  id: string; start: string; status: string; serviceName: string; coachName: string; price: number | null; creditsUsed: number;
  invoice: { id: string; number: string; status: string; category: BillingActivity; paymentStatus: MoneyStatus; balance: number; currency: string } | null;
};

/** Training bookings of the player with their invoice (number, status, payment status). Staff only. */
export async function getPlayerBookings(athleteId: string): Promise<Result<PlayerBookingView[]>> {
  const me = await staff();
  if (!me) return fail("NOT_AUTHORIZED");
  if (!isUuid(athleteId)) return ok([]);
  try {
    const db = await looseDb();
    const r = await db.from("training_bookings").select("id,service_id,coach_id,slot_start,status,price_chf,credits_used,invoice_id")
      .eq("org_id", me.orgId).eq("athlete_id", athleteId).order("slot_start", { ascending: false }).limit(200);
    if (r.error) return fail(r.error.message);
    const list = rows<{ id: string; service_id: string; coach_id: string; slot_start: string; status: string; price_chf: number | null; credits_used: number; invoice_id: string | null }>(r);
    const invMap = await getInvoiceMoneyMap(list.map((b) => b.invoice_id));
    const [s, c] = await Promise.all([
      db.from("training_services").select("id,name").in("id", uniq(list.map((b) => b.service_id))),
      db.from("coaches").select("id,display_name").in("id", uniq(list.map((b) => b.coach_id))),
    ]);
    const sName = new Map(rows<{ id: string; name: string }>(s).map((x) => [x.id, x.name]));
    const cName = new Map(rows<{ id: string; display_name: string }>(c).map((x) => [x.id, x.display_name]));
    return ok(list.map((b) => ({
      id: b.id, start: b.slot_start, status: b.status, serviceName: sName.get(b.service_id) ?? "", coachName: cName.get(b.coach_id) ?? "",
      price: b.price_chf == null ? null : num(b.price_chf), creditsUsed: num(b.credits_used),
      invoice: b.invoice_id ? invMap.get(b.invoice_id) ?? null : null,
    })));
  } catch (e) {
    logError("playerBilling.bookings", e);
    return fail("LOAD_FAILED");
  }
}

export type InvoiceMoneyBrief = { id: string; number: string; status: string; category: BillingActivity; categoryLabel?: string | null; paymentStatus: MoneyStatus; balance: number; currency: string };

/** Number, status, category and payment status of a set of invoices (RLS applies; unknown ids are left out). */
export async function getInvoiceMoneyMap(ids: (string | null | undefined)[]): Promise<Map<string, InvoiceMoneyBrief>> {
  const list = uniq(ids).filter(isUuid);
  if (!list.length) return new Map();
  try {
    const db = await looseDb();
    const raw: InvoiceRaw[] = [];
    for (let i = 0; i < list.length; i += 200) raw.push(...rows<InvoiceRaw>(await db.from("invoices").select(INVOICE_COLS).in("id", list.slice(i, i + 200))));
    const { invoices } = await invoicesWithMoney(db, raw, new Date().toISOString().slice(0, 10));
    return new Map(invoices.map((i) => [i.id, {
      id: i.id, number: i.number, status: i.status, category: i.category, categoryLabel: i.categoryLabel, paymentStatus: i.paymentStatus,
      balance: i.balance, currency: i.currency,
    }]));
  } catch (e) {
    logError("playerBilling.invoiceMap", e);
    return new Map();
  }
}

/** Category (and selection series label) of invoices the caller can see — parent list, bookings. */
export async function getInvoiceCategories(ids: (string | null | undefined)[]): Promise<Map<string, { category: BillingActivity; label: string | null }>> {
  const list = uniq(ids).filter(isUuid);
  if (!list.length) return new Map();
  try {
    const db = await looseDb();
    const raw: InvoiceRaw[] = [];
    for (let i = 0; i < list.length; i += 200) {
      raw.push(...rows<InvoiceRaw>(await db.from("invoices").select("id,activity,program_id").in("id", list.slice(i, i + 200))));
    }
    const labels = await seriesLabels(db, raw);
    return new Map(raw.map((i) => {
      const category: BillingActivity = isBillingActivity(i.activity) ? i.activity : "other";
      return [i.id, { category, label: category === "selection" && i.program_id ? labels.get(i.program_id) ?? null : null }];
    }));
  } catch (e) {
    logError("playerBilling.categories", e);
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Record a payment: payer + open invoices
// ---------------------------------------------------------------------------
export type PayerContext = {
  familyId: string; familyName: string; contactName: string | null;
  athletes: { id: string; name: string }[];
  openInvoices: (BillingInvoice & { athleteName: string | null; installments: InstallmentView[] })[];
};

/** Open invoices of a family (the payer), with balances and instalments. Staff only. */
export async function getPayerContext(familyId: string): Promise<Result<PayerContext | null>> {
  const me = await staff();
  if (!me) return fail("NOT_AUTHORIZED");
  if (!isUuid(familyId)) return ok(null);
  try {
    const db = await looseDb();
    const fam = await db.from("families").select("id,name,contact_name").eq("org_id", me.orgId).eq("id", familyId).maybeSingle();
    if (fam.error) return fail(fam.error.message);
    const f = fam.data as { id: string; name: string; contact_name: string | null } | null;
    if (!f) return ok(null);
    const today = await clubTodayFor(db, me.orgId);
    const [inv, aths] = await Promise.all([
      db.from("invoices").select(INVOICE_COLS).eq("org_id", me.orgId).eq("family_id", familyId).in("status", OPEN)
        .order("due_date", { ascending: true }).limit(300),
      db.from("athletes").select("id,first_name,last_name").eq("org_id", me.orgId).eq("family_id", familyId).order("first_name"),
    ]);
    if (inv.error) return fail(inv.error.message);
    const athletes = rows<{ id: string; first_name: string; last_name: string }>(aths).map((a) => ({ id: a.id, name: `${a.first_name} ${a.last_name}`.trim() }));
    const aName = new Map(athletes.map((a) => [a.id, a.name]));
    const { invoices } = await invoicesWithMoney(db, rows<InvoiceRaw>(inv), today);
    const installments = await installmentsFor(db, invoices.map((i) => i.id), today);
    return ok({
      familyId: f.id, familyName: f.name, contactName: f.contact_name, athletes,
      openInvoices: invoices.filter((i) => i.balance > 0).map((i) => ({
        ...i, athleteName: i.athleteId ? aName.get(i.athleteId) ?? null : null,
        installments: installments.filter((x) => x.invoiceId === i.id),
      })),
    });
  } catch (e) {
    logError("playerBilling.payer", e);
    return fail("LOAD_FAILED");
  }
}

/** Family of a player / an invoice (record-payment deep links). Staff only, same org. */
export async function resolvePayerFamily(input: { athleteId?: string | null; invoiceId?: string | null }): Promise<string | null> {
  const me = await staff();
  if (!me) return null;
  const db = await looseDb();
  if (isUuid(input.invoiceId)) {
    const r = await db.from("invoices").select("family_id").eq("org_id", me.orgId).eq("id", input.invoiceId).maybeSingle();
    return (r.data as { family_id?: string } | null)?.family_id ?? null;
  }
  if (isUuid(input.athleteId)) {
    const r = await db.from("athletes").select("family_id").eq("org_id", me.orgId).eq("id", input.athleteId).maybeSingle();
    return (r.data as { family_id?: string } | null)?.family_id ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Receipts (payments page)
// ---------------------------------------------------------------------------
export type ReceiptView = {
  id: string; status: string; amount: number; allocated: number; unallocated: number; currency: string; receivedOn: string; method: string;
  reference: string | null; note: string | null; payerName: string | null; familyId: string | null; familyName: string | null; createdAt: string;
  allocations: { paymentId: string; invoiceId: string; invoiceNumber: string; category: BillingActivity; amount: number; voided: boolean; isReversal: boolean }[];
};

/** Latest receipts (one received amount each) with their allocations. Staff only. */
export async function listReceipts(opts: { onlyOpen?: boolean; limit?: number } = {}): Promise<Result<ReceiptView[]>> {
  const me = await staff();
  if (!me) return fail("NOT_AUTHORIZED");
  try {
    const db = await looseDb();
    let q = db.from("payment_receipts").select("id,status,amount,currency,received_on,method,reference,note,payer_name,family_id,created_at").eq("org_id", me.orgId);
    if (opts.onlyOpen) q = q.in("status", ["open", "partially_allocated"]);
    const r = await q.order("created_at", { ascending: false }).limit(Math.min(Math.max(opts.limit ?? 50, 1), 300));
    if (r.error) return fail(r.error.message);
    const list = rows<{ id: string; status: string; amount: number; currency: string; received_on: string; method: string; reference: string | null; note: string | null; payer_name: string | null; family_id: string | null; created_at: string }>(r);
    if (!list.length) return ok([]);
    const [pays, fams] = await Promise.all([
      db.from("payments").select("id,invoice_id,amount_chf,receipt_id,voided_at,reverses_payment_id,status").in("receipt_id", list.map((x) => x.id)).order("created_at"),
      db.from("families").select("id,name").in("id", uniq(list.map((x) => x.family_id))),
    ]);
    const pRows = rows<{ id: string; invoice_id: string; amount_chf: number; receipt_id: string; voided_at: string | null; reverses_payment_id: string | null; status: string }>(pays);
    const invs = pRows.length ? rows<{ id: string; number: string; activity: string }>(await db.from("invoices").select("id,number,activity").in("id", uniq(pRows.map((p) => p.invoice_id)))) : [];
    const iMap = new Map(invs.map((i) => [i.id, i]));
    const fName = new Map(rows<{ id: string; name: string }>(fams).map((f) => [f.id, f.name]));
    return ok(list.map((x) => {
      const cur = x.currency;
      const mine = pRows.filter((p) => p.receipt_id === x.id);
      const allocatedMinor = mine.reduce((s, p) => s + toMinorUnits(num(p.amount_chf), cur), 0);
      const allocated = fromMinorUnits(allocatedMinor, cur);
      return {
        id: x.id, status: x.status, amount: num(x.amount), allocated, unallocated: fromMinorUnits(Math.max(toMinorUnits(num(x.amount), cur) - allocatedMinor, 0), cur),
        currency: cur, receivedOn: x.received_on, method: x.method, reference: x.reference, note: x.note, payerName: x.payer_name,
        familyId: x.family_id, familyName: x.family_id ? fName.get(x.family_id) ?? null : null, createdAt: x.created_at,
        allocations: mine.filter((p) => !p.reverses_payment_id).map((p) => {
          const inv = iMap.get(p.invoice_id);
          return {
            paymentId: p.id, invoiceId: p.invoice_id, invoiceNumber: inv?.number ?? "", category: (isBillingActivity(inv?.activity) ? inv!.activity : "other") as BillingActivity,
            amount: num(p.amount_chf), voided: !!p.voided_at, isReversal: false,
          };
        }),
      };
    }));
  } catch (e) {
    logError("playerBilling.receipts", e);
    return fail("LOAD_FAILED");
  }
}

// ---------------------------------------------------------------------------
// Invoice billing line (enrolment money panel, booking detail)
// ---------------------------------------------------------------------------
export type InvoiceBillingLine = {
  id: string; number: string; status: string; category: BillingActivity; categoryLabel: string | null; payerKind: string | null;
  payerName: string | null; familyName: string | null; entityName: string | null; paymentStatus: MoneyStatus; balance: number; currency: string;
};

/** Who pays, who issues, number and category of one invoice (RLS applies). */
export async function getInvoiceBillingLine(invoiceId: string | null | undefined): Promise<InvoiceBillingLine | null> {
  if (!isUuid(invoiceId)) return null;
  try {
    const db = await looseDb();
    const r = await db.from("invoices").select(`${INVOICE_COLS},billing_entity_snapshot`).eq("id", invoiceId).maybeSingle();
    if (r.error || !r.data) return null;
    const raw = r.data as InvoiceRaw & { billing_entity_snapshot: { name?: string } | null };
    const [{ invoices }, fam] = await Promise.all([
      invoicesWithMoney(db, [raw], new Date().toISOString().slice(0, 10)),
      db.from("families").select("name,contact_name").eq("id", raw.family_id).maybeSingle(),
    ]);
    const i = invoices[0];
    const f = fam.data as { name: string; contact_name: string | null } | null;
    return {
      id: i.id, number: i.number, status: i.status, category: i.category, categoryLabel: i.categoryLabel, payerKind: raw.payer_kind,
      payerName: raw.payer_name ?? f?.contact_name ?? null, familyName: f?.name ?? null, entityName: raw.billing_entity_snapshot?.name ?? null,
      paymentStatus: i.paymentStatus, balance: i.balance, currency: i.currency,
    };
  } catch (e) {
    logError("playerBilling.line", e);
    return null;
  }
}

/** Status of the record an invoice was raised for (booking: cancelled / rescheduled history). */
export async function getBookingState(bookingId: string): Promise<{ status: string; cancelledAt: string | null; athleteId: string | null } | null> {
  if (!isUuid(bookingId)) return null;
  const db = await looseDb();
  const r = await db.from("training_bookings").select("status,cancelled_at,athlete_id").eq("id", bookingId).maybeSingle();
  const b = r.data as { status: string; cancelled_at: string | null; athlete_id: string | null } | null;
  return b ? { status: b.status, cancelledAt: b.cancelled_at, athleteId: b.athlete_id } : null;
}

/** Teams of a season (membership list filter). Staff only. */
export async function listSeasonTeams(seasonId: string | null | undefined): Promise<{ id: string; name: string }[]> {
  const me = await staff();
  if (!me || !isUuid(seasonId)) return [];
  const db = await looseDb();
  const r = await db.from("teams").select("id,name").eq("org_id", me.orgId).eq("season_id", seasonId).order("name");
  return rows<{ id: string; name: string }>(r);
}

/** The club's current season id (null when none is marked current). */
export async function getCurrentSeasonId(): Promise<string | null> {
  const me = await getSessionUser();
  if (!me?.orgId) return null;
  const db = await looseDb();
  const r = await db.from("seasons").select("id").eq("org_id", me.orgId).eq("is_current", true).maybeSingle();
  return (r.data as { id?: string } | null)?.id ?? null;
}
