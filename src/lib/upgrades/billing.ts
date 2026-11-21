import "server-only";
import type Stripe from "stripe";
import { getBillingStripe } from "@/lib/platform/billing";
import { PLATFORM_NAME } from "@/lib/platform/catalog";
import type { SubscriptionRow } from "@/lib/platform/types";
import { getFeature } from "./catalog";
import type { PendingPlanColumns } from "./db";
import { planItemOf } from "./sync";

/**
 * Stripe BILLING for add-ons and plan changes (the platform's own Stripe
 * account, test mode in every non-production environment; see
 * src/lib/platform/billing.ts). Add-ons are extra items on the club's
 * platform subscription, tagged with metadata.addon_key; the plan is the item
 * without that tag. Products use deterministic ids so they are created once.
 */

const BILLABLE = ["active", "trialing", "past_due"];

type Sub = SubscriptionRow & PendingPlanColumns;

/** True when add-ons can be billed through Stripe for this subscription. */
export function stripeBillable(sub: Pick<Sub, "stripe_subscription_id" | "status"> | null): boolean {
  return Boolean(getBillingStripe() && sub?.stripe_subscription_id && BILLABLE.includes(sub.status));
}

export function addonProductId(key: string): string {
  return `clubos_addon_${key}`;
}
export function planProductId(code: string): string {
  return `clubos_plan_${code}`;
}

async function ensureProduct(stripe: Stripe, id: string, name: string, metadata: Record<string, string>): Promise<string> {
  try {
    const p = await stripe.products.retrieve(id);
    if (p?.id) return p.id;
  } catch {
    // not found: create below
  }
  try {
    const p = await stripe.products.create({ id, name, metadata });
    return p.id;
  } catch (e) {
    // Created concurrently by another request.
    const p = await stripe.products.retrieve(id).catch(() => null);
    if (p?.id) return p.id;
    throw e;
  }
}

const cents = (amount: number) => Math.round(amount * 100);

/** Adds the add-on to the Stripe subscription now, prorated. */
export async function addStripeAddon(input: {
  orgId: string;
  sub: Sub;
  key: string;
  monthly: number;
  currency: string;
}): Promise<{ itemId: string }> {
  const stripe = getBillingStripe();
  if (!stripe || !input.sub.stripe_subscription_id) throw new Error("BILLING_NOT_CONFIGURED");
  const f = getFeature(input.key);
  const product = await ensureProduct(stripe, addonProductId(input.key), `${PLATFORM_NAME} add-on: ${f?.label ?? input.key}`, {
    addon_key: input.key,
  });
  const yearly = input.sub.billing_interval === "year";
  const item = await stripe.subscriptionItems.create(
    {
      subscription: input.sub.stripe_subscription_id,
      quantity: 1,
      price_data: {
        currency: input.currency.toLowerCase(),
        product,
        unit_amount: cents(yearly ? input.monthly * 12 : input.monthly),
        recurring: { interval: yearly ? "year" : "month" },
      },
      proration_behavior: "create_prorations",
      metadata: { org_id: input.orgId, addon_key: input.key },
    },
    { idempotencyKey: `clubos-addon-${input.orgId}-${input.key}-${new Date().toISOString().slice(0, 13)}` },
  );
  return { itemId: item.id };
}

/** Removes an add-on item (period end has come; no proration credit). */
export async function removeStripeAddon(itemId: string): Promise<void> {
  const stripe = getBillingStripe();
  if (!stripe) throw new Error("BILLING_NOT_CONFIGURED");
  try {
    await stripe.subscriptionItems.del(itemId, { proration_behavior: "none" });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "resource_missing") throw e; // already gone: fine
  }
}

/** Switches the plan item to another plan's price (upgrade: prorated now; downgrade: no proration). */
export async function changeStripePlan(input: {
  sub: Sub;
  planCode: string;
  planName: string;
  amount: number;
  stripePriceId: string | null;
  prorate: boolean;
}): Promise<void> {
  const stripe = getBillingStripe();
  if (!stripe || !input.sub.stripe_subscription_id) throw new Error("BILLING_NOT_CONFIGURED");
  const live = await stripe.subscriptions.retrieve(input.sub.stripe_subscription_id);
  const item = planItemOf(live);
  if (!item) throw new Error("NO_PLAN_ITEM");
  const interval = input.sub.billing_interval === "year" ? "year" : "month";
  const priceSpec: Stripe.SubscriptionUpdateParams.Item = input.stripePriceId
    ? { id: item.id, price: input.stripePriceId }
    : {
        id: item.id,
        price_data: {
          currency: input.sub.currency.toLowerCase(),
          product: await ensureProduct(stripe, planProductId(input.planCode), `${PLATFORM_NAME} — ${input.planName}`, {
            plan_code: input.planCode,
          }),
          unit_amount: cents(input.amount),
          recurring: { interval },
        },
      };
  await stripe.subscriptions.update(input.sub.stripe_subscription_id, {
    items: [priceSpec],
    proration_behavior: input.prorate ? "create_prorations" : "none",
    metadata: { ...(live.metadata ?? {}), plan_code: input.planCode },
  });
}
