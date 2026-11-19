import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { deliverDue } from "@/lib/website/webhooks";

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
 * GET /api/website/cron — retry due "content.updated" webhooks to club
 * websites (backoff 1 min -> 12 h, 6 attempts). Changes are also sent right
 * after the admin's action; this run catches failures. Call with
 * `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const outcomes = await deliverDue({ limit: 200 });
  return NextResponse.json({ ok: true, attempted: outcomes.length, sent: outcomes.filter((o) => o.ok).length });
}
