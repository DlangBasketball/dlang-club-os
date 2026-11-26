import { NextResponse, type NextRequest } from "next/server";
import { DEMO_ROLE_HOME, demoEnabled, isDemoRole, sameOrigin } from "@/lib/demo/config";
import { ensureDemoSession, signInAsDemoRole } from "@/lib/demo/sandbox";

/**
 * POST /demo/enter (form field `role`): creates the prospect's sandbox on
 * first use, signs the browser in as that role and opens its first screen.
 */
export async function POST(req: NextRequest) {
  if (!demoEnabled()) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(req.headers.get("origin"), req.headers.get("host"))) return new NextResponse(null, { status: 403 });

  const back = (q: string) => NextResponse.redirect(new URL(`/demo?${q}`, req.url), 303);
  const form = await req.formData().catch(() => null);
  const role = form?.get("role");
  if (!isDemoRole(role)) return back("error=role");

  const session = await ensureDemoSession();
  if (typeof session === "string") return back(`error=${session}`);
  if (!(await signInAsDemoRole(session, role))) return back("error=failed");
  return NextResponse.redirect(new URL(DEMO_ROLE_HOME[role], req.url), 303);
}
