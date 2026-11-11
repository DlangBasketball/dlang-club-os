import "server-only";
import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";

/** Shared helpers for /api/billing/* routes (form POST or JSON). */

export function siteUrlFrom(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return new URL(req.url).origin;
}

/** Rejects cross-origin POSTs (defence in depth on top of SameSite cookies). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin form posts from older browsers omit it
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function readBody(req: Request): Promise<{ data: Record<string, string>; isForm: boolean }> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(json)) if (typeof v === "string") data[k] = v;
    return { data, isForm: false };
  }
  const form = await req.formData().catch(() => null);
  const data: Record<string, string> = {};
  form?.forEach((v, k) => {
    if (typeof v === "string") data[k] = v;
  });
  return { data, isForm: true };
}

/** The signed-in org admin, or null. Billing is admin-only (not finance). */
export async function requireOrgAdmin(): Promise<(SessionUser & { orgId: string }) | null> {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return null;
  return me as SessionUser & { orgId: string };
}

export function respond(
  req: Request,
  isForm: boolean,
  result: { ok: true; url: string } | { ok: false; status: number; error: string },
) {
  if (isForm) {
    if (result.ok) return NextResponse.redirect(result.url, 303);
    const back = new URL("/signup/plan", siteUrlFrom(req));
    back.searchParams.set("error", result.error);
    return NextResponse.redirect(back, 303);
  }
  return result.ok
    ? NextResponse.json({ url: result.url })
    : NextResponse.json({ error: result.error }, { status: result.status });
}
