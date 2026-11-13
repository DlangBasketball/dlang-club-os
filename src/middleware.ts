import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { applyTenantHeaders } from "@/lib/tenant/middleware";

/** Paths reachable without a session. */
const PUBLIC_PREFIXES = [
  "/login",
  "/auth",
  "/register",
  // Public training booking page per club (guest checkout for non-members).
  "/book",
  // Public legal pages (privacy, terms, imprint, cookies) per tenant.
  "/legal",
  // Installable club app (PWA): public club hub, personal-training booking,
  // manifest, generated icons, service worker and its offline page.
  "/club",
  "/book",
  "/manifest.webmanifest",
  "/pwa",
  "/sw.js",
  "/offline",
  // SaaS layer: club self-signup + machine-to-machine endpoints that verify
  // their own credentials (Stripe signature / cron bearer secret).
  "/signup",
  "/api/billing/webhook",
  "/api/platform/cron",
  // Scheduled alerts dispatch (cron bearer secret).
  "/api/messaging/cron",
  // Read-only calendar subscription (ICS); the URL token is the credential.
  "/api/calendar/feed",
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
