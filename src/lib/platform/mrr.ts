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

/** Add-on grant row as needed for revenue (public.org_feature_grants). */
export type AddonRevenueRow = {
  org_id: string;
  feature_key: string;
  kind: string;
  status: string;
  amount: number | null;
  currency: string | null;
  starts_at: string | null;
  ends_at: string | null;
};

export type AddonMrrSummary = {
  /** Monthly recurring add-on revenue per currency (active + canceling until their end). */
  byCurrency: { currency: string; mrr: number; arr: number; addons: number }[];
  /** Active paid add-ons per feature (count, MRR per currency). */
  byFeature: { feature: string; count: number; mrr: Record<string, number> }[];
  /** Open purchase requests waiting for the platform team. */
  pending: number;
  /** Paid add-ons scheduled to end at period end. */
  canceling: number;
  /** Running free trials of a module. */
  trials: number;
};

/** Add-on MRR from org_feature_grants (pure). Complimentary grants are not revenue. */
export function summarizeAddonMrr(rows: AddonRevenueRow[], now: Date = new Date()): AddonMrrSummary {
  const t = now.getTime();
  const live = (r: AddonRevenueRow) =>
    (!r.starts_at || new Date(r.starts_at).getTime() <= t) && (!r.ends_at || new Date(r.ends_at).getTime() > t);
  const cur = new Map<string, { mrr: number; addons: number }>();
  const feat = new Map<string, { count: number; mrr: Record<string, number> }>();
  let pending = 0;
  let canceling = 0;
  let trials = 0;
  for (const r of rows) {
    if (r.kind === "trial" && r.status === "active" && live(r)) trials++;
    if (r.kind !== "addon") continue;
    if (r.status === "pending") {
      pending++;
      continue;
    }
    if (!["active", "canceling"].includes(r.status) || !live(r)) continue;
    if (r.status === "canceling") canceling++;
    const c = r.currency && ["CHF", "EUR", "USD"].includes(r.currency) ? r.currency : "CHF";
    const amount = Number(r.amount ?? 0);
    const e = cur.get(c) ?? { mrr: 0, addons: 0 };
    e.mrr += amount;
    e.addons++;
    cur.set(c, e);
    const f = feat.get(r.feature_key) ?? { count: 0, mrr: {} };
    f.count++;
    f.mrr[c] = Math.round(((f.mrr[c] ?? 0) + amount) * 100) / 100;
    feat.set(r.feature_key, f);
  }
  return {
    byCurrency: Array.from(cur.entries())
      .map(([currency, v]) => ({ currency, mrr: Math.round(v.mrr * 100) / 100, arr: Math.round(v.mrr * 12 * 100) / 100, addons: v.addons }))
      .sort((a, b) => b.mrr - a.mrr),
    byFeature: Array.from(feat.entries())
      .map(([feature, v]) => ({ feature, ...v }))
      .sort((a, b) => b.count - a.count),
    pending,
    canceling,
    trials,
  };
}
