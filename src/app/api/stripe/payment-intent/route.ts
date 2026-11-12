import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { loadPayableInvoice } from "@/lib/payments/invoice-payable";
import { getOrgPaymentProfile } from "@/lib/payments/settings";
import { createInvoicePaymentIntent } from "@/lib/stripe-connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ invoiceId: z.string().uuid() });

/**
 * POST /api/stripe/payment-intent { invoiceId }
 * Creates (or reuses, idempotently) a PaymentIntent on the club's connected
 * account with automatic_payment_methods, for an embedded Payment Element.
 * Returns { clientSecret, stripeAccount, publishableKey }. RLS decides whether
 * the caller may see the invoice.
 */
export async function POST(req: Request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Please sign in" }, { status: 401 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const inv = await loadPayableInvoice(parsed.data.invoiceId);
  if (!inv.ok) return NextResponse.json({ error: inv.error }, { status: 400 });

  try {
    const profile = await getOrgPaymentProfile(inv.orgId);
    if (!profile.stripeReady) return NextResponse.json({ error: "Online payments aren't set up for this club yet" }, { status: 409 });
    const res = await createInvoicePaymentIntent({
      profile,
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      currency: inv.currency,
      amount: inv.balance,
      customerEmail: me.email,
    });
    return NextResponse.json({ ...res, publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null });
  } catch (err) {
    console.error("[stripe] payment intent failed:", err);
    return NextResponse.json({ error: "Could not start payment" }, { status: 502 });
  }
}
