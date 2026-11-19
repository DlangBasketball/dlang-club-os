import "server-only";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { applicationFee, connectOptions } from "@/lib/stripe-connect";
import { toMinorUnits } from "@/lib/payments/currency";
import { classifyOffSession } from "@/lib/payments/plans";
import type { OrgPaymentProfile } from "@/lib/payments/settings";
import { orgReturnOrigin } from "@/lib/tenant/return-origin";
import { plansAdminDb } from "./db";

/**
 * Card autopay on the club's connected account (Stripe Connect, direct).
 *
 *  * Saving a card: Stripe Checkout in `setup` mode for a Customer created on
 *    the club's account. Card details are entered on Stripe's page only; we
 *    keep the customer id, payment method id and brand / last4 / expiry for
 *    display (PCI scope stays SAQ A).
 *  * Charging: an off-session PaymentIntent on the club's account with the
 *    platform application fee, confirmed immediately, idempotency key per
 *    instalment + attempt. The webhook (payment_intent.succeeded) records the
 *    payment on the invoice exactly like any other Stripe payment.
 *  * TWINT can't be charged off-session (each payment is approved in the app),
 *    so autopay is card-only; TWINT stays available per instalment.
 */

export async function createAutopaySetupSession(input: {
  profile: OrgPaymentProfile; mandateId: string; familyId: string; customerId: string | null; email: string | null; returnPath: string;
}): Promise<string> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe isn't configured");
  const { profile } = input;
  const metadata = { purpose: "autopay_setup", mandate_id: input.mandateId, org_id: profile.orgId, family_id: input.familyId };

  let customerId = input.customerId;
  if (!customerId) {
    // Minimum data: the parent's own email (receipts) and opaque ids only.
    const customer = await stripe.customers.create(
      { email: input.email ?? undefined, metadata: { org_id: profile.orgId, family_id: input.familyId } },
      connectOptions(profile, `autopay-customer-${input.mandateId}`),
    );
    customerId = customer.id;
  }
  const back = `${await orgReturnOrigin(profile.orgId)}${/^\/[A-Za-z0-9/_-]*$/.test(input.returnPath) ? input.returnPath : "/parent/payment-plans"}`;
  const session = await stripe.checkout.sessions.create(
    {
      mode: "setup",
      customer: customerId,
      payment_method_types: ["card"],
      locale: "auto",
      metadata,
      setup_intent_data: { metadata, description: `${profile.name} — autopay` },
      success_url: `${back}?autopay=saved`,
      cancel_url: `${back}?autopay=cancelled`,
    },
    connectOptions(profile, `autopay-setup-${input.mandateId}`),
  );
  if (!session.url) throw new Error("Stripe returned no setup URL");
  const { error } = await plansAdminDb().rpc("autopay_attach_session", {
    p_mandate: input.mandateId, p_org: profile.orgId, p_customer: customerId, p_session: session.id, p_account: profile.stripeAccountId,
  });
  if (error) throw new Error(`autopay_attach_session: ${error.message}`);
  return session.url;
}

export type OffSessionResult = {
  outcome: "succeeded" | "processing" | "requires_action" | "failed";
  paymentIntentId: string | null;
  code: string | null;
  declineCode: string | null;
};

/** One off-session charge. Never throws for card errors: they become an outcome. */
export async function chargeOffSession(input: {
  profile: OrgPaymentProfile; chargeId: string; idempotencyKey: string; amount: number; currency: string;
  customerId: string; paymentMethodId: string; invoiceId: string; installmentId: string; description: string;
}): Promise<OffSessionResult> {
  const stripe = getStripe();
  if (!stripe) return { outcome: "failed", paymentIntentId: null, code: "stripe_not_configured", declineCode: null };
  const { profile } = input;
  const amountMinor = toMinorUnits(input.amount, input.currency);
  const fee = profile.stripeAccountId ? await applicationFee(profile.orgId, amountMinor) : 0;
  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: amountMinor,
        currency: input.currency.toLowerCase(),
        customer: input.customerId,
        payment_method: input.paymentMethodId,
        payment_method_types: ["card"],
        off_session: true,
        confirm: true,
        description: input.description,
        metadata: {
          purpose: "autopay", invoice_id: input.invoiceId, org_id: profile.orgId,
          installment_id: input.installmentId, autopay_charge_id: input.chargeId,
        },
        ...(fee > 0 ? { application_fee_amount: fee } : {}),
      },
      connectOptions(profile, input.idempotencyKey),
    );
    return { outcome: classifyOffSession({ status: pi.status }), paymentIntentId: pi.id, code: null, declineCode: null };
  } catch (err) {
    const e = err as { type?: string; code?: string; decline_code?: string; raw?: { payment_intent?: Stripe.PaymentIntent } };
    const pi = e.raw?.payment_intent;
    if (!e.type || !String(e.type).includes("Card")) {
      // Network / API errors: retry on the next run with the SAME key (Stripe dedupes).
      if (e.type === "StripeInvalidRequestError") {
        return { outcome: "failed", paymentIntentId: pi?.id ?? null, code: e.code ?? "invalid_request", declineCode: null };
      }
      throw err;
    }
    return {
      outcome: classifyOffSession({ status: pi?.status, code: e.code, declineCode: e.decline_code }),
      paymentIntentId: pi?.id ?? null,
      code: e.code ?? null,
      declineCode: e.decline_code ?? null,
    };
  }
}

/** Removes a saved card from the club's Stripe account (best effort). */
export async function detachPaymentMethod(profile: OrgPaymentProfile, paymentMethodId: string | null | undefined): Promise<void> {
  const stripe = getStripe();
  if (!stripe || !paymentMethodId) return;
  try {
    await stripe.paymentMethods.detach(paymentMethodId, connectOptions(profile));
  } catch (err) {
    console.warn("[autopay] detach failed:", (err as Error).message);
  }
}
