import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { asPlatform } from "@/lib/platform/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * GET /api/platform/cron/usage — daily usage snapshot for every tenant.
 * Call from a scheduler (e.g. Vercel Cron) with `Authorization: Bearer $CRON_SECRET`.
 * Runs as the service role; capture_all_usage_snapshots() permits callers
 * with no user session (service role) or platform admins only.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await asPlatform(createAdminClient()).rpc("capture_all_usage_snapshots");
  if (error) {
    console.error("[platform] usage capture failed:", error.message);
    return NextResponse.json({ error: "Capture failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, tenants: data });
}
