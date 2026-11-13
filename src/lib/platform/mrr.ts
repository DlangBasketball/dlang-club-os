import type { TenantOverviewRow } from "./types";

/** MRR / tenant KPIs computed from platform_tenant_overview() rows (pure). */
export type MrrSummary = {
  byCurrency: { currency: string; mrr: number; arr: number; paying: number }[];
  tenants: number;
  paying: number;
  trialing: number;
  trialsEndingSoon: number;
  pastDue: number;
  canceled: number;
  suspended: number;
  byPlan: { plan: string; count: number }[];
};

export function summarizeMrr(rows: TenantOverviewRow[], now: Date = new Date()): MrrSummary {
  const cur = new Map<string, { mrr: number; paying: number }>();
  const plans = new Map<string, number>();
  let paying = 0,
    trialing = 0,
    trialsEndingSoon = 0,
    pastDue = 0,
    canceled = 0,
    suspended = 0;
  const soon = now.getTime() + 7 * 86_400_000;

  for (const r of rows) {
    if (r.suspended_at) suspended++;
    const plan = r.plan_name ?? r.plan_code ?? "—";
    plans.set(plan, (plans.get(plan) ?? 0) + 1);
    const mrr = Number(r.mrr ?? 0);
    if (mrr > 0) {
      paying++;
      const c = r.currency && ["CHF", "EUR", "USD"].includes(r.currency) ? r.currency : "CHF";
      const e = cur.get(c) ?? { mrr: 0, paying: 0 };
      e.mrr += mrr;
      e.paying++;
      cur.set(c, e);
    }
    if (r.status === "trialing" && !r.suspended_at) {
      trialing++;
      if (r.trial_ends_at) {
        const t = new Date(r.trial_ends_at).getTime();
        if (t > now.getTime() && t <= soon) trialsEndingSoon++;
      }
    }
    if (r.status === "past_due" || r.status === "unpaid") pastDue++;
    if (r.status === "canceled") canceled++;
  }

  return {
    byCurrency: Array.from(cur.entries())
      .map(([currency, v]) => ({
        currency,
        mrr: Math.round(v.mrr * 100) / 100,
        arr: Math.round(v.mrr * 12 * 100) / 100,
        paying: v.paying,
      }))
      .sort((a, b) => b.mrr - a.mrr),
    tenants: rows.length,
    paying,
    trialing,
    trialsEndingSoon,
    pastDue,
    canceled,
    suspended,
    byPlan: Array.from(plans.entries())
      .map(([plan, count]) => ({ plan, count }))
      .sort((a, b) => b.count - a.count),
  };
}
