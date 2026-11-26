import { NextResponse, type NextRequest } from "next/server";
import { demoEnabled, sameOrigin } from "@/lib/demo/config";
import { currentDemoSession, resetDemoSession } from "@/lib/demo/sandbox";

/**
 * POST /demo/reset: restores the starting scenario of this browser's sandbox
 * only (other prospects are untouched) and signs out.
 */
export async function POST(req: NextRequest) {
  if (!demoEnabled()) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(req.headers.get("origin"), req.headers.get("host"))) return new NextResponse(null, { status: 403 });

  const session = await currentDemoSession();
  if (!session) return NextResponse.redirect(new URL("/demo?error=expired", req.url), 303);
  const ok = await resetDemoSession(session);
  return NextResponse.redirect(new URL(ok ? "/demo?reset=1" : "/demo?error=failed", req.url), 303);
}
