import "server-only";
import type Stripe from "stripe";
import { fromMinorUnits } from "@/lib/payments/currency";
import { getOrgPaymentProfile } from "@/lib/payments/settings";
import { opsAdminDb } from "./db";

type Outcome = { status: "processed" | "ignored" | "failed"; retry: boolean; detail?: string };

/**
 * checkout.session.completed for a public campaign donation
 * (metadata.purpose = "donation"). The org comes from the session metadata
 * and must own the connected account the event came from; the RPC is
 * idempotent on the session id, so Stripe redeliveries are no-ops.
 */
export async function onDonationSession(session: Stripe.Checkout.Session, account: string | null | undefined): Promise<Outcome> {
  const md = session.metadata ?? {};
  if (session.mode !== "payment" || md.purpose !== "donation" || !md.org_id) return { status: "ignored", retry: false };
  if (session.payment_status !== "paid") return { status: "ignored", retry: false, detail: "awaiting async payment" };
  const profile = await getOrgPaymentProfile(md.org_id);
  if ((profile.stripeAccountId ?? null) !== (account ?? null)) return { status: "ignored", retry: false, detail: "account mismatch" };
  const currency = (session.currency ?? "").toUpperCase();
  const amount = fromMinorUnits(session.amount_total ?? 0, currency);
  if (!currency || amount <= 0) return { status: "ignored", retry: false, detail: "no amount" };
  const { error } = await opsAdminDb().rpc("record_online_donation", {
    p_org: md.org_id,
    p_campaign: md.campaign_id || null,
    p_session_id: session.id,
    p_amount: amount,
    p_currency: currency,
    p_name: md.donor_name || session.customer_details?.name || null,
    p_email: session.customer_details?.email ?? session.customer_email ?? null,
    p_anonymous: md.anonymous === "1",
  });
  if (error) {
    const permanent = /CAMPAIGN_NOT_FOUND/.test(error.message);
    return { status: "failed", retry: !permanent, detail: error.message };
  }
  return { status: "processed", retry: false };
}
