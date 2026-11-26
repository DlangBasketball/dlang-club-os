import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runClubAdminCron } from "@/lib/club-admin/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * GET /api/club-admin/cron — membership expiry, waiting-list offers (expire
 * overdue offers, offer freed spots) and certificate expiry reminders for
 * every club. Call with `Authorization: Bearer $CRON_SECRET` (vercel.json:
 * hourly, so an expired offer passes on within the hour). Service role;
 * idempotent.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const summary = await runClubAdminCron();
  return NextResponse.json({ ok: true, ...summary });
}
