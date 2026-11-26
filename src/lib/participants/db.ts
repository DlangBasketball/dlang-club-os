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

/** Per-child link (20250420106300_flexible_links_finance_scope.sql). */
export type AthleteGuardianLinkRow = {
  id: string; org_id: string; athlete_id: string; profile_id: string; relation: string; can_register: boolean; can_pay: boolean;
  can_see_medical: boolean; receives_emails: boolean; can_edit_profile: boolean; can_consent: boolean; status: "active" | "revoked";
  granted_by: string | null; granted_at: string; revoked_by: string | null; revoked_at: string | null; revoke_reason: string | null;
  link_request_id: string | null; created_at: string; updated_at: string;
};

type ParticipantTables = {
  athlete_change_requests: T<ChangeRequestRow>;
  athlete_link_requests: T<LinkRequestRow>;
  athlete_guardian_links: T<AthleteGuardianLinkRow>;
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
  // 20250420106300_flexible_links_finance_scope.sql
  athlete_links_for: { Args: { p_athlete: string }; Returns: Json };
  athlete_links_mine_to_manage: { Args: Record<string, never>; Returns: Json };
  athlete_link_update: { Args: { p_link: string; p_permissions: Json }; Returns: Json };
  athlete_link_revoke: { Args: { p_link: string; p_reason?: string | null }; Returns: Json };
  // 20250420106500_relative_invites_carer_consent.sql
  athlete_link_invite_create: { Args: { p_athlete: string; p_payload: Json; p_token_hash: string; p_request_id: string }; Returns: Json };
  athlete_link_invite_revoke: { Args: { p_invitation: string }; Returns: Json };
  athlete_link_invites_for: { Args: { p_athlete: string }; Returns: Json };
  athlete_link_invites_mine_to_manage: { Args: Record<string, never>; Returns: Json };
  athlete_link_invite_view: { Args: { p_token_hash: string }; Returns: Json };
  athlete_link_invite_accept: { Args: { p_token_hash: string }; Returns: Json };
  carer_consent_setting: { Args: Record<string, never>; Returns: boolean };
  linker_consent_status: { Args: { p_athlete: string }; Returns: Json };
  linker_consent_pending: { Args: Record<string, never>; Returns: Json };
  linker_consent_accept: { Args: { p_request: string; p_payload: Json }; Returns: Json };
  linker_consent_ask_family: { Args: { p_request: string; p_token_hash: string }; Returns: Json };
  athlete_linked_recipients_for: { Args: { p_org: string; p_athletes: string[] }; Returns: Json };
  switch_current_org: { Args: { p_org: string }; Returns: Json };
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
