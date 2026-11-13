import "server-only";

/**
 * CLOCK-IN HOOK for coach payouts (payroll-lite).
 *
 * Coach payouts are computed from attendance sessions the coach led and
 * completed 1:1 training bookings (see loadCoachActivity in ./data.ts and
 * computeCoachPayout in ./math.ts). When the staff module records clock-in /
 * clock-out times, it feeds them in HERE: return, per coach id, the minutes
 * actually worked (clocked) in [from, to] (YYYY-MM-DD, inclusive, club time).
 *
 *   - Hourly coaches with clocked minutes > 0 are paid on clocked time
 *     (basis "clock"); everybody else on scheduled session/booking time.
 *   - Per-session coaches are unaffected (minutes are shown for reference).
 *   - Read with the caller's RLS client and filter on orgId explicitly;
 *     never trust an org id from the client.
 *
 * Until the staff module exists this returns an empty map, so payouts come
 * from attendance and bookings only.
 */
export type ClockMinutes = Map<string, number>;

export async function clockMinutesForPayouts(orgId: string, from: string, to: string): Promise<ClockMinutes> {
  void orgId; void from; void to;
  return new Map();
}
