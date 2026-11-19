import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";
import type { SportsDatabase, VenueRow } from "@/lib/sportsops/db";

/**
 * Typed view of the staff-time, lesson-plan and club-calendar tables and RPCs
 * (migration 20250420100500_staff_clockin_calendar.sql). Kept local like
 * src/lib/sportsops/db.ts; merges into src/types/database.ts once the types
 * are regenerated with `npm run types`.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type EntryStatus = "open" | "closed" | "missed";
export type GeoStatusDb = "not_checked" | "ok" | "too_far" | "unavailable";
export type ClubEventType = "international" | "tournament" | "meeting" | "social" | "holiday" | "trip" | "other";
export type ClubEventAudience = "everyone" | "staff" | "parents";

export type ShiftTemplateRow = {
  id: string; org_id: string; profile_id: string; venue_id: string | null; weekday: number; start_time: string; end_time: string;
  valid_from: string | null; valid_until: string | null; label: string | null; is_active: boolean; created_by: string | null;
  created_at: string; updated_at: string;
};
export type TimeEntryRow = {
  id: string; org_id: string; profile_id: string; coach_id: string | null; venue_id: string | null; program_session_id: string | null;
  event_id: string | null; clock_in_at: string; clock_out_at: string | null; status: EntryStatus; geo_status: GeoStatusDb;
  source: "app" | "admin"; note: string | null; corrected_by: string | null; corrected_at: string | null; correction_reason: string | null;
  created_at: string; updated_at: string;
};
export type TimeBreakRow = { id: string; org_id: string; time_entry_id: string; started_at: string; ended_at: string | null; created_at: string; updated_at: string };
export type TimesheetRow = {
  id: string; org_id: string; profile_id: string; period_start: string; period_end: string; status: "approved" | "reopened";
  planned_minutes: number; worked_minutes: number; note: string | null; approved_by: string | null; approved_at: string | null;
  created_at: string; updated_at: string;
};
export type LessonPlanRow = {
  id: string; org_id: string; program_session_id: string | null; event_id: string | null; coach_id: string | null; author_id: string | null;
  title: string | null; objectives: string | null; drills: Json; notes: string | null; attachment_path: string | null; attachment_name: string | null;
  shared_with_parents: boolean; shared_at: string | null; created_at: string; updated_at: string;
};
export type ClubEventRow = {
  id: string; org_id: string; title: string; type: ClubEventType; starts_at: string; ends_at: string; all_day: boolean;
  venue_id: string | null; location: string | null; audience: ClubEventAudience; description: string | null; url: string | null;
  team_id: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type FeedTokenRow = {
  id: string; org_id: string; profile_id: string; token_hash: string; last_used_at: string | null; revoked_at: string | null;
  created_at: string; updated_at: string;
};
export type CampEditionLite = {
  id: string; org_id: string; program_id: string; name: string | null; starts_on: string; ends_on: string; venue_id: string | null;
  location_name: string | null; city: string | null; status: string; archived_at: string | null;
};
export type VenueGeoRow = { latitude: number | null; longitude: number | null; geofence_radius_m: number };

export type StaffHoursRow = {
  profile_id: string; coach_id: string | null; full_name: string | null; planned_minutes: number; worked_minutes: number;
  break_minutes: number; entry_count: number; open_entries: number; missed_entries: number; approved: boolean;
};

type StaffTables = {
  staff_shift_templates: T<ShiftTemplateRow>;
  staff_time_entries: T<TimeEntryRow>;
  staff_time_breaks: T<TimeBreakRow>;
  staff_timesheets: T<TimesheetRow>;
  lesson_plans: T<LessonPlanRow>;
  club_events: T<ClubEventRow>;
  calendar_feed_tokens: T<FeedTokenRow>;
  camp_editions: T<CampEditionLite>;
  venues: T<VenueRow & VenueGeoRow>;
};

type StaffFunctions = {
  staff_clock_in: {
    Args: { p_venue?: string | null; p_geo?: GeoStatusDb; p_note?: string | null; p_program_session?: string | null; p_event?: string | null };
    Returns: string;
  };
  staff_clock_out: { Args: { p_note?: string | null }; Returns: Json };
  staff_break: { Args: { p_start: boolean }; Returns: string };
  staff_save_time_entry: {
    Args: { p_entry: string | null; p_profile: string | null; p_clock_in: string; p_clock_out: string; p_reason: string; p_venue?: string | null; p_breaks?: Json | null };
    Returns: string;
  };
  staff_delete_time_entry: { Args: { p_entry: string; p_reason: string }; Returns: undefined };
  staff_set_timesheet: { Args: { p_profile: string; p_from: string; p_to: string; p_approve: boolean; p_note?: string | null }; Returns: string };
  staff_flag_missed_clockouts: { Args: Record<string, never>; Returns: number };
  can_plan_lesson: { Args: { p_session: string | null; p_event: string | null }; Returns: boolean };
  staff_hours: { Args: { p_org: string; p_from: string; p_to: string }; Returns: StaffHoursRow[] };
};

type Pub = SportsDatabase["public"];
export type StaffDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Pub["Tables"] & StaffTables;
    Functions: Pub["Functions"] & StaffFunctions;
  };
};
export type StaffClient = SupabaseClient<StaffDatabase>;

/** RLS-scoped client (user session). */
export async function staffDb(): Promise<StaffClient> {
  return (await createClient()) as unknown as StaffClient;
}

/** Service-role client: server-only paths (calendar feed). Always filter by org_id. */
export function staffAdminDb(): StaffClient {
  return createAdminClient() as unknown as StaffClient;
}

// Keep the generated Database type referenced (regeneration replaces this file's types).
export type _Generated = Database;
