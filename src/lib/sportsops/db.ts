import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

/**
 * Typed view of the teams / seasons / schedule tables
 * (migration 20250420092000_teams_seasons_schedule.sql).
 *
 * Kept local to this module so the shared src/types/database.ts does not need
 * to change; once `npm run types` regenerates the full schema these merge
 * into the generated types and this file can simply re-export them.
 */
export type EventType = "training" | "game" | "tournament" | "meeting" | "other";
export type EventStatus = "scheduled" | "postponed" | "cancelled" | "completed";
export type RsvpStatus = "going" | "maybe" | "not_going";
export type MembershipStatus = "active" | "trial" | "injured" | "inactive";
export type HomeAway = "home" | "away" | "neutral";

type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type SeasonRow = { id: string; org_id: string; name: string; starts_on: string; ends_on: string; is_current: boolean; created_at: string; updated_at: string };
export type VenueRow = { id: string; org_id: string; name: string; address: string | null; city: string | null; postal_code: string | null; country: string | null; capacity: number | null; notes: string | null; is_active: boolean; created_at: string; updated_at: string };
export type VenueSpaceRow = { id: string; org_id: string; venue_id: string; name: string; is_active: boolean; created_at: string };
export type TeamRow = { id: string; org_id: string; season_id: string | null; program_id: string | null; name: string; sport: string | null; age_group: string | null; gender: string | null; level: string | null; color: string | null; notes: string | null; is_active: boolean; created_at: string; updated_at: string };
export type TeamCoachRow = { team_id: string; coach_id: string; org_id: string; role: "head" | "assistant" | "manager" | "trainer"; created_at: string };
export type TeamMembershipRow = { id: string; org_id: string; team_id: string; athlete_id: string; jersey_number: number | null; position: string | null; status: MembershipStatus; joined_on: string; left_on: string | null; created_at: string; updated_at: string };
export type EventRow = { id: string; org_id: string; team_id: string | null; season_id: string | null; program_session_id: string | null; type: EventType; title: string | null; venue_id: string | null; venue_space_id: string | null; location_text: string | null; starts_at: string; ends_at: string; opponent: string | null; home_away: HomeAway | null; status: EventStatus; notes: string | null; created_by: string | null; created_at: string; updated_at: string };
export type GameResultRow = { event_id: string; org_id: string; score_for: number; score_against: number; outcome: "win" | "loss" | "draw"; periods: Json | null; notes: string | null; recorded_by: string | null; recorded_at: string; updated_at: string };
export type EventAthleteStatsRow = { event_id: string; athlete_id: string; org_id: string; stats: Json; updated_at: string };
export type EventRsvpRow = { event_id: string; athlete_id: string; org_id: string; status: RsvpStatus; note: string | null; responded_by: string | null; responded_at: string };

export type ConflictRow = {
  event_id: string; team_id: string | null; team_name: string | null; title: string | null; type: EventType;
  starts_at: string; ends_at: string; venue_space_id: string | null; space_name: string | null; same_space: boolean;
};

type SportsTables = {
  seasons: T<SeasonRow>;
  venues: T<VenueRow>;
  venue_spaces: T<VenueSpaceRow>;
  teams: T<TeamRow>;
  team_coaches: T<TeamCoachRow>;
  team_memberships: T<TeamMembershipRow>;
  events: T<EventRow>;
  game_results: T<GameResultRow>;
  event_athlete_stats: T<EventAthleteStatsRow>;
  event_rsvps: T<EventRsvpRow>;
};

type SportsFunctions = {
  event_conflicts: {
    Args: { p_venue: string; p_space?: string | null; p_start: string; p_end: string; p_exclude_event?: string | null };
    Returns: ConflictRow[];
  };
  set_event_rsvp: { Args: { p_event: string; p_athlete: string; p_status: RsvpStatus; p_note?: string | null }; Returns: Json };
  record_game_result: { Args: { p_event: string; p_score_for: number; p_score_against: number; p_notes?: string | null }; Returns: Json };
};

type Pub = Database["public"];
export type SportsDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Pub["Tables"] & SportsTables;
    Functions: Pub["Functions"] & SportsFunctions;
  };
};

export type SportsClient = SupabaseClient<SportsDatabase>;

/** RLS-scoped client (user session) with the sports tables typed. */
export async function sportsDb(): Promise<SportsClient> {
  return (await createClient()) as unknown as SportsClient;
}
