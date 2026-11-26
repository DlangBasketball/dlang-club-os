import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

/**
 * Typed view of the club approval tables and RPCs (migration
 * 20250420105800_club_approval_status.sql). Kept local like
 * src/lib/camps/db.ts so the generated types need no hand edit; `npm run
 * types` merges them later.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type ClubRequestStatus = "pending" | "info_requested" | "approved" | "declined" | "withdrawn";
export type ClubRequestKind = "membership" | "program_registration";

export type ClubApprovalRequestRow = {
  id: string; org_id: string; subject_kind: ClubRequestKind; membership_type_id: string | null; program_id: string | null;
  family_id: string; athlete_id: string | null; requested_by: string | null; assigned_coach_ids: string[];
  status: ClubRequestStatus; request_id: string; decided_by: string | null; decided_at: string | null;
  decision_request_id: string | null; membership_id: string | null; registration_id: string | null;
  created_at: string; updated_at: string;
};
export type ClubApprovalMessageRow = {
  id: string; org_id: string; approval_id: string; author_id: string | null; author_side: "family" | "club";
  kind: "note" | "info_request" | "reply" | "approved" | "declined" | "withdrawn"; body: string | null;
  client_request_id: string | null; created_at: string; updated_at: string;
};

type ApprovalTables = {
  club_approval_requests: T<ClubApprovalRequestRow>;
  club_approval_messages: T<ClubApprovalMessageRow>;
};

type ApprovalFunctions = {
  club_request_submit: { Args: { p_payload: Json; p_request_id: string }; Returns: Json };
  club_request_decide: { Args: { p_id: string; p_decision: string; p_message?: string | null; p_request_id?: string | null }; Returns: Json };
  club_request_reply: { Args: { p_id: string; p_message: string; p_request_id: string }; Returns: Json };
  club_request_withdraw: { Args: { p_id: string; p_request_id: string }; Returns: Json };
  club_request_queue: { Args: { p_scope?: string }; Returns: Json };
  club_request_counts: { Args: Record<string, never>; Returns: Json };
  club_request_family_list: { Args: Record<string, never>; Returns: Json };
  session_roster_unconfirmed: { Args: { p_attendance_session: string }; Returns: { athlete_id: string; full_name: string; reason: string }[] };
};

type Pub = Database["public"];
export type ApprovalsDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Pub["Tables"] & ApprovalTables;
    Functions: Pub["Functions"] & ApprovalFunctions;
  };
};
export type ApprovalsClient = SupabaseClient<ApprovalsDatabase>;

/** RLS-scoped client (the signed-in user's session): every RPC re-checks role + org. */
export async function approvalsDb(): Promise<ApprovalsClient> {
  return (await createClient()) as unknown as ApprovalsClient;
}

/** Service-role client: notification lookups only; always filter by org. */
export function approvalsAdminDb(): ApprovalsClient {
  return createAdminClient() as unknown as ApprovalsClient;
}
