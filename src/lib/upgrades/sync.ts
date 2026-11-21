import "server-only";
import type Stripe from "stripe";
import { getFeature, isCoreFeature } from "./catalog";
import { upgradesAdminDb, type FeatureGrantRow } from "./db";

/** The plan item of a subscription: the first item that is not an add-on. */
export function planItemOf(sub: Pick<Stripe.Subscription, "items">): Stripe.SubscriptionItem | undefined {
  const items = sub.items?.data ?? [];
  return items.find((i) => !i.metadata?.addon_key) ?? items[0];
}

/** Add-on items of a subscription keyed by feature (unknown / core keys ignored). */
export function addonItemsOf(sub: Pick<Stripe.Subscription, "items">): { key: string; item: Stripe.SubscriptionItem }[] {
  return (sub.items?.data ?? [])
    .filter((i) => {
      const k = i.metadata?.addon_key;
      return Boolean(k && getFeature(k) && !isCoreFeature(k));
    })
    .map((i) => ({ key: i.metadata.addon_key, item: i }));
}

// ---------------------------------------------------------------------------
// Webhook: mirror add-on items onto org_feature_grants (idempotent)
// ---------------------------------------------------------------------------

/**
 * Makes org_feature_grants match the add-on items of a Stripe subscription:
 *   * every tagged item -> an open 'addon' grant carrying its item id
 *     (an existing open grant for that feature is attached, not duplicated;
 *     a grant already 'canceling' keeps its scheduled end);
 *   * every open add-on grant whose item is gone (or the subscription ended)
 *     -> 'canceled'.
 * Running it twice for the same subscription state changes nothing.
 */
export async function syncAddonItems(orgId: string, sub: Stripe.Subscription): Promise<{ upserted: number; canceled: number }> {
  const db = upgradesAdminDb();
  const ended = ["canceled", "incomplete_expired"].includes(sub.status);
  const items = ended ? [] : addonItemsOf(sub);
  const { data: open } = await db
    .from("org_feature_grants")
    .select("*")
    .eq("org_id", orgId)
    .eq("kind", "addon")
    .in("status", ["pending", "active", "canceling"]);
  const grants = (open ?? []) as FeatureGrantRow[];
  let upserted = 0;
  let canceled = 0;
  const currency = (sub.currency ?? "chf").toUpperCase();

  for (const { key, item } of items) {
    const unit = (item.price?.unit_amount ?? 0) / 100;
    const monthly = item.price?.recurring?.interval === "year" ? unit / 12 : unit;
    const byItem = grants.find((g) => g.stripe_subscription_item_id === item.id);
    const byKey = grants.find((g) => g.feature_key === key && !g.stripe_subscription_item_id);
    const g = byItem ?? byKey;
    if (g) {
      const status = g.status === "canceling" ? "canceling" : "active";
      if (g.stripe_subscription_item_id !== item.id || g.status !== status) {
        const { error } = await db
          .from("org_feature_grants")
          .update({ stripe_subscription_item_id: item.id, status, starts_at: g.status === "pending" ? new Date().toISOString() : g.starts_at })
          .eq("id", g.id)
          .eq("org_id", orgId);
        if (error) throw new Error(`addon grant update failed: ${error.message}`);
        upserted++;
      }
      continue;
    }
    const { error } = await db.from("org_feature_grants").insert({
      org_id: orgId,
      feature_key: key,
      kind: "addon",
      status: "active",
      currency: ["CHF", "EUR", "USD"].includes(currency) ? currency : null,
      amount: Math.round(monthly * 100) / 100,
      stripe_subscription_item_id: item.id,
      note: "Synced from Stripe Billing",
    });
    // 23505: the same item arrived concurrently — already recorded.
    if (error && error.code !== "23505") throw new Error(`addon grant insert failed: ${error.message}`);
    if (!error) upserted++;
  }

  const live = new Set(items.map((i) => i.item.id));
  for (const g of grants) {
    if (!g.stripe_subscription_item_id || live.has(g.stripe_subscription_item_id)) continue;
    const now = new Date();
    const starts = new Date(g.starts_at);
    const end = new Date(Math.max(now.getTime(), starts.getTime() + 1000)).toISOString();
    const { error } = await db
      .from("org_feature_grants")
      .update({ status: "canceled", ends_at: end })
      .eq("id", g.id)
      .eq("org_id", orgId);
    if (error) throw new Error(`addon grant cancel failed: ${error.message}`);
    canceled++;
  }
  return { upserted, canceled };
}
