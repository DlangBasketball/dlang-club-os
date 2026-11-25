import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { attendanceErrorCode, type MarkStatus } from "./types";
import type { Read } from "./data";

/*
 * Coach portal reads (migration 20250420104100_coach_attendance_ui.sql).
 * Every read runs as the signed-in user; the RPCs check tenant and access.
 */
type Fn = Database["public"]["Functions"];
export type TrainingCard = Fn["coach_training_cards"]["Returns"][number];

const ok = <T,>(data: T): Read<T> => ({ data, error: null });
const bad = <T,>(message: string | null | undefined): Read<T> => ({ data: null, error: attendanceErrorCode(message) ?? "UNKNOWN" });

/** Training cards of the signed-in coach between two instants. */
export async function getTrainingCards(range: { from: string; to: string }): Promise<Read<TrainingCard[]>> {
  const db = await createClient();
  const { data, error } = await db.rpc("coach_training_cards", { p_from: range.from, p_to: range.to });
  return error ? bad(error.message) : ok(data ?? []);
}

export type HistoryChange = {
  id: string; athlete_id: string; first_name: string; last_name: string; previous_status: MarkStatus | null; new_status: MarkStatus;
  phase: "draft" | "reopened" | "correction"; reason: string | null; changed_by_name: string | null; changed_at: string;
};
export type SheetHistory = {
  sheet: null | {
    status: string; version: number; created_at: string; opened_by_name: string | null; submitted_at: string | null;
    first_finalized_at: string | null; finalized_at: string | null; finalized_by_name: string | null; reopened_at: string | null;
    reopened_by_name: string | null; reopen_reason: string | null; finalize_count: number; correction_count: number; led_by_name: string | null;
  };
  changes: HistoryChange[];
};

/** Sheet lifecycle and every mark change (draft history + correction log). */
export async function getSheetHistory(eventId: string): Promise<Read<SheetHistory>> {
  const db = await createClient();
  const { data, error } = await db.rpc("attendance_sheet_history", { p_event: eventId });
  return error ? bad(error.message) : ok((data ?? { sheet: null, changes: [] }) as unknown as SheetHistory);
}

export type CoachOption = { id: string; name: string };

/** Active coaches of the club ("led by" picker) and the signed-in user's own coach id. */
export async function getCoachOptions(profileId: string): Promise<{ coaches: CoachOption[]; myCoachId: string | null }> {
  const db = await createClient();
  const { data } = await db.from("coaches").select("id,display_name,profile_id,is_active").order("display_name");
  const rows = data ?? [];
  const mine = rows.find((c) => c.profile_id === profileId)?.id ?? null;
  return { coaches: rows.filter((c) => c.is_active || c.id === mine).map((c) => ({ id: c.id, name: c.display_name })), myCoachId: mine };
}

/** The session's approved lead (session lead > booked-session coach > team head coach), or null. */
export async function getDefaultLeadId(eventId: string): Promise<string | null> {
  const db = await createClient();
  const { data } = await db.rpc("session_coverage", { p_events: [eventId] });
  const row = (data ?? [])[0] as { coverage?: { led_by_coach_id?: string | null } } | undefined;
  return row?.coverage?.led_by_coach_id ?? null;
}

/** The signed-in coach's approved role on one session (lead / assistant / substitute), or null. */
export async function getMySessionRole(eventId: string, profileId: string): Promise<"lead" | "assistant" | "substitute" | null> {
  const db = await createClient();
  const [{ data: me }, { data }] = await Promise.all([
    db.from("coaches").select("id").eq("profile_id", profileId).limit(1).maybeSingle(),
    db.rpc("session_coverage", { p_events: [eventId] }),
  ]);
  const cov = ((data ?? [])[0] as { coverage?: { coaches?: { coach_id: string; role: string; source: string }[] } } | undefined)?.coverage;
  const mine = cov?.coaches?.find((c) => c.coach_id === me?.id && c.source === "session");
  return mine && (mine.role === "lead" || mine.role === "assistant" || mine.role === "substitute") ? mine.role : null;
}

export type SessionAccessState = { status: "pending" | "approved" | "rejected"; decisionNote: string | null; decidedAt: string | null } | null;

/** The signed-in coach's own access request / assignment for one session. */
export async function getMySessionAccess(eventId: string): Promise<SessionAccessState> {
  const db = await createClient();
  const { data } = await db.rpc("session_access_list", { p_status: null });
  const row = (data ?? []).find((r) => r.event_id === eventId);
  if (!row) return null;
  return { status: row.status as "pending" | "approved" | "rejected", decisionNote: row.decision_note, decidedAt: row.decided_at };
}

export type EventSummary = { id: string; title: string | null; type: string; startsAt: string; endsAt: string; status: string; teamName: string | null };

/** Basic facts of a session the coach cannot run (request-access screen). Coaches can read club events. */
export async function getEventSummary(eventId: string): Promise<EventSummary | null> {
  const db = await createClient();
  const { data } = await db.from("events").select("id,title,type,starts_at,ends_at,status,teams(name)").eq("id", eventId).maybeSingle();
  if (!data) return null;
  const row = data as unknown as { id: string; title: string | null; type: string; starts_at: string; ends_at: string; status: string; teams: { name: string } | null };
  return { id: row.id, title: row.title, type: String(row.type), startsAt: row.starts_at, endsAt: row.ends_at, status: String(row.status), teamName: row.teams?.name ?? null };
}
