import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyFamily } from "./notify";

/**
 * Autopay webhook events (club Connect endpoint). Tenant: always the org
 * mapped from the connected account + the mandate / charge row; metadata only
 * points at our row and the SQL re-checks the account (ACCOUNT_MISMATCH).
 *   checkout.session.completed (mode=setup, purpose=autopay_setup)
 *   setup_intent.succeeded                                  -> autopay_activate
 *   payment_intent.succeeded / payment_failed / requires_action
 *     with metadata.autopay_charge_id                       -> autopay_charge_result
 *   payment_method.detached / payment_method.updated /
 *   payment_method.automatically_updated                    -> autopay_payment_method_event
 */
export type PlanWebhookOutcome = { status: "processed" | "ignored" | "failed"; retry: boolean; detail?: string };
type Ctx = { stripe: Stripe; event: Stripe.Event; opts: Stripe.RequestOptions };

const PERMANENT = /MANDATE_NOT_FOUND|MANDATE_NOT_PENDING|ACCOUNT_MISMATCH|CUSTOMER_MISMATCH|INVALID_STATUS/;
// The service-role client is untyped for the new RPCs until `npm run types` runs.
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc: Rpc = (fn, args) => (createAdminClient() as unknown as { rpc: Rpc }).rpc(fn, args);

const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id);

function fail(error: { message: string }, fn: string): PlanWebhookOutcome {
  return { status: "failed", retry: !PERMANENT.test(error.message), detail: `${fn}: ${error.message}` };
}

async function activateFromSetupIntent(ctx: Ctx, si: Stripe.SetupIntent, mandateId: string): Promise<PlanWebhookOutcome> {
  if (si.status !== "succeeded") return { status: "ignored", retry: false, detail: `setup_intent ${si.status}` };
  const pmId = idOf(si.payment_method);
  if (!pmId) return { status: "ignored", retry: false, detail: "no payment method" };
  const pm = typeof si.payment_method === "object" && si.payment_method
    ? si.payment_method
    : await ctx.stripe.paymentMethods.retrieve(pmId, ctx.opts);
  if (pm.type !== "card" || !pm.card) return { status: "ignored", retry: false, detail: `payment method ${pm.type}` };
  const { data, error } = await rpc("autopay_activate", {
    p_mandate: mandateId,
    p_account: ctx.event.account ?? null,
    p_customer: idOf(si.customer) ?? null,
    p_payment_method: pm.id,
    p_brand: pm.card.brand ?? null,
    p_last4: pm.card.last4 ?? null,
    p_exp_month: pm.card.exp_month ?? null,
    p_exp_year: pm.card.exp_year ?? null,
  });
  if (error) return fail(error, "autopay_activate");
  // Detach the card(s) this one replaced (best effort; Stripe keeps nothing on us).
  const replaced = ((data as { replaced?: { payment_method?: string | null }[] } | null)?.replaced ?? [])
    .map((r) => r.payment_method).filter((x): x is string => Boolean(x) && x !== pm.id);
  for (const old of replaced) {
    try { await ctx.stripe.paymentMethods.detach(old, ctx.opts); } catch { /* already detached */ }
  }
  return { status: "processed", retry: false };
}

export async function onAutopaySetupSession(ctx: Ctx, session: Stripe.Checkout.Session): Promise<PlanWebhookOutcome> {
  const mandateId = session.metadata?.mandate_id;
  if (session.mode !== "setup" || session.metadata?.purpose !== "autopay_setup" || !mandateId) return { status: "ignored", retry: false };
  const siId = idOf(session.setup_intent);
  if (!siId) return { status: "ignored", retry: false, detail: "no setup_intent" };
  const si = await ctx.stripe.setupIntents.retrieve(siId, { expand: ["payment_method"] }, ctx.opts);
  return activateFromSetupIntent(ctx, si, mandateId);
}

export async function onSetupIntentSucceeded(ctx: Ctx, si: Stripe.SetupIntent): Promise<PlanWebhookOutcome> {
  const mandateId = si.metadata?.mandate_id;
  if (si.metadata?.purpose !== "autopay_setup" || !mandateId) return { status: "ignored", retry: false };
  return activateFromSetupIntent(ctx, si, mandateId);
}

/** Outcome of an off-session autopay PaymentIntent (the payment itself is applied by the caller). */
export async function onAutopayIntent(ctx: Ctx, pi: Stripe.PaymentIntent, status: "succeeded" | "failed" | "requires_action"): Promise<PlanWebhookOutcome> {
  const chargeId = pi.metadata?.autopay_charge_id;
  if (!chargeId) return { status: "ignored", retry: false };
  const err = pi.last_payment_error;
  const { data, error } = await rpc("autopay_charge_result", {
    p_charge: chargeId,
    p_payment_intent: pi.id,
    p_status: status,
    p_code: err?.code ?? null,
    p_decline: err?.decline_code ?? null,
    p_account: ctx.event.account ?? null,
  });
  if (error) return fail(error, "autopay_charge_result");
  const r = (data ?? {}) as { transitioned?: boolean; fallback?: boolean; next_retry_on?: string | null; org_id?: string; family_id?: string; invoice_id?: string; installment_id?: string; amount?: number; currency?: string };
  // Notify only on a real transition (the cron may already have recorded it).
  if (r.transitioned && r.org_id && r.family_id && status !== "succeeded") {
    const kind = status === "requires_action" ? "authRequired" : r.fallback ? "fallback" : "chargeFailed";
    await notifyFamily(r.org_id, r.family_id, kind, {
      invoiceId: r.invoice_id, installmentId: r.installment_id, amount: Number(r.amount ?? 0), currency: r.currency, retryDate: r.next_retry_on ?? null,
    });
  }
  return { status: "processed", retry: false };
}

export async function onPaymentMethodEvent(ctx: Ctx, pm: Stripe.PaymentMethod, detached: boolean): Promise<PlanWebhookOutcome> {
  const { data, error } = await rpc("autopay_payment_method_event", {
    p_account: ctx.event.account ?? null,
    p_payment_method: pm.id,
    p_detached: detached,
    p_brand: pm.card?.brand ?? null,
    p_last4: pm.card?.last4 ?? null,
    p_exp_month: pm.card?.exp_month ?? null,
    p_exp_year: pm.card?.exp_year ?? null,
  });
  if (error) return fail(error, "autopay_payment_method_event");
  return Number(data ?? 0) > 0 ? { status: "processed", retry: false } : { status: "ignored", retry: false, detail: "no mandate" };
}
