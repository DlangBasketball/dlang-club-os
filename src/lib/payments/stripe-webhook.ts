import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncAccount } from "@/lib/stripe-connect";
import { fromMinorUnits } from "./currency";
import { methodFromStripe } from "./methods";

/**
 * Club-payments webhook logic (Stripe Connect aware).
 *
 * Two endpoints can point at /api/stripe/webhook:
 *   * the platform endpoint   (STRIPE_WEBHOOK_SECRET)          — platform-account events
 *   * the Connect endpoint    (STRIPE_CONNECT_WEBHOOK_SECRET)  — events from clubs'
 *     connected accounts; `event.account` is set.
 * Either secret verifies the signature. Every event is claimed in
 * public.stripe_events first, so redeliveries are no-ops; payment application
 * is additionally idempotent on the payment_intent / refund id in SQL.
 */

export type WebhookOutcome = { status: "processed" | "ignored" | "duplicate" | "failed"; retry: boolean; detail?: string };

/** Verifies against every configured secret. Returns null if none match. */
export function verifyStripeEvent(stripe: Stripe, raw: string, signature: string): Stripe.Event | null {
  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(
    (s): s is string => Boolean(s && s.trim()),
  );
  for (const secret of secrets) {
    try {
      return stripe.webhooks.constructEvent(raw, signature, secret);
    } catch {
      /* try the next secret */
    }
  }
  return null;
}

export function hasWebhookSecret(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_CONNECT_WEBHOOK_SECRET);
}

/** Business-rule errors from the SQL RPCs: retrying won't help. */
const PERMANENT = /INVOICE_NOT_FOUND|ACCOUNT_MISMATCH|CURRENCY_MISMATCH|INVALID_PAYMENT|PAYMENT_NOT_FOUND|INVALID_REFUND/;

type Ctx = { stripe: Stripe; event: Stripe.Event; opts: Stripe.RequestOptions };

async function chargeDetails(ctx: Ctx, charge: string | Stripe.Charge | null | undefined) {
  if (!charge) return { chargeId: undefined, method: "card", detail: undefined as string | undefined };
  const c = typeof charge === "string" ? await ctx.stripe.charges.retrieve(charge, ctx.opts) : charge;
  const pmd = c.payment_method_details;
  const wallet = pmd?.card?.wallet?.type ?? null;
  const detail = pmd?.card?.brand ?? pmd?.us_bank_account?.bank_name ?? pmd?.sepa_debit?.bank_code ?? undefined;
  return { chargeId: c.id, method: methodFromStripe(pmd?.type, wallet), detail: detail ?? undefined };
}

async function applyPaymentIntent(ctx: Ctx, pi: Stripe.PaymentIntent): Promise<WebhookOutcome> {
  const invoiceId = pi.metadata?.invoice_id;
  if (!invoiceId) return { status: "ignored", retry: false, detail: "no invoice_id metadata" };
  if (pi.status !== "succeeded") return { status: "ignored", retry: false, detail: `pi status ${pi.status}` };

  const amount = fromMinorUnits(pi.amount_received || pi.amount, pi.currency);
  if (amount <= 0) return { status: "ignored", retry: false, detail: "zero amount" };
  const { chargeId, method, detail } = await chargeDetails(ctx, pi.latest_charge);
  const fee = pi.application_fee_amount ? fromMinorUnits(pi.application_fee_amount, pi.currency) : undefined;

  const supabase = createAdminClient();
  const { error } = await supabase.rpc("apply_stripe_payment", {
    p_invoice: invoiceId,
    p_amount: amount,
    p_payment_intent: pi.id,
    p_charge: chargeId,
    p_method: method,
    p_currency: pi.currency.toUpperCase(),
    p_account: ctx.event.account ?? undefined,
    p_fee: fee,
    p_method_detail: detail,
  });
  if (error) {
    return { status: "failed", retry: !PERMANENT.test(error.message), detail: `apply_stripe_payment: ${error.message}` };
  }
  return { status: "processed", retry: false };
}

async function onCheckoutSession(ctx: Ctx, session: Stripe.Checkout.Session): Promise<WebhookOutcome> {
  // Subscription / setup sessions belong to SaaS billing, not club fees.
  if (session.mode !== "payment" || !session.metadata?.invoice_id) return { status: "ignored", retry: false };
  // Delayed methods (SEPA / ACH) complete as "unpaid"; we wait for async_payment_succeeded.
  if (session.payment_status !== "paid") return { status: "ignored", retry: false, detail: "awaiting async payment" };
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!piId) return { status: "ignored", retry: false, detail: "no payment_intent" };
  const pi = await ctx.stripe.paymentIntents.retrieve(piId, ctx.opts);
  if (!pi.metadata?.invoice_id) pi.metadata = { ...pi.metadata, invoice_id: session.metadata.invoice_id };
  return applyPaymentIntent(ctx, pi);
}

const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id);

/**
 * Records one refund once it has succeeded. SEPA Debit / US ACH refunds start
 * as "pending" when charge.refunded fires and only succeed later
 * (charge.refund.updated / refund.updated), so every refund event lands here;
 * apply_stripe_refund is idempotent on the refund id.
 */
async function applyRefund(ctx: Ctx, r: Stripe.Refund, piFallback?: string): Promise<WebhookOutcome> {
  if (r.status !== "succeeded") return { status: "ignored", retry: false, detail: `refund status ${r.status}` };
  const piId = idOf(r.payment_intent) ?? piFallback;
  if (!piId) return { status: "ignored", retry: false, detail: "refund without payment_intent" };
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("apply_stripe_refund", {
    p_payment_intent: piId,
    p_refund_id: r.id,
    p_amount: fromMinorUnits(r.amount, r.currency),
    p_currency: r.currency.toUpperCase(),
    p_account: ctx.event.account ?? undefined,
  });
  if (error) {
    // A refund on a charge we never recorded (e.g. SaaS billing) is not ours.
    if (/PAYMENT_NOT_FOUND/.test(error.message)) return { status: "ignored", retry: false, detail: error.message };
    return { status: "failed", retry: !PERMANENT.test(error.message), detail: `apply_stripe_refund: ${error.message}` };
  }
  return { status: "processed", retry: false };
}

async function onChargeRefunded(ctx: Ctx, charge: Stripe.Charge): Promise<WebhookOutcome> {
  const piId = idOf(charge.payment_intent);
  if (!piId) return { status: "ignored", retry: false };
  const refunds = await ctx.stripe.refunds.list({ charge: charge.id, limit: 100 }, ctx.opts);
  let applied = false;
  for (const r of refunds.data) {
    // Pending refunds are picked up by charge.refund.updated / refund.updated.
    if (r.status !== "succeeded") continue;
    const outcome = await applyRefund(ctx, r, piId);
    if (outcome.status !== "processed") return outcome;
    applied = true;
  }
  return applied ? { status: "processed", retry: false } : { status: "ignored", retry: false, detail: "no succeeded refund yet" };
}

/** A lost dispute: Stripe has taken the money back, so the ledger must too. */
async function onDisputeClosed(ctx: Ctx, dispute: Stripe.Dispute): Promise<WebhookOutcome> {
  if (dispute.status !== "lost") return { status: "ignored", retry: false, detail: `dispute ${dispute.status}` };
  const piId = idOf(dispute.payment_intent);
  if (!piId) return { status: "ignored", retry: false, detail: "dispute without payment_intent" };
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("apply_stripe_dispute_loss", {
    p_payment_intent: piId,
    p_dispute_id: dispute.id,
    p_amount: fromMinorUnits(dispute.amount, dispute.currency),
    p_currency: dispute.currency.toUpperCase(),
    p_account: ctx.event.account ?? undefined,
  });
  if (error) {
    if (/PAYMENT_NOT_FOUND/.test(error.message)) return { status: "ignored", retry: false, detail: error.message };
    return { status: "failed", retry: !PERMANENT.test(error.message), detail: `apply_stripe_dispute_loss: ${error.message}` };
  }
  return { status: "processed", retry: false };
}

async function onPaymentFailed(ctx: Ctx, pi: Stripe.PaymentIntent): Promise<WebhookOutcome> {
  const invoiceId = pi.metadata?.invoice_id;
  if (!invoiceId) return { status: "ignored", retry: false };
  const supabase = createAdminClient();
  const orgId = pi.metadata?.org_id ?? null;
  await supabase.from("audit_logs").insert({
    org_id: orgId,
    actor_id: null,
    action: "STRIPE_PAYMENT_FAILED",
    target_table: "invoices",
    target_id: invoiceId,
    new_data: {
      payment_intent: pi.id,
      code: pi.last_payment_error?.code ?? null,
      decline_code: pi.last_payment_error?.decline_code ?? null,
      method: pi.last_payment_error?.payment_method?.type ?? null,
    },
  } as never);
  return { status: "processed", retry: false };
}

async function dispatch(ctx: Ctx): Promise<WebhookOutcome> {
  const { event } = ctx;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return onCheckoutSession(ctx, event.data.object as Stripe.Checkout.Session);
    case "payment_intent.succeeded":
      return applyPaymentIntent(ctx, event.data.object as Stripe.PaymentIntent);
    case "payment_intent.payment_failed":
      return onPaymentFailed(ctx, event.data.object as Stripe.PaymentIntent);
    case "charge.refunded":
      return onChargeRefunded(ctx, event.data.object as Stripe.Charge);
    case "charge.refund.updated":
    case "refund.updated":
      return applyRefund(ctx, event.data.object as Stripe.Refund);
    case "charge.dispute.closed":
      return onDisputeClosed(ctx, event.data.object as Stripe.Dispute);
    case "account.updated": {
      const orgId = await syncAccount(event.data.object as Stripe.Account);
      return orgId ? { status: "processed", retry: false } : { status: "ignored", retry: false, detail: "unknown account" };
    }
    case "account.application.deauthorized": {
      if (!event.account) return { status: "ignored", retry: false };
      const supabase = createAdminClient();
      const { data: orgId } = await supabase.rpc("org_for_stripe_account", { p_account: event.account });
      if (orgId) {
        await supabase.rpc("set_stripe_connect_account", {
          p_org: orgId as string,
          p_account_id: event.account,
          p_charges_enabled: false,
          p_payouts_enabled: false,
          p_details_submitted: false,
        });
      }
      return { status: "processed", retry: false };
    }
    default:
      return { status: "ignored", retry: false };
  }
}

/** Claims, dispatches and records one verified event. */
export async function handleStripeEvent(stripe: Stripe, event: Stripe.Event): Promise<WebhookOutcome> {
  const supabase = createAdminClient();
  const { data: fresh, error: claimErr } = await supabase.rpc("claim_stripe_event", {
    p_id: event.id,
    p_type: event.type,
    p_account: event.account ?? undefined,
    p_livemode: event.livemode,
  });
  if (claimErr) return { status: "failed", retry: true, detail: `claim_stripe_event: ${claimErr.message}` };
  if (fresh === false) return { status: "duplicate", retry: false };

  let outcome: WebhookOutcome;
  try {
    outcome = await dispatch({ stripe, event, opts: event.account ? { stripeAccount: event.account } : {} });
  } catch (err) {
    outcome = { status: "failed", retry: true, detail: (err as Error).message };
  }
  await supabase.rpc("finish_stripe_event", {
    p_id: event.id,
    p_status: outcome.status === "duplicate" ? "processed" : outcome.status,
    p_error: outcome.detail,
  });
  return outcome;
}
