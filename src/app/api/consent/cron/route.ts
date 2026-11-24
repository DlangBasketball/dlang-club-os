import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runConsentExpiry } from "@/lib/public-entry/notify";

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
 * GET /api/consent/cron — guardian consent holds: expires every pending
 * request whose 72 h hold ran out (the held camp place / training request is
 * cancelled and freed), then notifies the bookers (and the guardian e-mail of
 * an expired request) of declined / expired outcomes not yet notified.
 * Call with `Authorization: Bearer $CRON_SECRET` (e.g. every 15 minutes).
 * Reads also expire lazily (booker status, consent page), so a missed run
 * never keeps a place held.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await runConsentExpiry();
  return NextResponse.json({ ok: true, ...res });
}
