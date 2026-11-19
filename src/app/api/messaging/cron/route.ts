import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dispatchDueAlerts } from "@/lib/messaging/notify";

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
 * GET /api/messaging/cron — send scheduled alerts whose time has come, for
 * every club. Call from a scheduler (e.g. every 5 minutes) with
 * `Authorization: Bearer $CRON_SECRET`. Runs as the service role; each alert
 * is claimed before it is sent, so overlapping runs never send twice.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sent = await dispatchDueAlerts();
  return NextResponse.json({ ok: true, alerts: sent });
}
