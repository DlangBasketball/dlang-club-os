import "server-only";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { PLATFORM_NAME } from "./catalog";
import {
  asPlatform,
  type BillingInterval,
  type Currency,
  type PlanPriceRow,
  type PlanRow,
  type SubscriptionRow,
  type SubscriptionStatus,
} from "./types";

/**
 * Stripe BILLING for the SaaS itself (tenants paying for the product).
 *
 * Deliberately separate from src/lib/stripe.ts, which is the CLUB's Stripe
 * account used to collect money from families. Configure with:
 *   STRIPE_BILLING_SECRET_KEY      sk_test_… of the platform company
 *   STRIPE_BILLING_WEBHOOK_SECRET  whsec_… of the /api/billing/webhook endpoint
 * Works end-to-end with test-mode keys: prices are created inline with
 * `price_data` unless a plan price row carries a pre-made stripe_price_id.
 */

let cached: Stripe | null = null;

export function getBillingStripe(): Stripe | null {
  const key = process.env.STRIPE_BILLING_SECRET_KEY;
  if (!key || key.trim() === "") return null;
  if (!cached) cached = new Stripe(key, { appInfo: { name: `${PLATFORM_NAME} billing` } });
  return cached;
}

export function billingConfigured(): boolean {
  return Boolean(process.env.STRIPE_BILLING_SECRET_KEY);
}

export function billingWebhookSecret(): string | null {
  const s = process.env.STRIPE_BILLING_WEBHOOK_SECRET;
  return s && s.trim() !== "" ? s : null;
}

const STATUSES: SubscriptionStatus[] = [
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused",
];

export function mapStripeStatus(s: string): SubscriptionStatus {
  return (STATUSES as string[]).includes(s) ? (s as SubscriptionStatus) : "incomplete";
}

const toIso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);

// ---------------------------------------------------------------------------
// Checkout & portal
// ---------------------------------------------------------------------------

export type CheckoutInput = {
  orgId: string;
  orgName: string;
  email: string | null;
  planCode: string;
  interval: BillingInterval;
  siteUrl: string;
};

export type BillingResult = { ok: true; url: string } | { ok: false; status: number; error: string };

async function ensureCustomer(
  stripe: Stripe,
  sub: SubscriptionRow,
  orgName: string,
  email: string | null,
): Promise<string> {
  if (sub.stripe_customer_id) return sub.stripe_customer_id;
  const customer = await stripe.customers.create(
    {
      name: orgName,
      email: email ?? undefined,
      metadata: { org_id: sub.org_id },
    },
    { idempotencyKey: `club-os-customer-${sub.org_id}` },
  );
  const db = asPlatform(createAdminClient());
  // Only set when still empty: a concurrent request must not overwrite it.
  await db
    .from("subscriptions")
    .update({ stripe_customer_id: customer.id })
    .eq("org_id", sub.org_id)
    .is("stripe_customer_id", null);
  const { data } = await db.from("subscriptions").select("stripe_customer_id").eq("org_id", sub.org_id).maybeSingle();
  return data?.stripe_customer_id ?? customer.id;
}

export async function createCheckoutSession(input: CheckoutInput): Promise<BillingResult> {
  const stripe = getBillingStripe();
  if (!stripe) return { ok: false, status: 503, error: "Billing is not configured" };

  const db = asPlatform(createAdminClient());
  const [{ data: sub }, { data: plan }] = await Promise.all([
    db.from("subscriptions").select("*").eq("org_id", input.orgId).maybeSingle(),
    db.from("plans").select("*").eq("code", input.planCode).maybeSingle(),
  ]);
  if (!sub) return { ok: false, status: 404, error: "No subscription record for this organization" };
  const p = plan as PlanRow | null;
  if (!p || !p.is_active || !p.is_public) return { ok: false, status: 400, error: "Unknown plan" };
  if (p.is_custom) return { ok: false, status: 400, error: "This plan is sold by our team — please contact sales" };

  const s = sub as SubscriptionRow;
  if (s.stripe_subscription_id && ["active", "trialing", "past_due"].includes(s.status)) {
    // Already billing through Stripe: plan changes happen in the customer portal.
    return createPortalSession({ orgId: input.orgId, siteUrl: input.siteUrl });
  }

  const currency: Currency = s.currency;
  const { data: priceRow } = await db
    .from("plan_prices")
    .select("*")
    .eq("plan_code", p.code)
    .eq("currency", currency)
    .eq("billing_interval", input.interval)
    .maybeSingle();
  const price = priceRow as PlanPriceRow | null;
  if (!price) return { ok: false, status: 400, error: `No ${input.interval}ly ${currency} price for ${p.name}` };

  const customer = await ensureCustomer(stripe, s, input.orgName, input.email);

  // Keep the remaining trial when upgrading mid-trial (Stripe needs >= 48h).
  const trialEnd =
    s.status === "trialing" && s.trial_ends_at
      ? Math.floor(new Date(s.trial_ends_at).getTime() / 1000)
      : null;
  const keepTrial = trialEnd !== null && trialEnd > Math.floor(Date.now() / 1000) + 48 * 3600;

  // One-time onboarding fee: monthly plans only (annual prepay waives it), never
  // for founding clubs (onboarding_fee_waived) and never twice.
  const onboardingFee =
    input.interval === "month" && !s.onboarding_fee_waived && !s.onboarding_fee_paid_at
      ? Number(price.onboarding_fee ?? 0)
      : 0;

  const metadata = {
    org_id: input.orgId,
    plan_code: p.code,
    interval: input.interval,
    currency,
    onboarding_fee: onboardingFee > 0 ? onboardingFee.toFixed(2) : "0",
  };

  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = price.stripe_price_id
    ? { price: price.stripe_price_id, quantity: 1 }
    : {
        quantity: 1,
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: Math.round(Number(price.amount) * 100),
          recurring: { interval: input.interval },
          product_data: {
            name: `${PLATFORM_NAME} — ${p.name}`,
            metadata: { plan_code: p.code },
          },
        },
      };

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: input.orgId,
    line_items:
      onboardingFee > 0
        ? [
            lineItem,
            {
              quantity: 1,
              price_data: {
                currency: currency.toLowerCase(),
                unit_amount: Math.round(onboardingFee * 100),
                product_data: {
                  name: `${PLATFORM_NAME} — ${p.name} onboarding (one-time)`,
                  metadata: { plan_code: p.code, kind: "onboarding_fee" },
                },
              },
            },
          ]
        : [lineItem],
    allow_promotion_codes: true,
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    subscription_data: {
      metadata,
      ...(keepTrial ? { trial_end: trialEnd! } : {}),
    },
    metadata,
    success_url: `${input.siteUrl}/signup/plan?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.siteUrl}/signup/plan?checkout=cancelled`,
  });

  if (!session.url) return { ok: false, status: 502, error: "Stripe did not return a checkout URL" };
  return { ok: true, url: session.url };
}

export async function createPortalSession(input: { orgId: string; siteUrl: string }): Promise<BillingResult> {
  const stripe = getBillingStripe();
  if (!stripe) return { ok: false, status: 503, error: "Billing is not configured" };
  const db = asPlatform(createAdminClient());
  const { data: sub } = await db
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("org_id", input.orgId)
    .maybeSingle();
  if (!sub?.stripe_customer_id) return { ok: false, status: 400, error: "No billing account yet — choose a plan first" };
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${input.siteUrl}/signup/plan`,
  });
  return { ok: true, url: session.url };
}

// ---------------------------------------------------------------------------
// Webhook processing
// ---------------------------------------------------------------------------

async function resolveOrgId(sub: Stripe.Subscription, fallback?: string | null): Promise<string | null> {
  const fromMeta = sub.metadata?.org_id;
  if (fromMeta) return fromMeta;
  if (fallback) return fallback;
  const db = asPlatform(createAdminClient());
  const { data: bySub } = await db
    .from("subscriptions")
    .select("org_id")
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();
  if (bySub?.org_id) return bySub.org_id;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const { data: byCustomer } = await db
    .from("subscriptions")
    .select("org_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return byCustomer?.org_id ?? null;
}

async function resolvePlanCode(sub: Stripe.Subscription, priceId: string | null): Promise<string | null> {
  const fromMeta = sub.metadata?.plan_code;
  const db = asPlatform(createAdminClient());
  if (fromMeta) {
    const { data } = await db.from("plans").select("code").eq("code", fromMeta).maybeSingle();
    if (data?.code) return data.code;
  }
  if (priceId) {
    const { data } = await db.from("plan_prices").select("plan_code").eq("stripe_price_id", priceId).maybeSingle();
    if (data?.plan_code) return data.plan_code;
  }
  const item = sub.items?.data?.[0];
  const productMeta =
    item && typeof item.price.product === "object" && item.price.product && "metadata" in item.price.product
      ? (item.price.product as Stripe.Product).metadata?.plan_code
      : undefined;
  return productMeta ?? null;
}

/**
 * Mirrors a Stripe subscription onto public.subscriptions (service role).
 * `eventCreated` (unix seconds) guards against out-of-order deliveries: an
 * older event never overwrites state written by a newer one.
 */
export async function syncSubscription(
  sub: Stripe.Subscription,
  opts: { eventCreated?: number; fallbackOrgId?: string | null } = {},
): Promise<{ orgId: string | null; skipped?: string }> {
  const orgId = await resolveOrgId(sub, opts.fallbackOrgId);
  if (!orgId) return { orgId: null, skipped: "no org for subscription" };

  const db = asPlatform(createAdminClient());
  const { data: existing } = await db
    .from("subscriptions")
    .select("org_id, plan_code, last_stripe_event_at, stripe_subscription_id")
    .eq("org_id", orgId)
    .maybeSingle();

  const eventAt = opts.eventCreated ? new Date(opts.eventCreated * 1000).toISOString() : null;
  if (eventAt && existing?.last_stripe_event_at && existing.last_stripe_event_at > eventAt) {
    return { orgId, skipped: "stale event" };
  }
  // A different, newer subscription already owns this org: ignore events from an old one.
  if (
    existing?.stripe_subscription_id &&
    existing.stripe_subscription_id !== sub.id &&
    ["canceled", "incomplete_expired"].includes(sub.status)
  ) {
    return { orgId, skipped: "event for superseded subscription" };
  }

  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id ?? null;
  const planCode = (await resolvePlanCode(sub, priceId)) ?? existing?.plan_code ?? "club";
  const currency = (item?.price?.currency ?? sub.currency ?? "chf").toUpperCase();
  const interval = item?.price?.recurring?.interval;
  const periodEnd =
    (sub as Stripe.Subscription & { current_period_end?: number }).current_period_end ??
    (item as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined)?.current_period_end ??
    null;

  const row: Record<string, unknown> = {
    org_id: orgId,
    plan_code: planCode,
    status: mapStripeStatus(sub.status),
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripe_subscription_id: sub.id,
    stripe_price_id: priceId,
    trial_ends_at: toIso(sub.trial_end),
    current_period_end: toIso(periodEnd),
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    canceled_at: toIso(sub.canceled_at),
    last_stripe_event_at: eventAt ?? new Date().toISOString(),
  };
  if (["CHF", "EUR", "USD"].includes(currency)) row.currency = currency;
  if (interval === "month" || interval === "year") row.billing_interval = interval;

  const { error } = await db.from("subscriptions").upsert(row, { onConflict: "org_id" });
  if (error) throw new Error(`subscriptions upsert failed: ${error.message}`);
  return { orgId };
}

/** Applies one verified Stripe event. Throws on failure so Stripe retries. */
export async function applyBillingEvent(stripe: Stripe, event: Stripe.Event): Promise<{ orgId: string | null; note?: string }> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription" || !session.subscription) return { orgId: null, note: "not a subscription checkout" };
      const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
      // Fetch the live object: authoritative, so no stale-event guard needed.
      const sub = await stripe.subscriptions.retrieve(subId);
      const res = await syncSubscription(sub, {
        fallbackOrgId: session.metadata?.org_id ?? session.client_reference_id ?? null,
      });
      // Record a paid onboarding fee so a later re-subscription never charges it again.
      if (res.orgId && Number(session.metadata?.onboarding_fee ?? 0) > 0 && session.payment_status === "paid") {
        const db = asPlatform(createAdminClient());
        const { error } = await db
          .from("subscriptions")
          .update({ onboarding_fee_paid_at: new Date().toISOString() })
          .eq("org_id", res.orgId)
          .is("onboarding_fee_paid_at", null);
        if (error) throw new Error(`onboarding fee update failed: ${error.message}`);
      }
      return { orgId: res.orgId, note: res.skipped };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
    case "customer.subscription.trial_will_end": {
      const sub = event.data.object as Stripe.Subscription;
      const res = await syncSubscription(sub, { eventCreated: event.created });
      return { orgId: res.orgId, note: res.skipped };
    }
    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.payment_action_required": {
      const inv = event.data.object as Stripe.Invoice;
      const subRef = (inv as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null }).subscription;
      if (!subRef) return { orgId: null, note: "invoice without subscription" };
      const subId = typeof subRef === "string" ? subRef : subRef.id;
      const sub = await stripe.subscriptions.retrieve(subId);
      const res = await syncSubscription(sub);
      return { orgId: res.orgId, note: res.skipped };
    }
    default:
      return { orgId: null, note: "ignored event type" };
  }
}
