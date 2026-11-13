import "server-only";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { toMinorUnits } from "@/lib/payments/currency";
import { stripeMethodTypes, type AvailableMethod } from "@/lib/payments/methods";
import type { OrgPaymentProfile } from "@/lib/payments/settings";
import { expressCapabilities, twintCapabilityEnabled } from "@/lib/payments/connect-capabilities";
import { orgReturnOrigin } from "@/lib/tenant/return-origin";

/**
 * Stripe Connect for club fee collection.
 *
 * Model: every club is a connected account (Standard by default, Express via
 * STRIPE_CONNECT_ACCOUNT_TYPE=express). Member payments are DIRECT charges on
 * the club's account (`stripeAccount` header), so the club is merchant of
 * record and is paid out directly; the platform takes an `application_fee_amount`
 * resolved per SaaS plan by public.resolve_application_fee().
 *
 * Founding-club / single-tenant fallback: with no connected account and
 * STRIPE_CONNECT_REQUIRED != "true", charges go to the platform account (the
 * pre-Connect behaviour).
 *
 * Return links (Checkout success/cancel, onboarding refresh/return) point at
 * the org's own host (orgReturnOrigin), because auth cookies are per host.
 */

export type ConnectAccountType = "standard" | "express";

export function connectAccountType(): ConnectAccountType {
  return process.env.STRIPE_CONNECT_ACCOUNT_TYPE === "express" ? "express" : "standard";
}

function expressCapabilitiesFor(country: string) {
  return expressCapabilities(country, { requestTwint: twintCapabilityEnabled(process.env.STRIPE_CONNECT_REQUEST_TWINT) });
}

/** Returns the org's connected account id, creating the account on first use. */
export async function ensureConnectAccount(profile: OrgPaymentProfile, email?: string | null): Promise<string> {
  const stripe = getStripe();
  if (profile.stripeAccountId) {
    // Express accounts created before TWINT was requested: ask again (no-op
    // for capabilities already requested). Best effort; never blocks onboarding.
    if (stripe && profile.settings.stripe?.account_type === "express") {
      try {
        await stripe.accounts.update(profile.stripeAccountId, { capabilities: expressCapabilitiesFor(profile.country) });
      } catch (err) {
        console.warn("[stripe-connect] capability update failed:", (err as Error).message);
      }
    }
    return profile.stripeAccountId;
  }
  if (!stripe) throw new Error("Stripe isn't configured (STRIPE_SECRET_KEY)");

  const type = connectAccountType();
  const account = await stripe.accounts.create(
    {
      type,
      country: profile.country,
      email: email ?? undefined,
      default_currency: profile.currency.toLowerCase(),
      business_profile: { name: profile.name, mcc: "7941" }, // 7941: sports clubs / fields / promoters
      metadata: { org_id: profile.orgId },
      ...(type === "express"
        ? { capabilities: expressCapabilitiesFor(profile.country) }
        : {}),
    },
    { idempotencyKey: `connect-account-${profile.orgId}` },
  );
  await persistAccount(profile.orgId, account);
  return account.id;
}

/** Hosted onboarding link (expires after a few minutes; regenerate on refresh). */
export async function createOnboardingLink(accountId: string, orgId: string): Promise<string> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe isn't configured (STRIPE_SECRET_KEY)");
  const origin = await orgReturnOrigin(orgId);
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${origin}/api/stripe/connect/onboard`,
    return_url: `${origin}/api/stripe/connect/return`,
  });
  return link.url;
}

/** Writes the account's capability flags to organizations.payment_settings.stripe. */
export async function persistAccount(orgId: string, account: Stripe.Account): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("set_stripe_connect_account", {
    p_org: orgId,
    p_account_id: account.id,
    p_account_type: account.type === "express" ? "express" : "standard",
    p_charges_enabled: Boolean(account.charges_enabled),
    p_payouts_enabled: Boolean(account.payouts_enabled),
    p_details_submitted: Boolean(account.details_submitted),
  });
  if (error) throw new Error(`set_stripe_connect_account failed: ${error.message}`);
}

/** Re-reads an account from Stripe and stores its status (onboarding return / account.updated). */
export async function syncAccount(account: Stripe.Account): Promise<string | null> {
  const supabase = createAdminClient();
  let orgId = account.metadata?.org_id ?? null;
  if (!orgId) {
    const { data } = await supabase.rpc("org_for_stripe_account", { p_account: account.id });
    orgId = (data as string | null) ?? null;
  }
  if (!orgId) return null;
  await persistAccount(orgId, account);
  return orgId;
}

async function applicationFee(orgId: string, amountMinor: number): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("resolve_application_fee", { p_org: orgId, p_amount_minor: amountMinor });
  if (error) return 0;
  return Number(data ?? 0);
}

export type InvoiceChargeInput = {
  profile: OrgPaymentProfile;
  invoiceId: string;
  invoiceNumber: string;
  currency: string;
  /** Outstanding balance in major units. */
  amount: number;
  methods: AvailableMethod[];
  customerEmail?: string | null;
  locale?: string;
  /** Path on the club's site to come back to (default: the parent app invoice page). */
  returnPath?: string;
};

function connectOptions(profile: OrgPaymentProfile, idempotencyKey?: string): Stripe.RequestOptions {
  return {
    ...(profile.stripeAccountId ? { stripeAccount: profile.stripeAccountId } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

/**
 * Hosted Checkout on the club's connected account. Requests the region's
 * method matrix explicitly; if a method isn't activated on the account, falls
 * back to Stripe's dynamic (automatic) payment methods.
 */
export async function createInvoiceCheckout(input: InvoiceChargeInput): Promise<string> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Online payments aren't configured yet");
  const { profile } = input;
  const amountMinor = toMinorUnits(input.amount, input.currency);
  const fee = profile.stripeAccountId ? await applicationFee(profile.orgId, amountMinor) : 0;
  const metadata = { invoice_id: input.invoiceId, org_id: profile.orgId };
  const path = input.returnPath && /^\/[A-Za-z0-9/_-]*$/.test(input.returnPath) ? input.returnPath : `/parent/invoices/${input.invoiceId}`;
  const back = `${await orgReturnOrigin(profile.orgId)}${path}`;

  const base: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: amountMinor,
          product_data: { name: `${profile.name} — Invoice ${input.invoiceNumber}` },
        },
      },
    ],
    customer_email: input.customerEmail ?? undefined,
    locale: "auto",
    metadata,
    payment_intent_data: {
      metadata,
      description: `${profile.name} — Invoice ${input.invoiceNumber}`,
      ...(fee > 0 ? { application_fee_amount: fee } : {}),
    },
    success_url: `${back}?paid=1`,
    cancel_url: back,
  };

  const types = stripeMethodTypes(input.methods);
  if (types.length) {
    try {
      const s = await stripe.checkout.sessions.create(
        { ...base, payment_method_types: types },
        connectOptions(profile),
      );
      if (s.url) return s.url;
    } catch (err) {
      console.warn("[stripe] explicit payment_method_types rejected, using automatic methods:", (err as Error).message);
    }
  }
  const s = await stripe.checkout.sessions.create(base, connectOptions(profile));
  if (!s.url) throw new Error("Could not start checkout");
  return s.url;
}

/**
 * PaymentIntent on the connected account with automatic_payment_methods, for
 * an embedded Payment Element. Idempotent per invoice + amount, so repeated
 * clicks reuse the same intent. The browser needs `clientSecret` and must
 * initialise Stripe.js with `{ stripeAccount }`.
 */
export async function createInvoicePaymentIntent(
  input: Omit<InvoiceChargeInput, "methods">,
): Promise<{ clientSecret: string; paymentIntentId: string; stripeAccount: string | null }> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Online payments aren't configured yet");
  const { profile } = input;
  const amountMinor = toMinorUnits(input.amount, input.currency);
  const fee = profile.stripeAccountId ? await applicationFee(profile.orgId, amountMinor) : 0;

  const pi = await stripe.paymentIntents.create(
    {
      amount: amountMinor,
      currency: input.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      description: `${profile.name} — Invoice ${input.invoiceNumber}`,
      receipt_email: input.customerEmail ?? undefined,
      metadata: { invoice_id: input.invoiceId, org_id: profile.orgId },
      ...(fee > 0 ? { application_fee_amount: fee } : {}),
    },
    connectOptions(profile, `pi-${input.invoiceId}-${amountMinor}-${input.currency}`),
  );
  if (!pi.client_secret) throw new Error("Stripe returned no client secret");
  return { clientSecret: pi.client_secret, paymentIntentId: pi.id, stripeAccount: profile.stripeAccountId };
}
