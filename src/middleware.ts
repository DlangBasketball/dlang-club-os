import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { applyTenantHeaders } from "@/lib/tenant/middleware";
import { TENANT_DOMAIN_HEADER, TENANT_SLUG_HEADER } from "@/lib/tenant/host";
import { embedCspHeader, isEmbedPath } from "@/lib/website/embed-csp";
import { isReservedPath } from "@/lib/site/paths";

/** Request header carrying a club-site path to the root layout (<html lang dir>). */
const SITE_PATH_HEADER = "x-site-path";

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
  // Operations reminders: overdue equipment, sponsor renewals (cron bearer secret).
  "/api/operations/cron",
  // Daily club billing: recurring invoices, reminders, autopay (cron bearer secret).
  "/api/billing/cron",
  // Read-only calendar subscription (ICS); the URL token is the credential.
  "/api/calendar/feed",
  // Club shop: storefront, guest checkout and the guest order link.
  "/shop",
  // Club admin job: memberships, waiting-list offers, certificate reminders (cron bearer secret).
  "/api/club-admin/cron",
  // Waiting-list offer link (accept / decline); the URL token is the credential.
  "/waitlist",
  // Scout profile shared by a guardian (hashed link token; off by default).
  "/scout",
  // Team attendance: no-show alerts, roster ends, review flags (cron bearer secret).
  "/api/attendance/cron",
  // Resend delivery events (bounces of alert e-mails); Svix-signed with RESEND_WEBHOOK_SECRET.
  "/api/email/webhook",
  // Family billing split run (cron bearer secret).
  "/api/family/cron",
  // Website connection: public read API (CORS per club), chrome-less embeds
  // for the club's own website (CSP frame-ancestors per club), the embed
  // helper script, and the webhook retry job (cron bearer secret).
  "/api/public",
  "/embed",
  "/embed.js",
  "/api/website/cron",
  // Club website: calendar subscription of the site's calendar block,
  // sitemap and robots per host.
  "/api/site/calendar",
  "/sitemap.xml",
  "/robots.txt",
];

function isPublic(pathname: string) {
  if (pathname === "/") return true; // root resolves role-home server-side
  // Club website pages (/about-us, /fr/camps, /news/<slug>): every path the
  // app itself does not serve. Reserved app paths keep their auth gate; the
  // site catch-all 404s when the host's club has no enabled site.
  if (!isReservedPath(pathname)) return true;
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function middleware(request: NextRequest) {
  // 0) Tenant: forward the host-derived tenant hint (strips spoofed headers).
  //    Must run before updateSession(), which snapshots request headers.
  applyTenantHeaders(request);
  // Site path hint for the root layout (never trusted from the client).
  request.headers.delete(SITE_PATH_HEADER);
  if (!isReservedPath(request.nextUrl.pathname)) request.headers.set(SITE_PATH_HEADER, request.nextUrl.pathname);

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

  // 4) Embeds: frameable only by the club's allowed website origins. Every
  //    other page keeps X-Frame-Options: SAMEORIGIN (vercel.json).
  if (isEmbedPath(pathname)) {
    const club = request.nextUrl.searchParams.get("club")?.trim().toLowerCase() || request.headers.get(TENANT_SLUG_HEADER) || process.env.DEFAULT_ORG_SLUG || null;
    const csp = await embedCspHeader({ slug: club, host: request.headers.get(TENANT_DOMAIN_HEADER) });
    response.headers.set("Content-Security-Policy", csp);
    response.headers.delete("X-Frame-Options");
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
