import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyBillingEvent, billingWebhookSecret, getBillingStripe } from "@/lib/platform/billing";
import { asPlatform } from "@/lib/platform/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe BILLING webhook (SaaS subscriptions — tenants paying for the
 * product). Separate endpoint + secret from /api/stripe/webhook, which handles
 * families paying their club.
 *
 * 1. Verifies the Stripe signature against the RAW body.
 * 2. Idempotency: every event id is recorded in public.billing_events; an
 *    event already processed is acknowledged without re-applying it. A failed
 *    event is left unprocessed and answered 500 so Stripe retries it.
 * 3. Applies subscription state via the service role (RLS-bypassing, server
 *    only) — never from client input.
 */
export async function POST(req: Request) {
  const stripe = getBillingStripe();
  const secret = billingWebhookSecret();
  if (!stripe || !secret) {
    return NextResponse.json({ error: "Billing not configured" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const db = asPlatform(createAdminClient());

  // ---- Idempotency ledger -------------------------------------------------
  const obj = event.data.object as { id?: string; object?: string };
  const { error: insErr } = await db.from("billing_events").insert({
    id: event.id,
    type: event.type,
    // Minimal payload only (no customer PII): enough to trace in Stripe.
    payload: { object: obj.object ?? null, object_id: obj.id ?? null, livemode: event.livemode },
  });
  if (insErr) {
    if (insErr.code !== "23505") {
      console.error("[billing] ledger insert failed:", insErr.message);
      return NextResponse.json({ error: "Ledger unavailable" }, { status: 500 });
    }
    const { data: prior } = await db
      .from("billing_events")
      .select("processed_at, attempts")
      .eq("id", event.id)
      .maybeSingle();
    if (prior?.processed_at) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    await db
      .from("billing_events")
      .update({ attempts: (prior?.attempts ?? 1) + 1 })
      .eq("id", event.id);
  }

  // ---- Apply --------------------------------------------------------------
  try {
    const result = await applyBillingEvent(stripe, event);
    await db
      .from("billing_events")
      .update({ processed_at: new Date().toISOString(), org_id: result.orgId, error: result.note ?? null })
      .eq("id", event.id);
    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[billing] ${event.type} ${event.id} failed:`, message);
    await db.from("billing_events").update({ error: message.slice(0, 1000) }).eq("id", event.id);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
