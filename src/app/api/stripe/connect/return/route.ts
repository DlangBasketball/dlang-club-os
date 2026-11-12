import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getStripe } from "@/lib/stripe";
import { getOrgPaymentProfile } from "@/lib/payments/settings";
import { persistAccount } from "@/lib/stripe-connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/stripe/connect/return — Stripe onboarding `return_url`.
 * Re-reads the connected account and stores its capability flags (the
 * account.updated webhook does the same asynchronously).
 */
export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.redirect(new URL("/login", req.url));
  if (!me.orgId || !me.roles.includes("admin")) return NextResponse.redirect(new URL("/", req.url));

  const stripe = getStripe();
  const dest = new URL("/admin/settings/payments", req.url);
  try {
    const profile = await getOrgPaymentProfile(me.orgId);
    if (stripe && profile.stripeAccountId) {
      const account = await stripe.accounts.retrieve(profile.stripeAccountId);
      await persistAccount(me.orgId, account);
      dest.searchParams.set("connect", account.charges_enabled ? "ready" : "pending");
    } else {
      dest.searchParams.set("connect", "missing");
    }
  } catch (err) {
    console.error("[stripe-connect] return sync failed:", err);
    dest.searchParams.set("connect", "error");
  }
  return NextResponse.redirect(dest, { status: 303 });
}
