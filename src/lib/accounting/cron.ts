import "server-only";
import { logError } from "@/lib/log";
import { todayIn } from "@/lib/payments/plans";
import { orgTimeZone } from "@/lib/plans/settings";
import { accountingAdminDb, type AccountingClient } from "./db";
import { sendDunningNotice, type DunningNotice } from "./notify";

/**
 * Daily accounting work, run from the billing cron (GET /api/billing/cron,
 * service role) and from the finance "run now" button:
 *   1. family support: credit notes for open invoices of supported families
 *      (once per invoice and discount, within the cap);
 *   2. dunning: next reminder level per overdue invoice (idempotent per
 *      invoice + level in SQL), fees as debit notes, instalments that autopay
 *      still handles are skipped; then the unsent notices are e-mailed and
 *      marked (a failed e-mail is retried on the next run, at most 3 times).
 */
export type AccountingCronSummary = { orgs: number; supportInvoices: number; notices: number; sent: number; collection: number; errors: number };

const empty = (): AccountingCronSummary => ({ orgs: 0, supportInvoices: 0, notices: 0, sent: 0, collection: 0, errors: 0 });

async function orgsWithWork(db: AccountingClient): Promise<string[]> {
  const [{ data: d }, { data: s }] = await Promise.all([
    db.from("dunning_settings").select("org_id").eq("enabled", true),
    db.from("discounts").select("org_id").eq("rule", "family_support").eq("is_active", true).limit(20000),
  ]);
  return Array.from(new Set([...(d ?? []), ...(s ?? [])].map((r) => r.org_id)));
}

/**
 * One club. `db` is the service-role client for the cron, or the finance
 * user's session client for "run now" (the RPCs check role and org).
 */
export async function runOrgAccounting(orgId: string, db: AccountingClient, opts: { today?: string } = {}): Promise<AccountingCronSummary> {
  const sum = { ...empty(), orgs: 1 };
  const today = opts.today ?? todayIn(await orgTimeZone(orgId));

  const { data: sup, error: sErr } = await db.rpc("family_support_sweep", { p_org: orgId });
  if (sErr) { sum.errors += 1; logError("accounting.cron.support", sErr, { orgId }); }
  else sum.supportInvoices = Number((sup as { invoices?: number } | null)?.invoices ?? 0);

  const { data: run, error: dErr } = await db.rpc("dunning_run", { p_org: orgId, p_today: today, p_dry_run: false });
  if (dErr) { sum.errors += 1; logError("accounting.cron.dunning", dErr, { orgId }); return sum; }
  const r = (run ?? {}) as { created?: number; collection?: number; notices?: DunningNotice[] };
  sum.notices = Number(r.created ?? 0);
  sum.collection = Number(r.collection ?? 0);
  for (const n of r.notices ?? []) {
    const ok = await sendDunningNotice(orgId, n);
    const { error } = await db.rpc("dunning_mark_sent", { p_notice: n.notice_id, p_org: orgId, p_ok: ok });
    if (error) { sum.errors += 1; logError("accounting.cron.mark", error, { orgId }); }
    if (ok) sum.sent += 1;
  }
  return sum;
}

/** Every club with dunning enabled or family support configured. */
export async function runAccountingCron(opts: { today?: string } = {}): Promise<AccountingCronSummary> {
  const total = empty();
  const db = accountingAdminDb();
  for (const orgId of await orgsWithWork(db)) {
    try {
      const s = await runOrgAccounting(orgId, db, opts);
      for (const k of Object.keys(total) as (keyof AccountingCronSummary)[]) total[k] += s[k];
    } catch (e) {
      total.errors += 1;
      logError("accounting.cron.org", e, { orgId });
    }
  }
  return total;
}
