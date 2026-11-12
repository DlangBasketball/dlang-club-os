import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/** Paths reachable without a session. */
const PUBLIC_PREFIXES = ["/login", "/auth", "/register", "/legal"];

function isPublic(pathname: string) {
  if (pathname === "/") return true; // root resolves role-home server-side
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function middleware(request: NextRequest) {
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
  // Run on everything except static assets & image files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
