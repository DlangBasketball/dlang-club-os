import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runOperationsReminders } from "@/lib/operations/reminders";

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
 * GET /api/operations/cron — daily operations reminders for every club:
 * overdue equipment, sponsor renewals and sponsor deliverables coming due.
 * Call once a day with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sent = await runOperationsReminders();
  return NextResponse.json({ ok: true, ...sent });
}
