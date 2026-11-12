import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPlatformAdmin } from "@/lib/platform/auth";
import { checkDomainTxt } from "@/lib/platform/domains";
import { asPlatform } from "@/lib/platform/types";
import { sameOrigin } from "@/lib/platform/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/platform/domains/verify  { id }
 * Platform admins only. Resolves the TXT record for a tenant domain and
 * records the outcome. Writes go through the operator's own session, so the
 * tenant_domains RLS policy (is_platform_admin) is enforced as well.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
  const admin = await getPlatformAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const db = asPlatform(await createClient());
  const { data: row } = await db.from("tenant_domains").select("*").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await checkDomainTxt(row.domain, row.verification_token);
  const now = new Date().toISOString();
  const { error } = await db
    .from("tenant_domains")
    .update({
      status: result.ok ? "verified" : row.status === "verified" ? "verified" : "failed",
      verified_at: result.ok ? (row.verified_at ?? now) : row.verified_at,
      last_checked_at: now,
      last_error: result.ok ? null : (result.error ?? "Verification failed"),
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: "Update failed" }, { status: 500 });

  return NextResponse.json({ ok: result.ok, error: result.error ?? null });
}
