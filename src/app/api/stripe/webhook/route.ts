import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { handleStripeEvent, hasWebhookSecret, verifyStripeEvent } from "@/lib/payments/stripe-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook (club payments, Stripe Connect aware).
 * 1. Verifies the signature against the platform and/or Connect endpoint secret.
 * 2. Claims the event id in public.stripe_events (duplicates -> 200, no-op).
 * 3. Maps payment / refund / account events onto the service-role RPCs
 *    (apply_stripe_payment, apply_stripe_refund, set_stripe_connect_account).
 * Transient failures return 500 so Stripe retries; business-rule failures
 * (wrong account/currency, unknown invoice) are recorded and acknowledged.
 */
export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe || !hasWebhookSecret()) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const raw = await req.text();
  const event = verifyStripeEvent(stripe, raw, sig);
  if (!event) {
    console.error("[stripe] signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const outcome = await handleStripeEvent(stripe, event);
  if (outcome.status === "failed") {
    console.error(`[stripe] ${event.type} ${event.id} failed:`, outcome.detail);
    if (outcome.retry) return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true, status: outcome.status });
}
