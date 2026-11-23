"use server";

import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { attendanceErrorCode, uuidSchema } from "@/lib/attendance/types";

/*
 * Coach portal helper actions (migration 20250420104100). The sheet writes
 * themselves are the shared actions in ./team-attendance.ts.
 */
export type GuestCandidate = { athleteId: string; firstName: string; lastName: string; teams: string[] };

/** Club players matching `query` that can be added as a guest to the session. */
export async function searchGuestCandidates(input: { eventId: string; query: string }):
  Promise<{ ok: true; data: GuestCandidate[] } | { ok: false; error: string }> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId || !me.roles.some((r) => r === "coach" || r === "admin")) return { ok: false, error: t("teamAttendance.errors.NOT_AUTHORIZED") };
  const p = z.object({ eventId: uuidSchema, query: z.string().trim().max(80) }).safeParse(input);
  if (!p.success) return { ok: false, error: t("teamAttendance.errors.invalid") };
  if (p.data.query.length < 2) return { ok: true, data: [] };
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_guest_search", { p_event: p.data.eventId, p_query: p.data.query, p_limit: 20 });
  if (error) {
    const code = attendanceErrorCode(error.message);
    return { ok: false, error: code ? t.dynamic(`teamAttendance.errors.${code}`, undefined, t("teamAttendance.errors.generic")) : t("teamAttendance.errors.generic") };
  }
  return { ok: true, data: (data ?? []).map((r) => ({ athleteId: r.athlete_id, firstName: r.first_name, lastName: r.last_name, teams: r.team_names ?? [] })) };
}
