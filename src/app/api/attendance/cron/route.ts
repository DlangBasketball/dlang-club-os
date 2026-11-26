import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAttendanceAlerts } from "@/lib/attendance/alerts";
import { logError } from "@/lib/log";

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
 * GET /api/attendance/cron — team attendance housekeeping for every club,
 * with `Authorization: Bearer $CRON_SECRET` (service role):
 *   1. memberships whose future-dated end has passed become inactive
 *   2. no-show alerts of sessions finalized before they ended are created,
 *      then pending / failed alerts are delivered (retry with back-off)
 *   3. data review flags (unfinished sessions after the go-live, teams
 *      without coach, players without guardian …) are refreshed
 * Idempotent: overlapping or repeated runs never send an alert twice.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data: ended, error: dueErr } = await admin.rpc("team_memberships_apply_due");
  if (dueErr) logError("attendance.cron.memberships", dueErr);
  const alerts = await runAttendanceAlerts({ limit: 500 });
  let flags = 0;
  const { data: orgs } = await admin.from("organizations").select("id");
  for (const o of orgs ?? []) {
    const { data, error } = await admin.rpc("attendance_review_flags", { p_org: o.id });
    if (error) logError("attendance.cron.flags", error);
    else flags += Number(data ?? 0);
    // Attendance consistency (led_by backfill, follow-ups, MULTIPLE_LEADS …); idempotent.
    const rec = await admin.rpc("attendance_consistency_reconcile", { p_org: o.id });
    if (rec.error) logError("attendance.cron.reconcile", rec.error);
  }
  return NextResponse.json({ ok: true, membershipsEnded: Number(ended ?? 0), alerts, flags });
}
