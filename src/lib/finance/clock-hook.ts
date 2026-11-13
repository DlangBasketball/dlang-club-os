import "server-only";
import { staffDb } from "@/lib/staff/db";
import { logError } from "@/lib/log";

/**
 * CLOCK-IN HOOK for coach payouts (payroll-lite).
 *
 * Coach payouts are computed from attendance sessions the coach led and
 * completed 1:1 training bookings (see loadCoachActivity in ./data.ts and
 * computeCoachPayout in ./math.ts). This returns, per coach id, the minutes
 * actually worked (clocked, breaks deducted) in [from, to] (YYYY-MM-DD,
 * inclusive, club time zone), from public.staff_hours().
 *
 *   - Hourly coaches with clocked minutes > 0 are paid on clocked time
 *     (basis "clock"); everybody else on scheduled session/booking time.
 *   - Per-session coaches are unaffected (minutes are shown for reference).
 *   - Read with the caller's RLS client and the org id from the session;
 *     staff_hours() re-checks that the caller is finance/admin of orgId.
 *   - Only closed shifts count; running or missed clock-outs are excluded
 *     until an admin corrects them (see docs/product/staff-time.md).
 */
export type ClockMinutes = Map<string, number>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function clockMinutesForPayouts(orgId: string, from: string, to: string): Promise<ClockMinutes> {
  const out: ClockMinutes = new Map();
  if (!orgId || !DAY.test(from) || !DAY.test(to) || to < from) return out;
  try {
    const db = await staffDb();
    const { data, error } = await db.rpc("staff_hours", { p_org: orgId, p_from: from, p_to: to });
    if (error) {
      logError("finance.clockMinutesForPayouts", error);
      return out;
    }
    for (const row of data ?? []) {
      if (!row.coach_id || !(row.worked_minutes > 0)) continue;
      out.set(row.coach_id, (out.get(row.coach_id) ?? 0) + row.worked_minutes);
    }
  } catch (e) {
    logError("finance.clockMinutesForPayouts", e);
  }
  return out;
}
