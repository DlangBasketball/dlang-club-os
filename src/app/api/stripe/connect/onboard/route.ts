import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getOrgPaymentProfile } from "@/lib/payments/settings";
import { createOnboardingLink, ensureConnectAccount } from "@/lib/stripe-connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/stripe/connect/onboard — club admin only.
 * Creates the club's connected Stripe account on first use, then redirects to
 * Stripe-hosted onboarding. Also used as the account link `refresh_url`.
 */
export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.redirect(new URL("/login", req.url));
  if (!me.orgId || !me.roles.includes("admin")) {
    return NextResponse.json({ error: "Only club admins can connect a payout account" }, { status: 403 });
  }
  try {
    const profile = await getOrgPaymentProfile(me.orgId);
    const accountId = await ensureConnectAccount(profile, me.email);
    const url = await createOnboardingLink(accountId, me.orgId);
    return NextResponse.redirect(url, { status: 303 });
  } catch (err) {
    console.error("[stripe-connect] onboarding failed:", err);
    return NextResponse.redirect(new URL("/admin/settings/payments?connect=error", req.url), { status: 303 });
  }
}
