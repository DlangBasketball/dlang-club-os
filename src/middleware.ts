import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { applyTenantHeaders } from "@/lib/tenant/middleware";

/** Paths reachable without a session. */
const PUBLIC_PREFIXES = [
  "/login",
  "/auth",
  "/register",
  // Public legal pages (privacy, terms, imprint, cookies) per tenant.
  "/legal",
  // SaaS layer: club self-signup + machine-to-machine endpoints that verify
  // their own credentials (Stripe signature / cron bearer secret).
  "/signup",
  "/api/billing/webhook",
  "/api/platform/cron",
];

function isPublic(pathname: string) {
  if (pathname === "/") return true; // root resolves role-home server-side
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function middleware(request: NextRequest) {
  // 0) Tenant: forward the host-derived tenant hint (strips spoofed headers).
  //    Must run before updateSession(), which snapshots request headers.
  applyTenantHeaders(request);

  // 1) Always refresh the Supabase session (rotates cookies).
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // 2) Auth gate: signed-out users can't reach protected areas.
  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // 3) Signed-in users shouldn't sit on /login.
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Per-role authorization is enforced in each segment layout via
  // requireRole(), with database RLS as the ultimate boundary.
  return response;
}

export const config = {
  // Run on everything except static assets, image files, the health probe and the Stripe webhook
  // (both are called by machines without a session; the webhook verifies its
  // own Stripe signature).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/stripe/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
