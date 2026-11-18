import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { splitAllOpenFamilyInvoices } from "@/lib/family/split-runner";

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
 * GET /api/family/cron — split newly issued, unpaid invoices of families
 * that pay with a billing split (one invoice per paying guardian, each with
 * its own QR reference and payment link). Call with
 * `Authorization: Bearer $CRON_SECRET` (e.g. every 15 minutes, after billing).
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await splitAllOpenFamilyInvoices();
  return NextResponse.json({ ok: true, ...res });
}
