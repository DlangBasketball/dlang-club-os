import "server-only";
import { createClient } from "@/lib/supabase/server";
import { HIDDEN_ATHLETE_STATUS_FILTER } from "@/lib/people/person-delete";
import { attendanceErrorCode } from "./types";
import type { Read } from "./data";

/*
 * Parent / player portal reads. Everything runs as the signed-in user: the
 * RPCs (security definer) check guardian / player access and the tenant, and
 * only return finalized values of the caller's own child(ren). Contract:
 * docs/team-attendance.md, docs/family-attendance.md.
 */

/*
 * Booked training sessions (docs/booking-workflow.md §5) come back in the same
 * lists with team_id null, team_name = the service name and
 * training_session_id set; `booked` marks rows merged in from the booking
 * overview (src/lib/booking/portal.ts mergeAttendanceHistory).
 */
export type UpcomingSession = {
  event_id: string; team_id: string | null; team_name: string; training_session_id?: string | null; type: string; title: string | null; starts_at: string; ends_at: string;
  status: string; cancel_reason: string | null; rescheduled_from: string | null; location: string | null; can_report: boolean;
  report: null | { report_id: string; status: string; reason: string | null; reason_category: string; needs_review: boolean; created_at: string };
};
export type HistoryEntry = {
  event_id: string; team_id: string | null; team_name: string; training_session_id?: string | null; booked?: boolean; type: string; starts_at: string; status: string; is_guest: boolean;
  season_id: string | null; season_name: string | null; can_request_correction: boolean; open_request: boolean;
  alert: null | { alert_id: string; kind: string; status: string; mark_status: string; sent_at: string | null };
};
export type FamilyOverview = {
  athlete: { id: string; first_name: string; last_name: string };
  timezone: string;
  upcoming: UpcomingSession[];
  history: HistoryEntry[];
  reports: { report_id: string; event_id: string; starts_at: string; team_name: string | null; status: string; reason: string | null;
             reason_category: string; needs_review: boolean; reporter_kind: string; mine: boolean; created_at: string }[];
  correction_requests: { request_id: string; event_id: string; status: string; message: string; current_status: string;
                         requested_status: string | null; resolution_note: string | null; resolved_at: string | null; created_at: string }[];
};

export type AttendanceRecord = {
  athlete: { id: string; first_name: string; last_name: string };
  timezone: string;
  event: { id: string; team_id: string; team_name: string | null; type: string; title: string | null; starts_at: string; ends_at: string;
           status: string; cancel_reason: string | null; rescheduled_from: string | null; location: string | null; ended: boolean };
  attendance: null | { status: string; is_guest: boolean; finalized_at: string | null; corrected: boolean };
  final: boolean;
  can_request_correction: boolean;
  can_report: boolean;
  report: null | { report_id: string; status: string; reason: string | null; reason_category: string; needs_review: boolean;
                   reporter_kind: string; mine: boolean; created_at: string };
  requests: { request_id: string; status: string; message: string; current_status: string; requested_status: string | null;
              resolution_note: string | null; resolved_at: string | null; created_at: string; mine: boolean }[];
  alerts: { kind: string; status: string; mark_status: string; sent_at: string | null }[];
};

const ok = <T,>(data: T): Read<T> => ({ data, error: null });
const bad = <T,>(message: string | null | undefined): Read<T> => ({ data: null, error: attendanceErrorCode(message) ?? "UNKNOWN" });

/** History window of the portals: the last ~13 months (a season plus margin). */
export function historyFrom(today = new Date()): string {
  const d = new Date(today.getTime() - 400 * 864e5);
  return d.toISOString().slice(0, 10);
}

/** The signed-in guardian's own children in their current club (never other families). */
export async function getMyChildren(userId: string, orgId: string): Promise<{ id: string; first_name: string; last_name: string }[]> {
  const db = await createClient();
  const { data: fm } = await db.from("family_members").select("family_id").eq("profile_id", userId);
  const familyIds = Array.from(new Set((fm ?? []).map((r) => (r as { family_id: string }).family_id)));
  if (!familyIds.length) return [];
  const { data } = await db.from("athletes").select("id,first_name,last_name")
    .eq("org_id", orgId).in("family_id", familyIds).not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER).order("first_name");
  return (data ?? []) as { id: string; first_name: string; last_name: string }[];
}

export async function getFamilyOverview(athleteId: string): Promise<Read<FamilyOverview>> {
  const db = await createClient();
  const { data, error } = await db.rpc("guardian_attendance_overview", { p_athlete: athleteId, p_from: historyFrom(), p_to: null });
  return error ? bad(error.message) : ok(data as unknown as FamilyOverview);
}

export async function getPlayerFamilyOverview(): Promise<Read<FamilyOverview>> {
  const db = await createClient();
  const { data, error } = await db.rpc("player_attendance_overview", { p_from: historyFrom(), p_to: null });
  return error ? bad(error.message) : ok(data as unknown as FamilyOverview);
}

/** One session of one child for the guardian (alert link target). */
export async function getAttendanceRecord(eventId: string, athleteId: string): Promise<Read<AttendanceRecord>> {
  const db = await createClient();
  const { data, error } = await db.rpc("guardian_attendance_record", { p_event: eventId, p_athlete: athleteId });
  return error ? bad(error.message) : ok(data as unknown as AttendanceRecord);
}
