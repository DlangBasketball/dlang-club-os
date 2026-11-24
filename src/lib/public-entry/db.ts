import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

/**
 * Typed view of the public entry + guardian consent tables and functions
 * (migration 20250420105900_public_entry_guardian_consent.sql). Kept local,
 * like src/lib/participants/db.ts, so the generated types need no hand edit.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type ConsentRequestRow = {
  id: string; org_id: string; athlete_id: string; booker_profile_id: string; guardian_name: string; guardian_email: string;
  guardian_phone: string | null; relation: string; existing_child: boolean; token_hash: string | null; expires_at: string | null;
  status: "pending" | "accepted" | "declined" | "expired" | "revoked"; registration_ids: string[]; booking_ids: string[];
  outcome_notified_at: string | null; created_at: string; updated_at: string;
};
export type ParticipantBookerRow = {
  id: string; org_id: string; athlete_id: string; profile_id: string; scope: "status_only"; relation: string;
  display_name: string; display_dob: string | null; created_at: string; updated_at: string;
};

type Tables = {
  guardian_consent_requests: T<ConsentRequestRow>;
  participant_bookers: T<ParticipantBookerRow>;
};

type Functions = {
  family_bootstrap: { Args: { p_org_slug: string }; Returns: Json };
  public_entry_resolve_children: { Args: { p_payload: Json }; Returns: Json };
  third_party_participant_create: { Args: { p_payload: Json; p_request_id: string }; Returns: Json };
  booker_participants: { Args: Record<string, never>; Returns: Json };
  third_party_camp_hold: { Args: { p_payload: Json; p_request_id: string }; Returns: Json };
  third_party_training_quote: { Args: { p_payload: Json }; Returns: Json };
  third_party_training_request: { Args: { p_payload: Json; p_request_id: string }; Returns: Json };
  guardian_consent_view: { Args: { p_token_hash: string }; Returns: Json };
  guardian_consent_accept: { Args: { p_token_hash: string; p_payload: Json }; Returns: Json };
  guardian_consent_decline: { Args: { p_token_hash: string }; Returns: Json };
  guardian_consent_revoke: { Args: { p_request: string }; Returns: Json };
  guardian_consent_expire: { Args: Record<string, never>; Returns: Json };
  guardian_consent_mark_notified: { Args: { p_request: string }; Returns: undefined };
  booker_booking_status: { Args: Record<string, never>; Returns: Json };
  switch_current_org: { Args: { p_org: string }; Returns: Json };
  club_request_submit: { Args: { p_payload: Json; p_request_id: string }; Returns: Json };
};

type Pub = Database["public"];
export type EntryDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Pub["Tables"] & Tables;
    Functions: Pub["Functions"] & Functions;
  };
};
export type EntryClient = SupabaseClient<EntryDatabase>;

/** The signed-in user's session client (or anon); every function checks the caller again. */
export async function entryDb(): Promise<EntryClient> {
  return (await createClient()) as unknown as EntryClient;
}

/** Service role: server-only lookups and the scheduled expiry; always filter by org. */
export function entryAdminDb(): EntryClient {
  return createAdminClient() as unknown as EntryClient;
}
