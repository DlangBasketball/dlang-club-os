import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

/**
 * Typed view of the participant profile tables and functions (migration
 * 20250420105600_participant_profiles.sql). Kept local, like
 * src/lib/camps/db.ts, so the shared generated types do not need a hand edit;
 * `npm run types` merges them later.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type ChangeRequestRow = {
  id: string; org_id: string; athlete_id: string; requested_by: string | null; changes: Json; previous: Json; impact: Json;
  status: "pending" | "approved" | "declined" | "withdrawn"; request_id: string | null; decided_by: string | null;
  decided_at: string | null; decision_note: string | null; created_at: string; updated_at: string;
};
export type LinkRequestRow = {
  id: string; org_id: string; athlete_id: string; requester_profile_id: string; relation: string; submitted: Json;
  status: "pending" | "approved" | "declined" | "withdrawn" | "expired"; request_id: string | null; decided_by: string | null;
  decided_at: string | null; decided_via: string | null; granted_permissions: Json | null; decision_note: string | null;
  expires_at: string; created_at: string; updated_at: string;
};

type ParticipantTables = {
  athlete_change_requests: T<ChangeRequestRow>;
  athlete_link_requests: T<LinkRequestRow>;
};

type ParticipantFunctions = {
  participant_create: { Args: { p_payload: Json; p_request_id: string }; Returns: Json };
  participant_self_ensure: { Args: { p_payload: Json; p_request_id: string | null }; Returns: Json };
  participant_update: { Args: { p_athlete: string; p_payload: Json; p_request_id: string | null }; Returns: Json };
  participant_update_sports: { Args: { p_athlete: string; p_payload: Json }; Returns: Json };
  participant_sports_profile: { Args: { p_athlete: string }; Returns: Json };
  participant_change_decide: { Args: { p_request: string; p_decision: string; p_note?: string | null }; Returns: Json };
  participant_change_withdraw: { Args: { p_request: string }; Returns: Json };
  participant_link_request: { Args: { p_payload: Json; p_request_id: string }; Returns: Json };
  participant_link_decide: { Args: { p_request: string; p_decision: string; p_permissions?: Json | null; p_note?: string | null }; Returns: Json };
  participant_link_withdraw: { Args: { p_request: string }; Returns: Json };
  participant_link_inbox: { Args: Record<string, never>; Returns: Json };
  participant_my_requests: { Args: Record<string, never>; Returns: Json };
  participant_review_queue: { Args: Record<string, never>; Returns: Json };
  // 20250420106200_my_athletes_sync.sql
  my_athletes: { Args: Record<string, never>; Returns: Json };
  my_athlete_resolve: { Args: { p_athlete: string }; Returns: string | null };
  athlete_data_check: { Args: Record<string, never>; Returns: Json };
  athlete_self_link_decide: { Args: { p_flag: string; p_decision: string }; Returns: Json };
  athlete_merge: { Args: { p_keep: string; p_duplicate: string; p_reason: string | null; p_request_id: string }; Returns: Json };
  athlete_duplicate_pairs: { Args: Record<string, never>; Returns: Json };
  athlete_profile_history: { Args: { p_athlete: string; p_limit?: number }; Returns: Json };
};

type Pub = Database["public"];
export type ParticipantsDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Pub["Tables"] & ParticipantTables;
    Functions: Pub["Functions"] & ParticipantFunctions;
  };
};
export type ParticipantsClient = SupabaseClient<ParticipantsDatabase>;

/** RLS-scoped client (the signed-in user's session); every function checks the caller and club again. */
export async function participantsDb(): Promise<ParticipantsClient> {
  return (await createClient()) as unknown as ParticipantsClient;
}

/** Service-role client: notifications only (recipient lookup); always filter by org. */
export function participantsAdminDb(): ParticipantsClient {
  return createAdminClient() as unknown as ParticipantsClient;
}
