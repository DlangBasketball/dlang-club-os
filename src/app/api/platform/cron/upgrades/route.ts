import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processDueUpgradeChanges } from "@/lib/upgrades/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * GET /api/platform/cron/upgrades — daily: add-ons ending at period end are
 * removed from Stripe, expired trials are closed, scheduled downgrades apply.
 * Call with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const summary = await processDueUpgradeChanges();
  return NextResponse.json({ ok: true, ...summary });
}
