import "server-only";
import { getOrgPaymentProfile, type OrgPaymentProfile } from "@/lib/payments/settings";
import { todayIn } from "@/lib/payments/plans";
import { logError } from "@/lib/log";
import { plansAdminDb, type GenerateRow } from "./db";
import { chargeOffSession } from "./autopay";
import { notifyFamily, type PlanNoticeKind } from "./notify";
import { orgTimeZone } from "./settings";

/**
 * Daily billing job (GET /api/billing/cron, service role). Per club:
 *   1. recurring_generate: one invoice per due period (idempotent per period),
 *      pauses / skips / proration / discounts applied in SQL; families without
 *      autopay get the invoice by email (QR-bill PDF on the invoice page).
 *   2. reminders N days before an instalment / period is due (no autopay).
 *   3. autopay: an off-session card charge for each due instalment / period
 *      (claimed in SQL first, idempotency key per instalment + attempt):
 *      succeeded -> receipt; requires_action -> email a pay link;
 *      declined -> retry +3 d / +7 d (club setting), then fallback to QR-bill.
 *   4. overdue reminders (repeated every N days) and card-expiry notices.
 * Safe to run several times a day: every step is claimed / marked in SQL.
 */
export type CronSummary = { orgs: number; invoices: number; reminders: number; charges: number; failed: number; overdue: number; expiring: number; errors: number };

type WorkRow = {
  installment_id: string; plan_id: string; invoice_id: string; family_id: string; seq: number; kind: string;
  installment_count: number | null; due_date: string; currency: string; outstanding: number; invoice_number: string;
};
type Work = {
  remind_before: WorkRow[]; overdue: WorkRow[]; charges: WorkRow[];
  expiring: { mandate_id: string; family_id: string; exp_month: number; exp_year: number }[];
};
type Begin = {
  charge_id: string; attempt: number; idempotency_key: string; amount: number; currency: string; family_id: string;
  installment_id: string; invoice_id: string; invoice_number: string; seq: number; plan_kind: string; installment_count: number | null;
  customer_id: string; payment_method_id: string;
};

const seqVars = (r: { kind?: string; plan_kind?: string; seq: number; installment_count: number | null }) =>
  (r.kind ?? r.plan_kind) === "installments" ? { seq: r.seq, count: r.installment_count } : { seq: null, count: null };

async function orgIds(only?: string): Promise<string[]> {
  if (only) return [only];
  const db = plansAdminDb();
  const [{ data: plans }, { data: settings }] = await Promise.all([
    db.from("payment_plans").select("org_id").in("status", ["active"]).limit(20000),
    db.from("payment_plan_settings").select("org_id").eq("autopay_enabled", true),
  ]);
  return Array.from(new Set([...(plans ?? []), ...(settings ?? [])].map((r) => r.org_id)));
}

async function familiesWithAutopay(orgId: string): Promise<Set<string>> {
  const { data } = await plansAdminDb().from("autopay_mandates").select("family_id").eq("org_id", orgId).eq("status", "active").eq("enabled", true);
  return new Set((data ?? []).map((m) => m.family_id));
}

type ChargeOutcome = "succeeded" | "processing" | "requires_action" | "failed" | "fallback" | "skipped";

async function chargeOne(profile: OrgPaymentProfile, row: Pick<WorkRow, "installment_id" | "due_date">, today: string, sum: CronSummary): Promise<ChargeOutcome> {
  const db = plansAdminDb();
  const { data: begun, error } = await db.rpc("autopay_begin_charge", { p_installment: row.installment_id, p_today: today });
  if (error) { sum.errors += 1; logError("billing.cron.begin", error); return "skipped"; }
  const b = begun as Begin | null;
  if (!b) return "skipped";
  let outcome: "succeeded" | "processing" | "requires_action" | "failed";
  let pi: string | null = null; let code: string | null = null; let decline: string | null = null;
  try {
    const r = await chargeOffSession({
      profile, chargeId: b.charge_id, idempotencyKey: b.idempotency_key, amount: Number(b.amount), currency: b.currency,
      customerId: b.customer_id, paymentMethodId: b.payment_method_id, invoiceId: b.invoice_id, installmentId: b.installment_id,
      description: `${profile.name} · ${b.invoice_number}`,
    });
    ({ outcome } = r); pi = r.paymentIntentId; code = r.code; decline = r.declineCode;
  } catch (e) {
    logError("billing.cron.charge", e);
    outcome = "failed"; code = "api_error";
  }
  sum.charges += 1;
  if (outcome === "processing") return "processing"; // the webhook finishes it
  const { data: res, error: rErr } = await db.rpc("autopay_charge_result", {
    p_charge: b.charge_id, p_payment_intent: pi, p_status: outcome, p_code: code, p_decline: decline,
    p_account: profile.stripeAccountId, p_today: today,
  });
  if (rErr) { sum.errors += 1; logError("billing.cron.result", rErr); return "skipped"; }
  const r = (res ?? {}) as { transitioned?: boolean; fallback?: boolean; next_retry_on?: string | null };
  if (!r.transitioned) return outcome;
  if (outcome === "failed") sum.failed += 1;
  const kind: PlanNoticeKind = outcome === "succeeded" ? "autopayCharged" : outcome === "requires_action" ? "authRequired" : r.fallback ? "fallback" : "chargeFailed";
  await notifyFamily(profile.orgId, b.family_id, kind, {
    invoiceId: b.invoice_id, invoiceNumber: b.invoice_number, installmentId: b.installment_id, amount: Number(b.amount),
    currency: b.currency, dueDate: row.due_date, retryDate: r.next_retry_on ?? null, ...seqVars(b),
  });
  return outcome === "failed" && r.fallback ? "fallback" : outcome;
}

/** Finance "retry now" for one instalment (after autopay_retry_now reset it). */
export async function chargeInstalmentNow(orgId: string, installmentId: string): Promise<ChargeOutcome> {
  const profile = await getOrgPaymentProfile(orgId);
  if (!profile.stripeReady) return "skipped";
  const { data } = await plansAdminDb().from("payment_plan_installments").select("id,org_id,due_date").eq("id", installmentId).eq("org_id", orgId).maybeSingle();
  if (!data) return "skipped";
  const sum: CronSummary = { orgs: 0, invoices: 0, reminders: 0, charges: 0, failed: 0, overdue: 0, expiring: 0, errors: 0 };
  return chargeOne(profile, { installment_id: data.id, due_date: data.due_date }, todayIn(await orgTimeZone(orgId)), sum);
}

export async function runOrgBilling(orgId: string, opts: { today?: string; generateUntil?: string } = {}): Promise<CronSummary> {
  const sum: CronSummary = { orgs: 1, invoices: 0, reminders: 0, charges: 0, failed: 0, overdue: 0, expiring: 0, errors: 0 };
  const db = plansAdminDb();
  const today = opts.today ?? todayIn(await orgTimeZone(orgId));
  const until = opts.generateUntil && opts.generateUntil > today ? opts.generateUntil : today;

  // 1. Recurring period invoices (up to `until`; charges below only for what is due today)
  const { data: gen, error: gErr } = await db.rpc("recurring_generate", { p_org: orgId, p_as_of: until, p_dry_run: false });
  if (gErr) { sum.errors += 1; logError("billing.cron.generate", gErr, { orgId }); }
  const issued = ((gen ?? []) as GenerateRow[]).filter((g) => g.action === "invoice" && g.invoice_id);
  sum.invoices = issued.length;
  if (issued.length) {
    const auto = await familiesWithAutopay(orgId);
    const ids = issued.map((g) => g.invoice_id!) ;
    const { data: invs } = await db.from("invoices").select("id,number,currency,due_date").in("id", ids);
    const byId = new Map((invs ?? []).map((i) => [i.id, i]));
    for (const g of issued) {
      if (auto.has(g.family_id)) continue; // charged on the due date instead
      const inv = byId.get(g.invoice_id!);
      await notifyFamily(orgId, g.family_id, "periodInvoice", {
        invoiceId: g.invoice_id, invoiceNumber: inv?.number, amount: Number(g.net), currency: inv?.currency ?? undefined, dueDate: inv?.due_date ?? null,
      });
    }
  }

  // 2-4. Work list
  const { data: workRaw, error: wErr } = await db.rpc("plans_cron_work", { p_org: orgId, p_today: today });
  if (wErr) { sum.errors += 1; logError("billing.cron.work", wErr, { orgId }); return sum; }
  const work = (workRaw ?? {}) as Partial<Work>;

  for (const r of work.remind_before ?? []) {
    const { data: fresh } = await db.rpc("plan_mark_reminded", { p_installment: r.installment_id, p_kind: "before" });
    if (!fresh) continue;
    await notifyFamily(orgId, r.family_id, "reminderBefore", {
      invoiceId: r.invoice_id, invoiceNumber: r.invoice_number, installmentId: r.kind === "installments" ? r.installment_id : null,
      amount: Number(r.outstanding), currency: r.currency, dueDate: r.due_date, ...seqVars(r),
    });
    sum.reminders += 1;
  }

  if ((work.charges ?? []).length) {
    const profile = await getOrgPaymentProfile(orgId);
    if (profile.stripeReady) {
      for (const r of work.charges ?? []) await chargeOne(profile, r, today, sum);
    }
  }

  for (const r of work.overdue ?? []) {
    await db.rpc("plan_mark_reminded", { p_installment: r.installment_id, p_kind: "overdue" });
    await notifyFamily(orgId, r.family_id, "overdue", {
      invoiceId: r.invoice_id, invoiceNumber: r.invoice_number, installmentId: r.kind === "installments" ? r.installment_id : null,
      amount: Number(r.outstanding), currency: r.currency, dueDate: r.due_date, ...seqVars(r),
    });
    sum.overdue += 1;
  }

  for (const m of work.expiring ?? []) {
    const { data: fresh } = await db.rpc("autopay_mark_expiry_notified", { p_mandate: m.mandate_id });
    if (!fresh) continue;
    await notifyFamily(orgId, m.family_id, "cardExpiring", { card: `${String(m.exp_month).padStart(2, "0")}/${m.exp_year}` });
    sum.expiring += 1;
  }
  return sum;
}

/** Every club with plans / autopay (or one club for "run now"). */
export async function runBillingCron(opts: { orgId?: string; today?: string } = {}): Promise<CronSummary> {
  const total: CronSummary = { orgs: 0, invoices: 0, reminders: 0, charges: 0, failed: 0, overdue: 0, expiring: 0, errors: 0 };
  for (const orgId of await orgIds(opts.orgId)) {
    try {
      const s = await runOrgBilling(orgId, { today: opts.today });
      for (const k of Object.keys(total) as (keyof CronSummary)[]) total[k] += s[k];
    } catch (e) {
      total.errors += 1;
      logError("billing.cron.org", e, { orgId });
    }
  }
  return total;
}
