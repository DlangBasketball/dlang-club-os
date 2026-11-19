import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runBillingCron } from "@/lib/plans/cron";
import { runAccountingCron } from "@/lib/accounting/cron";

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
 * and card-expiry notices; then accounting: family-support credit notes and
 * the dunning run (reminders 1-3, fees, collection flag). Called by Vercel Cron (vercel.json) with
 * `Authorization: Bearer $CRON_SECRET`. Runs as the service role; every step
 * is idempotent (unique period rows, claimed charges, reminder timestamps),
 * so a repeated or overlapping run never double-bills or double-charges.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const summary = await runBillingCron();
  // After billing, so autopay charges of today are already attempted before dunning looks at them.
  const accounting = await runAccountingCron();
  return NextResponse.json({ ok: true, ...summary, accounting });
}
