import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

/**
 * Typed view of the tables and RPCs of migration 20250420101500_club_admin.sql
 * (memberships, waiting lists, J+S, staff compliance, incidents). Kept local
 * like src/lib/camps/db.ts; merges into src/types/database.ts once the types
 * are regenerated with `npm run types`.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type ClubAdminSettingsRow = {
  org_id: string; waitlist_offer_hours: number; waitlist_auto_offer: boolean; membership_renewal_window_days: number;
  js_enabled: boolean; js_club_number: string | null; js_age_min: number; js_age_max: number;
  js_rate_per_participant_hour: number | string | null; compliance_block_youth: boolean;
  compliance_mandatory_kinds: string[]; compliance_reminder_days: number[]; updated_by: string | null;
  created_at: string; updated_at: string;
};
export type MembershipTypeRow = {
  id: string; org_id: string; name: string; description: string | null; kind: string; scope: "person" | "family";
  price: number | string; currency: string | null; period: "season" | "calendar_year"; season_start_month: number;
  min_age: number | null; max_age: number | null; is_active: boolean; sort: number; created_at: string; updated_at: string;
};
export type MembershipRow = {
  id: string; org_id: string; membership_type_id: string; family_id: string; athlete_id: string | null;
  valid_from: string; valid_until: string; status: "pending_payment" | "active" | "expired" | "cancelled";
  price_amount: number | string; currency: string; invoice_id: string | null; renewed_from_id: string | null;
  renewal_reminded_at: string | null; cancelled_at: string | null; cancel_reason: string | null; created_by: string | null;
  created_at: string; updated_at: string;
};
export type WaitlistRow = {
  id: string; org_id: string; target_kind: "program" | "camp_edition" | "training_slot"; target_key: string;
  program_id: string | null; camp_edition_id: string | null; service_id: string | null; coach_id: string | null;
  slot_start: string | null; athlete_id: string; family_id: string; position: number;
  status: "waiting" | "offered" | "accepted" | "declined" | "expired" | "skipped" | "removed";
  request: Json; offer_token_hash: string | null; offered_at: string | null; offer_expires_at: string | null;
  offer_count: number; responded_at: string | null; registration_id: string | null; booking_id: string | null;
  invoice_id: string | null; skip_reason: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type AthleteIdentifierRow = {
  id: string; org_id: string; athlete_id: string; ahv_last4: string | null; consent_recorded_at: string | null;
  consent_recorded_by: string | null; consent_note: string | null; created_at: string; updated_at: string;
};
export type CertificateRow = {
  id: string; org_id: string; coach_id: string; kind: string; title: string | null; reference: string | null;
  issued_on: string | null; valid_until: string | null; file_path: string | null; file_name: string | null;
  status: "pending" | "verified" | "rejected"; verified_by: string | null; verified_at: string | null;
  rejection_reason: string | null; notes: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type CertReminderRow = {
  id: string; org_id: string; certificate_id: string; threshold_days: number; valid_until: string; sent_at: string;
  created_at: string; updated_at: string;
};
export type OverrideRow = {
  id: string; org_id: string; team_id: string; coach_id: string; reason: string; missing: string[]; created_by: string | null;
  created_at: string; updated_at: string;
};
export type IncidentRow = {
  id: string; org_id: string; athlete_id: string; occurred_at: string; program_id: string | null; team_id: string | null;
  attendance_session_id: string | null; location: string | null; description: string; body_part: string; severity: string;
  first_aid_given: boolean; first_aid_details: string | null; first_aid_by: string | null; parents_informed_at: string | null;
  parents_informed_how: string | null; referral: string; follow_up_notes: string | null; return_status: string;
  cleared_on: string | null; clearance_file_path: string | null; clearance_file_name: string | null; status: "open" | "closed";
  reported_by: string | null; created_at: string; updated_at: string;
};

type Ext<K extends keyof Database["public"]["Tables"], X> = T<Database["public"]["Tables"][K]["Row"] & X>;

type Tables = {
  programs: Ext<"programs", { js_offer: boolean; js_offer_number: string | null; js_session_minutes: number | null; status: string; currency: string | null; capacity: number | null }>;
  registrations: Ext<"registrations", { camp_edition_id: string | null; invoice_id: string | null }>;
  training_services: Ext<"training_services", { max_participants: number; currency: string | null }>;
  coaches: Ext<"coaches", { js_person_number: string | null }>;
  teams: T<{ id: string; org_id: string; name: string; program_id: string | null; age_group: string | null; is_active: boolean; is_youth: boolean; js_offer: boolean }>;
  team_coaches: T<{ team_id: string; coach_id: string; org_id: string; role: string; created_at: string }>;
  camp_editions: T<{ id: string; org_id: string; program_id: string; name: string | null; starts_on: string; ends_on: string; capacity: number | null; status: string }>;
  camp_price_options: T<{ id: string; org_id: string; program_id: string; edition_id: string | null; label: string; days_count: number; price: number | string; member_price: number | string | null; is_active: boolean; sort: number }>;
  camp_age_groups: T<{ id: string; org_id: string; program_id: string; label: string; min_age: number | null; max_age: number | null; is_active: boolean; sort: number }>;
  club_admin_settings: T<ClubAdminSettingsRow>;
  membership_types: T<MembershipTypeRow>;
  memberships: T<MembershipRow>;
  waitlist_entries: T<WaitlistRow>;
  athlete_identifiers: T<AthleteIdentifierRow>;
  staff_certificates: T<CertificateRow>;
  staff_certificate_reminders: T<CertReminderRow>;
  coach_assignment_overrides: T<OverrideRow>;
  incident_reports: T<IncidentRow>;
};

type Functions = {
  membership_create: { Args: { p_payload: Json }; Returns: Json };
  membership_expire_due: { Args: { p_org?: string | null }; Returns: number };
  is_member: { Args: { p_family: string; p_on?: string | null }; Returns: boolean };
  apply_member_price: { Args: { p_kind: string; p_id: string; p_label?: string | null }; Returns: Json };
  waitlist_process: { Args: { p_org?: string | null; p_target_key?: string | null; p_force_entry?: string | null }; Returns: Json };
  waitlist_offer_lookup: { Args: { p_token: string }; Returns: Json };
  waitlist_respond: { Args: { p_token: string; p_accept: boolean }; Returns: Json };
  waitlist_move: { Args: { p_entry: string; p_position: number }; Returns: undefined };
  set_athlete_ahv: { Args: { p_athlete: string; p_ahv: string | null; p_consent_note: string | null }; Returns: undefined };
  js_ahv_numbers: { Args: { p_athletes: string[] }; Returns: { athlete_id: string; ahv: string }[] };
  coach_compliance_missing: { Args: { p_coach: string; p_on?: string | null }; Returns: string[] };
  assign_coach_with_override: { Args: { p_team: string; p_coach: string; p_role: string; p_reason: string }; Returns: string };
};

type Pub = Database["public"];
export type ClubAdminDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Omit<Pub["Tables"], keyof Tables> & Tables;
    Functions: Pub["Functions"] & Functions;
  };
};
export type ClubAdminClient = SupabaseClient<ClubAdminDatabase>;

/** RLS-scoped client (signed-in user). */
export async function caDb(): Promise<ClubAdminClient> {
  return (await createClient()) as unknown as ClubAdminClient;
}

/** Service-role client (server only; callers filter by org explicitly). */
export function caAdminDb(): ClubAdminClient {
  return createAdminClient() as unknown as ClubAdminClient;
}

/** Private bucket for certificates and clearance documents. */
export const CLUB_ADMIN_BUCKET = "club-admin-files";
/** Signed URL lifetime (seconds). */
export const SIGNED_URL_TTL = 120;
