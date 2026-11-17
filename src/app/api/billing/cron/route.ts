import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runBillingCron } from "@/lib/plans/cron";

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
 * GET /api/billing/cron — daily club billing for every club: recurring period
 * invoices, instalment reminders, autopay card charges with retries, overdue
 * and card-expiry notices. Called by Vercel Cron (vercel.json) with
 * `Authorization: Bearer $CRON_SECRET`. Runs as the service role; every step
 * is idempotent (unique period rows, claimed charges, reminder timestamps),
 * so a repeated or overlapping run never double-bills or double-charges.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const summary = await runBillingCron();
  return NextResponse.json({ ok: true, ...summary });
}
