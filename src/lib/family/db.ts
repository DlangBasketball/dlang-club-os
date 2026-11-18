import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MsgDatabase } from "@/lib/messaging/db";
import type { AppRole } from "@/lib/auth/roles";

/**
 * Typed view of the family & multi-club tables and RPCs
 * (migration 20250420101400_family_multi_club.sql). Kept local like
 * src/lib/messaging/db.ts until `npm run types` regenerates the schema.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type OrgMembershipRow = {
  id: string; org_id: string; profile_id: string; roles: AppRole[]; status: "active" | "suspended";
  last_switched_at: string | null; created_at: string; updated_at: string;
};
export type FamilyMemberRow = {
  family_id: string; profile_id: string; relation: string | null; is_primary: boolean; created_at: string; updated_at: string;
  can_pay: boolean; can_see_medical: boolean; receives_emails: boolean; billing_share_pct: number | null;
};
export type ConsentEventRow = {
  id: string; org_id: string; family_id: string; athlete_id: string | null; profile_id: string | null;
  kind: ConsentKind; granted: boolean; version: string; source: string; created_at: string; updated_at: string;
};
export type ConsentKind = "media" | "marketing" | "scout_profile";
export type PushSubscriptionRow = {
  id: string; org_id: string; profile_id: string; endpoint: string; p256dh: string; auth_secret: string; user_agent: string | null;
  failure_count: number; last_success_at: string | null; created_at: string; updated_at: string;
};
export type CarpoolOfferRow = {
  id: string; org_id: string; event_id: string; family_id: string; profile_id: string; from_area: string; departs_at: string;
  seats_total: number; return_trip: boolean; note: string | null; status: "open" | "full" | "cancelled"; created_at: string; updated_at: string;
};
export type CarpoolRequestRow = {
  id: string; org_id: string; event_id: string; family_id: string; profile_id: string; from_area: string; seats_needed: number;
  return_trip: boolean; note: string | null; status: "open" | "matched" | "cancelled"; created_at: string; updated_at: string;
};
export type CarpoolMatchRow = {
  id: string; org_id: string; event_id: string; offer_id: string; request_id: string; seats: number; status: "confirmed" | "cancelled";
  conversation_id: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type SeasonReviewRow = {
  id: string; org_id: string; athlete_id: string; season_id: string | null; team_id: string | null; season_label: string;
  coach_comment: string | null; awards: string[]; shared_with_family: boolean; created_by: string | null; created_at: string; updated_at: string;
};
export type PlacementStatus = "interested" | "contacted" | "trial" | "offer" | "placed" | "declined" | "withdrawn";
export type PlacementKind = "school" | "club" | "college" | "academy" | "other";
export type PlacementRow = {
  id: string; org_id: string; athlete_id: string; target_name: string; target_kind: PlacementKind; country: string | null;
  level: string | null; status: PlacementStatus; deadline: string | null; next_step: string | null; notes: string | null;
  document_ids: string[]; created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
};
export type PlacementHistoryRow = {
  id: string; org_id: string; placement_id: string; from_status: PlacementStatus | null; to_status: PlacementStatus;
  actor_id: string | null; created_at: string; updated_at: string;
};
export type ScoutProfileRow = {
  id: string; org_id: string; athlete_id: string; fields: string[]; headline: string | null; consent_by: string | null;
  consented_at: string; consent_version: string; published_at: string; expires_at: string; revoked_at: string | null;
  revoked_by: string | null; view_count: number; last_viewed_at: string | null; created_at: string; updated_at: string;
};
export type DsarRow = {
  id: string; org_id: string; family_id: string | null; athlete_id: string | null; requester_profile_id: string | null;
  requester_name: string; requester_email: string | null; request_type: string; status: string; received_at: string;
  due_at: string | null; completed_at: string | null; notes: string | null; deletion_request_id: string | null; channel: string;
  jurisdiction: string; relationship: string; response_summary: string | null; created_at: string; updated_at: string;
};
export type DeletionRequestRow = {
  id: string; org_id: string; family_id: string; requested_by: string | null; reason: string | null; status: string;
  reviewed_by: string | null; reviewed_at: string | null; completed_at: string | null; created_at: string;
};
export type FamilyRow = {
  id: string; org_id: string; name: string; billing_split_mode: "single" | "split"; contact_email: string | null;
};

type FamilyTables = {
  org_memberships: T<OrgMembershipRow>;
  family_members: T<FamilyMemberRow>;
  family_consent_events: T<ConsentEventRow>;
  push_subscriptions: T<PushSubscriptionRow>;
  carpool_offers: T<CarpoolOfferRow>;
  carpool_requests: T<CarpoolRequestRow>;
  carpool_matches: T<CarpoolMatchRow>;
  player_season_reviews: T<SeasonReviewRow>;
  placement_targets: T<PlacementRow>;
  placement_status_history: T<PlacementHistoryRow>;
  scout_profiles: T<ScoutProfileRow>;
  dsar_requests: T<DsarRow>;
  deletion_requests: T<DeletionRequestRow>;
};

export type MyOrgRow = { org_id: string; name: string; slug: string | null; roles: AppRole[]; is_current: boolean };

type FamilyFunctions = {
  my_org_memberships: { Args: Record<string, never>; Returns: MyOrgRow[] };
  switch_current_org: { Args: { p_org: string }; Returns: { org_id: string; previous_org_id: string | null } };
  claim_my_invitations: { Args: Record<string, never>; Returns: number };
  consume_invitation: { Args: { p_inv: string; p_profile: string }; Returns: boolean };
  set_guardian_permissions: {
    Args: { p_family: string; p_profile: string; p_can_pay: boolean | null; p_can_see_medical: boolean | null; p_receives_emails: boolean | null };
    Returns: undefined;
  };
  set_family_billing_split: { Args: { p_family: string; p_mode: "single" | "split"; p_shares: Record<string, number> | null }; Returns: undefined };
  remove_family_guardian: { Args: { p_family: string; p_profile: string }; Returns: undefined };
  split_family_invoice: { Args: { p_invoice: string }; Returns: { group: string; invoices: string[] } };
  invoice_billing_recipients: { Args: { p_invoice: string }; Returns: { profile_id: string }[] };
  family_consent_state: {
    Args: { p_family: string };
    Returns: { kind: ConsentKind; athlete_id: string | null; profile_id: string | null; granted: boolean; decided_at: string }[];
  };
  carpool_board: { Args: { p_event: string }; Returns: CarpoolBoard };
  carpool_match: { Args: { p_offer: string; p_request: string }; Returns: { match_id: string; conversation_id: string; driver_id: string; passenger_id: string; event_id: string } };
  carpool_cancel_match: { Args: { p_match: string }; Returns: { driver_id: string; passenger_id: string; event_id: string } };
  carpool_can_view: { Args: { p_event: string }; Returns: boolean };
  can_manage_event: { Args: { p_event: string }; Returns: boolean };
  journey_can_write: { Args: { p_athlete: string }; Returns: boolean };
  player_journey: { Args: { p_athlete: string }; Returns: JourneyData };
  scout_profile_publish: {
    Args: { p_athlete: string; p_fields: string[]; p_days: number; p_token_hash: string; p_headline: string | null; p_consent_version: string };
    Returns: string;
  };
  scout_profile_revoke: { Args: { p_athlete: string }; Returns: undefined };
  scout_profile_view: { Args: { p_token_hash: string }; Returns: ScoutView | null };
  anonymise_family: { Args: { p_family: string }; Returns: unknown };
};

export type CarpoolBoardOffer = {
  id: string; from_area: string; departs_at: string; seats_total: number; seats_taken: number; return_trip: boolean;
  note: string | null; status: "open" | "full"; mine: boolean; name: string;
};
export type CarpoolBoardRequest = {
  id: string; from_area: string; seats_needed: number; return_trip: boolean; note: string | null; status: "open" | "matched"; mine: boolean; name: string;
};
export type CarpoolBoardMatch = { id: string; offer_id: string; request_id: string; seats: number; conversation_id: string | null; mine: boolean };
export type CarpoolBoard = { offers: CarpoolBoardOffer[]; requests: CarpoolBoardRequest[]; matches: CarpoolBoardMatch[] };

export type JourneySeason = {
  season_id: string; season: string; starts_on: string; ends_on: string; teams: string[]; games: number;
  record: { wins: number; losses: number; draws: number } | null; stats: Record<string, number>; attendance_pct: number | null;
  evaluations: { date: string; score: number }[];
  review: { id: string; comment: string | null; awards: string[]; shared: boolean } | null;
};
export type JourneyData = {
  seasons: JourneySeason[];
  other_reviews: { id: string; season: string; comment: string | null; awards: string[]; shared: boolean }[];
};

export type ScoutView = {
  club: string | null; headline: string | null; expires_at: string; name: string; birth_year?: number; position?: string | null;
  dominant_hand?: string | null; teams?: { team: string; season: string | null; level: string | null; age_group: string | null }[];
  stats?: Record<string, number>; attendance_pct?: number | null; evaluations?: { date: string; score: number }[];
  seasons?: { season: string; comment: string | null; awards: string[] }[];
  placements?: { name: string; kind: string; status: string }[];
};

type Pub = MsgDatabase["public"];
export type InvoiceSplitCols = {
  payer_profile_id: string | null; split_group_id: string | null; split_share_pct: number | null; split_from_invoice_id: string | null;
};
type ExtTables = {
  invoices: T<Pub["Tables"]["invoices"]["Row"] & InvoiceSplitCols>;
  families: T<Pub["Tables"]["families"]["Row"] & { billing_split_mode: "single" | "split" }>;
};
export type FamilyDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Omit<Pub["Tables"], "family_members" | "invoices" | "families"> & FamilyTables & ExtTables;
    Functions: Pub["Functions"] & FamilyFunctions;
  };
};
export type FamilyClient = SupabaseClient<FamilyDatabase>;

/** RLS-scoped client (the signed-in user's session). */
export async function familyDb(): Promise<FamilyClient> {
  return (await createClient()) as unknown as FamilyClient;
}

/** Service-role client: server-only. Always filter by org_id. */
export function familyAdminDb(): FamilyClient {
  return createAdminClient() as unknown as FamilyClient;
}
