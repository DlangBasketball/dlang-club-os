import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook. Verifies the signature, then applies the payment to the
 * invoice via the service-role `apply_stripe_payment` RPC (idempotent on the
 * payment_intent id, so retries/duplicates are safe).
 */
export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error("[stripe] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const invoiceId = session.metadata?.invoice_id;
    const amount = (session.amount_total ?? 0) / 100;
    const paymentIntent =
      typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;

    if (invoiceId && paymentIntent && amount > 0) {
      const supabase = createAdminClient();
      const { error } = await supabase.rpc("apply_stripe_payment", {
        p_invoice: invoiceId,
        p_amount: amount,
        p_payment_intent: paymentIntent,
        p_charge: typeof session.payment_intent === "string" ? undefined : undefined,
      });
      if (error) {
        console.error("[stripe] apply_stripe_payment failed:", error);
        return NextResponse.json({ error: "DB update failed" }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ received: true });
}
