import "server-only";
import { logError } from "@/lib/log";
import type { PlanPriceRow, PlanRow, SubscriptionRow } from "@/lib/platform/types";
import { changeStripePlan, removeStripeAddon, stripeBillable } from "./billing";
import { upgradesAdminDb, type FeatureGrantRow, type PendingPlanColumns } from "./db";

/**
 * Daily housekeeping for add-ons and plan changes (service role; every write
 * filtered by org_id). Resolution never depends on it — an ended grant is
 * already off at its end time — it only keeps billing and statuses tidy:
 *   * add-ons switched off "at period end": remove the Stripe item, mark canceled
 *   * trials / time-limited grants past their end: mark expired
 *   * downgrades scheduled for period end: switch the Stripe price, set the plan
 * Data of a module that turns off is never deleted.
 */
export async function processDueUpgradeChanges(now = new Date()): Promise<{ removed: number; expired: number; plans: number; errors: number }> {
  const db = upgradesAdminDb();
  const iso = now.toISOString();
  const out = { removed: 0, expired: 0, plans: 0, errors: 0 };

  const { data: due } = await db.from("org_feature_grants").select("*").in("status", ["active", "canceling"]).lte("ends_at", iso).limit(2000);
  for (const g of (due ?? []) as FeatureGrantRow[]) {
    if (!g.ends_at || g.ends_at > iso) continue;
    try {
      if (g.kind === "addon" && g.stripe_subscription_item_id) await removeStripeAddon(g.stripe_subscription_item_id);
      const status = g.kind === "addon" ? "canceled" : "expired";
      const { error } = await db.from("org_feature_grants").update({ status }).eq("id", g.id).eq("org_id", g.org_id);
      if (error) throw new Error(error.message);
      if (g.kind === "addon") out.removed++;
      else out.expired++;
    } catch (e) {
      out.errors++;
      logError("upgrades.jobs.grant", e, { org: g.org_id, feature: g.feature_key });
    }
  }

  const { data: subs } = await db.from("subscriptions").select("*").not("pending_plan_code", "is", null).lte("pending_plan_effective_at", iso).limit(500);
  for (const sub of (subs ?? []) as (SubscriptionRow & PendingPlanColumns)[]) {
    if (!sub.pending_plan_code || !sub.pending_plan_effective_at || sub.pending_plan_effective_at > iso) continue;
    try {
      if (stripeBillable(sub)) {
        const [{ data: plan }, { data: price }] = await Promise.all([
          db.from("plans").select("*").eq("code", sub.pending_plan_code).maybeSingle(),
          db.from("plan_prices").select("*").eq("plan_code", sub.pending_plan_code).eq("currency", sub.currency).eq("billing_interval", sub.billing_interval).maybeSingle(),
        ]);
        const p = plan as PlanRow | null;
        const pr = price as PlanPriceRow | null;
        if (!p || !pr) throw new Error("NO_PRICE_FOR_PENDING_PLAN");
        await changeStripePlan({ sub, planCode: p.code, planName: p.name, amount: Number(pr.amount), stripePriceId: pr.stripe_price_id, prorate: false });
      }
      const { error } = await db
        .from("subscriptions")
        .update({ plan_code: sub.pending_plan_code, pending_plan_code: null, pending_plan_effective_at: null, pending_plan_requested_at: null, pending_plan_requested_by: null })
        .eq("org_id", sub.org_id);
      if (error) throw new Error(error.message);
      await db.from("platform_audit_log").insert({ action: "plan.downgraded", org_id: sub.org_id, details: { from: sub.plan_code, to: sub.pending_plan_code } });
      out.plans++;
    } catch (e) {
      out.errors++;
      logError("upgrades.jobs.plan", e, { org: sub.org_id });
    }
  }
  return out;
}
