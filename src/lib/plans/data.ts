import "server-only";
import { fromMinorUnits, toMinorUnits } from "@/lib/payments/currency";
import { instalmentStatus, planDisplayStatus, planOffer, todayIn, upcomingPeriods, type InstalmentStatus, type PlanOffer, type PlanSettings } from "@/lib/payments/plans";
import { plansAdminDb, plansDb, type ChargeRow, type InstalmentRow, type MandateRow, type PauseRow, type PlanRow, type TemplateRow } from "./db";
import { loadPlanSettings, orgTimeZone } from "./settings";
import { must } from "@/lib/data/must";

export type InstalmentView = {
  id: string; seq: number; dueDate: string; amount: number; amountPaid: number; outstanding: number; currency: string;
  status: InstalmentStatus; invoiceId: string | null; periodStart: string | null; periodEnd: string | null;
  autopayStatus: InstalmentRow["autopay_status"]; autopayNextOn: string | null; skippedReason: string | null;
};
export type PlanView = {
  id: string; kind: PlanRow["kind"]; status: ReturnType<typeof planDisplayStatus>; rawStatus: PlanRow["status"];
  familyId: string; familyName: string; athleteName: string | null; invoiceId: string | null; invoiceNumber: string | null;
  description: string | null; currency: string; total: number; paid: number; outstanding: number; count: number;
  feeAmount: number; source: string | null; autopay: boolean; templateId: string | null; amountPerPeriod: number | null;
  startDate: string; endDate: string | null; nextRunDate: string | null; pauseReason: string | null; cancelReason: string | null;
  createdAt: string; instalments: InstalmentView[]; nextDue: InstalmentView | null; failedCharges: number;
};

const num = (v: unknown) => Number(v ?? 0);

function toInstalment(r: InstalmentRow, today: string): InstalmentView {
  const outstanding = r.status === "paid" || r.status === "cancelled" || r.status === "skipped"
    ? 0 : fromMinorUnits(Math.max(toMinorUnits(num(r.amount), r.currency) - toMinorUnits(num(r.amount_paid), r.currency), 0), r.currency);
  return {
    id: r.id, seq: r.seq, dueDate: r.due_date, amount: num(r.amount), amountPaid: num(r.amount_paid), outstanding, currency: r.currency,
    status: instalmentStatus({ status: r.status, dueDate: r.due_date, outstanding }, today), invoiceId: r.invoice_id,
    periodStart: r.period_start, periodEnd: r.period_end, autopayStatus: r.autopay_status, autopayNextOn: r.autopay_next_on,
    skippedReason: r.skipped_reason,
  };
}

async function decorate(
  plans: PlanRow[], rows: InstalmentRow[], today: string,
  names: { families: Map<string, string>; athletes: Map<string, string>; invoices: Map<string, string> }, failed: Map<string, number> = new Map(),
): Promise<PlanView[]> {
  const byPlan = new Map<string, InstalmentRow[]>();
  for (const r of rows) byPlan.set(r.plan_id, [...(byPlan.get(r.plan_id) ?? []), r]);
  return plans.map((p) => {
    const inst = (byPlan.get(p.id) ?? []).sort((a, b) => a.seq - b.seq).map((r) => toInstalment(r, today));
    const live = inst.filter((i) => i.status !== "cancelled" && i.status !== "skipped");
    const cur = p.currency;
    const sum = (xs: number[]) => fromMinorUnits(xs.reduce((s, x) => s + toMinorUnits(x, cur), 0), cur);
    return {
      id: p.id, kind: p.kind, status: planDisplayStatus(p.status, inst.map((i) => i.status)), rawStatus: p.status,
      familyId: p.family_id, familyName: names.families.get(p.family_id) ?? "—",
      athleteName: p.athlete_id ? names.athletes.get(p.athlete_id) ?? null : null,
      invoiceId: p.invoice_id, invoiceNumber: p.invoice_id ? names.invoices.get(p.invoice_id) ?? null : null,
      description: p.description, currency: cur,
      total: p.kind === "installments" ? num(p.amount_total) : sum(live.map((i) => i.amount)),
      paid: sum(live.map((i) => i.amountPaid)), outstanding: sum(live.map((i) => i.outstanding)),
      count: p.kind === "installments" ? num(p.installment_count) : live.length,
      feeAmount: num(p.fee_amount), source: p.source, autopay: p.autopay, templateId: p.template_id,
      amountPerPeriod: p.amount_per_period == null ? null : num(p.amount_per_period),
      startDate: p.start_date, endDate: p.end_date, nextRunDate: p.next_run_date, pauseReason: p.pause_reason, cancelReason: p.cancel_reason,
      createdAt: p.created_at, instalments: inst,
      nextDue: inst.find((i) => i.status === "overdue" || i.status === "due" || i.status === "upcoming") ?? null,
      failedCharges: failed.get(p.id) ?? 0,
    };
  });
}

async function namesFor(db: Awaited<ReturnType<typeof plansDb>>, plans: PlanRow[]) {
  const fam = Array.from(new Set(plans.map((p) => p.family_id)));
  const ath = Array.from(new Set(plans.map((p) => p.athlete_id).filter((x): x is string => !!x)));
  const inv = Array.from(new Set(plans.map((p) => p.invoice_id).filter((x): x is string => !!x)));
  const [f, a, i] = await Promise.all([
    fam.length ? db.from("families").select("id,name").in("id", fam) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ath.length ? db.from("athletes").select("id,first_name,last_name").in("id", ath) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
    inv.length ? db.from("invoices").select("id,number").in("id", inv) : Promise.resolve({ data: [] as { id: string; number: string }[] }),
  ]);
  return {
    families: new Map((f.data ?? []).map((x) => [x.id, x.name])),
    athletes: new Map((a.data ?? []).map((x) => [x.id, `${x.first_name} ${x.last_name}`.trim()])),
    invoices: new Map((i.data ?? []).map((x) => [x.id, x.number])),
  };
}

/** Today in the club's calendar. */
export async function clubToday(orgId: string): Promise<string> {
  return todayIn(await orgTimeZone(orgId));
}

// ---------------------------------------------------------------------------
// Invoice page (parent + admin; RLS decides visibility)
// ---------------------------------------------------------------------------
export async function getInvoicePlan(invoiceId: string, orgId: string): Promise<PlanView | null> {
  const db = await plansDb();
  const { data: plans } = await db.from("payment_plans").select("*").eq("invoice_id", invoiceId).eq("kind", "installments")
    .in("status", ["active", "paused", "completed"]).order("created_at", { ascending: false }).limit(1);
  const p = (plans ?? [])[0] as PlanRow | undefined;
  if (!p) return null;
  const { data: rows } = await db.from("payment_plan_installments").select("*").eq("plan_id", p.id);
  const [view] = await decorate([p], (rows ?? []) as InstalmentRow[], await clubToday(orgId), await namesFor(db, [p]));
  return view ?? null;
}

/** Instalment choices for an open invoice (null when the caller can't see it). */
export async function getInvoicePlanOffer(invoiceId: string, orgId: string): Promise<{ offer: PlanOffer; settings: PlanSettings } | null> {
  const db = await plansDb();
  const { data } = await db.rpc("plan_invoice_context", { p_invoice: invoiceId });
  const c = data as { status: string; currency: string; product_type: string; activity_start: string | null; balance: number; has_plan: boolean } | null;
  if (!c) return null;
  const settings = await loadPlanSettings(orgId);
  if (["draft", "paid", "cancelled", "void", "written_off", "refunded"].includes(c.status)) {
    return { offer: { eligible: false, reason: "nothing_due", options: [] }, settings };
  }
  const offer = planOffer(settings, {
    productType: c.product_type, balance: num(c.balance), currency: c.currency, today: await clubToday(orgId),
    activityStart: c.activity_start, hasPlan: c.has_plan,
  });
  return { offer, settings };
}

/** Offer for a checkout amount before the invoice exists (camp / shop / package pages). */
export async function getCheckoutPlanOffer(orgId: string, productType: string, currency: string): Promise<{ settings: PlanSettings; today: string } | null> {
  const settings = await loadPlanSettings(orgId);
  if (!settings.enabled || !(settings.productTypes.includes(productType as never) || settings.productTypes.includes("invoice"))) return null;
  return { settings, today: await clubToday(orgId) };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export type PlanFilter = "all" | "active" | "overdue" | "paused" | "completed" | "cancelled" | "failed";

export async function listPlans(orgId: string, filter: PlanFilter = "all", kind: PlanRow["kind"] = "installments"): Promise<PlanView[]> {
  const db = await plansDb();
  let q = db.from("payment_plans").select("*").eq("org_id", orgId).eq("kind", kind).order("created_at", { ascending: false }).limit(500);
  if (filter === "paused" || filter === "completed" || filter === "cancelled") q = q.eq("status", filter);
  else if (filter !== "all") q = q.in("status", ["active", "paused"]);
  const list = must(await q, "payment plans") as PlanRow[];
  if (!list.length) return [];
  const ids = list.map((p) => p.id);
  const [{ data: rows }, { data: charges }] = await Promise.all([
    db.from("payment_plan_installments").select("*").in("plan_id", ids),
    db.from("autopay_charges").select("installment_id,status").eq("org_id", orgId).eq("status", "failed"),
  ]);
  const planOf = new Map(((rows ?? []) as InstalmentRow[]).map((r) => [r.id, r.plan_id]));
  const failed = new Map<string, number>();
  for (const c of (charges ?? []) as Pick<ChargeRow, "installment_id">[]) {
    const pid = planOf.get(c.installment_id);
    if (pid) failed.set(pid, (failed.get(pid) ?? 0) + 1);
  }
  const views = await decorate(list, (rows ?? []) as InstalmentRow[], await clubToday(orgId), await namesFor(db, list), failed);
  if (filter === "overdue") return views.filter((v) => v.status === "overdue");
  if (filter === "active") return views.filter((v) => v.rawStatus === "active");
  if (filter === "failed") return views.filter((v) => v.instalments.some((i) => i.autopayStatus === "failed" || i.autopayStatus === "fallback" || i.autopayStatus === "requires_action"));
  return views;
}

export async function getPlan(orgId: string, planId: string): Promise<{ plan: PlanView; pauses: PauseRow[]; charges: ChargeRow[] } | null> {
  const db = await plansDb();
  const { data: p } = await db.from("payment_plans").select("*").eq("org_id", orgId).eq("id", planId).maybeSingle();
  if (!p) return null;
  const plan = p as PlanRow;
  const [{ data: rows }, { data: pauses }] = await Promise.all([
    db.from("payment_plan_installments").select("*").eq("plan_id", plan.id),
    db.from("recurring_plan_pauses").select("*").eq("plan_id", plan.id).order("starts_on"),
  ]);
  const instIds = ((rows ?? []) as InstalmentRow[]).map((r) => r.id);
  const { data: ch } = instIds.length
    ? await db.from("autopay_charges").select("*").in("installment_id", instIds).order("created_at", { ascending: false })
    : { data: [] as ChargeRow[] };
  const [view] = await decorate([plan], (rows ?? []) as InstalmentRow[], await clubToday(orgId), await namesFor(db, [plan]));
  return { plan: view, pauses: (pauses ?? []) as PauseRow[], charges: (ch ?? []) as ChargeRow[] };
}

export type TemplateView = TemplateRow & { enrolled: number; teamName: string | null; programName: string | null };

export async function listTemplates(orgId: string): Promise<TemplateView[]> {
  const db = await plansDb();
  const [tplRes, { data: plans }, { data: teams }, { data: programs }] = await Promise.all([
    db.from("recurring_fee_templates").select("*").eq("org_id", orgId).order("created_at"),
    db.from("payment_plans").select("template_id").eq("org_id", orgId).eq("kind", "recurring").in("status", ["active", "paused"]).not("template_id", "is", null),
    db.from("teams").select("id,name").eq("org_id", orgId),
    db.from("programs").select("id,name").eq("org_id", orgId),
  ]);
  const tpls = must(tplRes, "recurring fee templates");
  const count = new Map<string, number>();
  for (const p of (plans ?? []) as { template_id: string | null }[]) if (p.template_id) count.set(p.template_id, (count.get(p.template_id) ?? 0) + 1);
  const tn = new Map(((teams ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  const pn = new Map(((programs ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  return ((tpls ?? []) as TemplateRow[]).map((t) => ({
    ...t, amount: num(t.amount), enrolled: count.get(t.id) ?? 0,
    teamName: t.team_id ? tn.get(t.team_id) ?? null : null, programName: t.program_id ? pn.get(t.program_id) ?? null : null,
  }));
}

export async function listEnrolments(orgId: string): Promise<PlanView[]> {
  return listPlans(orgId, "all", "recurring");
}

export type EnrolOptions = { teams: { id: string; name: string }[]; programs: { id: string; name: string }[]; athletes: { id: string; name: string }[] };

/** Picker options; archived programmes are hidden except those listed in keepProgramIds (already used). */
export async function enrolOptions(orgId: string, keepProgramIds: string[] = []): Promise<EnrolOptions> {
  const db = await plansDb();
  const [{ data: teams }, { data: programRows }, { data: athletes }] = await Promise.all([
    db.from("teams").select("id,name").eq("org_id", orgId).eq("is_active", true).order("name"),
    db.from("programs").select("id,name,status").eq("org_id", orgId).order("name"),
    db.from("athletes").select("id,first_name,last_name").eq("org_id", orgId).eq("status", "active").order("last_name").limit(2000),
  ]);
  return {
    teams: (teams ?? []) as { id: string; name: string }[],
    programs: ((programRows ?? []) as { id: string; name: string; status?: string }[])
      .filter((p) => p.status !== "archived" || keepProgramIds.includes(p.id))
      .map((p) => ({ id: p.id, name: p.name })),
    athletes: ((athletes ?? []) as { id: string; first_name: string; last_name: string }[]).map((a) => ({ id: a.id, name: `${a.first_name} ${a.last_name}`.trim() })),
  };
}

export type PreviewRow = { planId: string; familyName: string; athleteName: string | null; periodStart: string; periodEnd: string; amount: number; discount: number; net: number; action: string; currency: string };

/** What the next run would invoice up to `asOf` (dry run, nothing written). */
export async function previewRun(orgId: string, asOf: string): Promise<PreviewRow[]> {
  const db = await plansDb();
  const { data } = await db.rpc("recurring_generate", { p_org: orgId, p_as_of: asOf, p_dry_run: true });
  const rows = (data ?? []) as { plan_id: string; family_id: string; athlete_id: string | null; period_start: string; period_end: string; amount: number; discount: number; net: number; action: string }[];
  if (!rows.length) return [];
  const { data: plans } = await db.from("payment_plans").select("*").in("id", Array.from(new Set(rows.map((r) => r.plan_id))));
  const names = await namesFor(db, (plans ?? []) as PlanRow[]);
  const cur = new Map(((plans ?? []) as PlanRow[]).map((p) => [p.id, p.currency]));
  return rows.map((r) => ({
    planId: r.plan_id, familyName: names.families.get(r.family_id) ?? "—", athleteName: r.athlete_id ? names.athletes.get(r.athlete_id) ?? null : null,
    periodStart: r.period_start, periodEnd: r.period_end, amount: num(r.amount), discount: num(r.discount), net: num(r.net), action: r.action,
    currency: cur.get(r.plan_id) ?? "CHF",
  }));
}

export type FailedChargeView = ChargeRow & { familyName: string; invoiceNumber: string | null; instalmentStatus: string | null; autopayStatus: string | null };

export async function listFailedCharges(orgId: string): Promise<FailedChargeView[]> {
  const db = await plansDb();
  const { data } = await db.from("autopay_charges").select("*").eq("org_id", orgId).in("status", ["failed", "requires_action"])
    .order("created_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as ChargeRow[];
  if (!rows.length) return [];
  const [{ data: fams }, { data: invs }, { data: inst }] = await Promise.all([
    db.from("families").select("id,name").in("id", Array.from(new Set(rows.map((r) => r.family_id)))),
    db.from("invoices").select("id,number").in("id", Array.from(new Set(rows.map((r) => r.invoice_id)))),
    db.from("payment_plan_installments").select("id,status,autopay_status").in("id", Array.from(new Set(rows.map((r) => r.installment_id)))),
  ]);
  const fn = new Map(((fams ?? []) as { id: string; name: string }[]).map((f) => [f.id, f.name]));
  const inum = new Map(((invs ?? []) as { id: string; number: string }[]).map((f) => [f.id, f.number]));
  const ist = new Map(((inst ?? []) as { id: string; status: string; autopay_status: string | null }[]).map((f) => [f.id, f]));
  // newest attempt per instalment only
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.installment_id) ? false : (seen.add(r.installment_id), true))).map((r) => ({
    ...r, amount: num(r.amount), familyName: fn.get(r.family_id) ?? "—", invoiceNumber: inum.get(r.invoice_id) ?? null,
    instalmentStatus: ist.get(r.installment_id)?.status ?? null, autopayStatus: ist.get(r.installment_id)?.autopay_status ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Parent: own families only (RLS)
// ---------------------------------------------------------------------------
export type FamilyPlans = {
  instalmentPlans: PlanView[];
  recurring: PlanView[];
  mandates: Pick<MandateRow, "id" | "family_id" | "status" | "enabled" | "card_brand" | "card_last4" | "card_exp_month" | "card_exp_year" | "consented_at" | "consent_version">[];
  charges: ChargeRow[];
  pauses: PauseRow[];
  families: { id: string; name: string }[];
};

export async function getFamilyPlans(orgId: string, familyIds: string[]): Promise<FamilyPlans> {
  const empty: FamilyPlans = { instalmentPlans: [], recurring: [], mandates: [], charges: [], pauses: [], families: [] };
  if (!familyIds.length) return empty;
  const db = await plansDb();
  const [{ data: plans }, { data: mandates }, { data: charges }, { data: fams }] = await Promise.all([
    db.from("payment_plans").select("*").eq("org_id", orgId).in("family_id", familyIds).order("created_at", { ascending: false }).limit(200),
    db.from("autopay_mandates").select("id,family_id,status,enabled,card_brand,card_last4,card_exp_month,card_exp_year,consented_at,consent_version")
      .eq("org_id", orgId).in("family_id", familyIds).in("status", ["active"]),
    db.from("autopay_charges").select("*").eq("org_id", orgId).in("family_id", familyIds).order("created_at", { ascending: false }).limit(50),
    db.from("families").select("id,name").in("id", familyIds),
  ]);
  const list = (plans ?? []) as PlanRow[];
  const ids = list.map((p) => p.id);
  const [{ data: rows }, { data: pauses }] = ids.length
    ? await Promise.all([
        db.from("payment_plan_installments").select("*").in("plan_id", ids),
        db.from("recurring_plan_pauses").select("*").in("plan_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  const views = await decorate(list, (rows ?? []) as InstalmentRow[], await clubToday(orgId), await namesFor(db, list));
  return {
    instalmentPlans: views.filter((v) => v.kind === "installments" && v.rawStatus !== "cancelled"),
    recurring: views.filter((v) => v.kind === "recurring"),
    mandates: (mandates ?? []) as FamilyPlans["mandates"],
    charges: (charges ?? []) as ChargeRow[],
    pauses: (pauses ?? []) as PauseRow[],
    families: (fams ?? []) as { id: string; name: string }[],
  };
}

// ---------------------------------------------------------------------------
// Forecast feed for the finance projection (service role, org filtered)
// ---------------------------------------------------------------------------
export type PlanForecast = {
  /** Unpaid instalments of active plans, by due date (replaces the invoice's single due date). */
  instalments: { invoiceId: string; dueDate: string; amount: number; currency: string }[];
  /** Recurring periods not invoiced yet, by period start. */
  recurring: { date: string; amount: number; currency: string }[];
};

export async function loadPlanForecast(orgId: string, today: string, until: string): Promise<PlanForecast> {
  const db = plansAdminDb();
  const { data: plans } = await db.from("payment_plans").select("*").eq("org_id", orgId).in("status", ["active", "paused"]).limit(20000);
  const list = (plans ?? []) as PlanRow[];
  const inst = list.filter((p) => p.kind === "installments");
  const rec = list.filter((p) => p.kind === "recurring" && p.status === "active");
  const out: PlanForecast = { instalments: [], recurring: [] };
  if (inst.length) {
    const { data: rows } = await db.from("payment_plan_installments").select("plan_id,invoice_id,due_date,amount,amount_paid,currency,status")
      .in("plan_id", inst.map((p) => p.id)).in("status", ["scheduled"]);
    for (const r of (rows ?? []) as InstalmentRow[]) {
      const left = fromMinorUnits(Math.max(toMinorUnits(num(r.amount), r.currency) - toMinorUnits(num(r.amount_paid), r.currency), 0), r.currency);
      if (left > 0 && r.invoice_id) out.instalments.push({ invoiceId: r.invoice_id, dueDate: r.due_date, amount: left, currency: r.currency });
    }
  }
  if (rec.length) {
    const tplIds = Array.from(new Set(rec.map((p) => p.template_id).filter((x): x is string => !!x)));
    const { data: tpls } = tplIds.length ? await db.from("recurring_fee_templates").select("*").in("id", tplIds) : { data: [] };
    const tm = new Map(((tpls ?? []) as TemplateRow[]).map((t) => [t.id, t]));
    for (const p of rec) {
      const t = p.template_id ? tm.get(p.template_id) : null;
      const periods = upcomingPeriods({
        nextRunDate: p.next_run_date, endDate: p.end_date, amount: num(p.amount_per_period), currency: p.currency, startDate: p.start_date,
        template: t ? { startDate: t.start_date, billingDay: t.billing_day, frequency: t.frequency, proration: t.proration } : null,
        frequency: (["monthly", "quarterly", "yearly"].includes(p.frequency) ? p.frequency : "monthly") as "monthly",
      }, today, until);
      for (const x of periods) out.recurring.push({ date: x.periodStart, amount: x.amount, currency: p.currency });
    }
  }
  return out;
}
