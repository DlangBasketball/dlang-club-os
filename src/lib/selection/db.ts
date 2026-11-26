import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

/**
 * Typed view of the tables and RPCs of migration
 * 20250420102600_selection_programs.sql. Kept local like src/lib/plans/db.ts;
 * merges into src/types/database.ts once the types are regenerated.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type DivisionRow = {
  id: string; org_id: string; program_id: string; name: string; min_birth_year: number | null; max_birth_year: number | null;
  age_under: number | null; age_cutoff: string | null; team_id: string | null; capacity: number | null; sort: number;
  is_active: boolean; created_at: string; updated_at: string;
};
export type PackageRow = {
  id: string; org_id: string; program_id: string; name: string; description: string | null; price: number | string;
  allowed_counts: number[]; show_monthly: boolean; sort: number; is_active: boolean; created_at: string; updated_at: string;
  // migration 20250420102900_selection_roster.sql
  tournament_count?: number | null; monthly_amount?: number | string | null;
};
export type ProgramCoachRow = {
  id: string; org_id: string; program_id: string; coach_id: string; division_id: string | null; role: "head" | "assistant";
  created_at: string; updated_at: string;
};
export type ApplicationRow = {
  id: string; org_id: string; program_id: string; division_id: string | null; package_id: string | null; athlete_id: string;
  family_id: string; status: string; is_member: boolean; source: "public" | "parent" | "admin"; current_club: string | null;
  position: string | null; notes: string | null; video_url: string | null; decision_note: string | null; staff_notes: string | null;
  invoice_id: string | null; installment_count: number | null; applied_by: string | null; reviewed_by: string | null;
  reviewed_at: string | null; accepted_at: string | null; enrolled_at: string | null; withdrawn_at: string | null;
  created_at: string; updated_at: string;
  // migration 20250420102900_selection_roster.sql (fee arrangement snapshot, withdrawal)
  agreed_fee?: number | string | null; agreed_currency?: string | null; arrangement_kind?: "full" | "monthly" | null;
  monthly_amount?: number | string | null; first_due_on?: string | null; arrangement_installments?: number | null;
  tournaments_covered_count?: number | null; tournament_override_reason?: string | null; agreed_at?: string | null;
  agreed_by?: string | null; withdrawal_reason?: string | null; withdrawn_by?: string | null; balance_at_withdrawal?: number | string | null;
};
export type TournamentRow = {
  id: string; org_id: string; program_id: string; division_id: string | null; name: string; stage: string | null; city: string | null;
  starts_on: string | null; ends_on: string | null; location: string | null; sort: number;
  status: "planned" | "confirmed" | "completed" | "cancelled"; created_at: string; updated_at: string;
};
export type ApplicationTournamentRow = {
  id: string; org_id: string; application_id: string; tournament_id: string; athlete_id: string | null; status: "covered" | "withdrawn";
  withdrawn_at: string | null; withdrawn_by: string | null; note: string | null; created_at: string; updated_at: string;
};
export type RosterRow = {
  application_id: string; athlete_id: string; first_name: string; last_name: string; birth_year: number | null;
  division_id: string | null; division_name: string | null; package_id: string | null; package_name: string | null; status: string; source: string;
  tournaments: Json; tournaments_required: number | null; tournament_override_reason: string | null;
  arrangement_kind: string | null; agreed_fee: number | string | null; monthly_amount: number | string | null; first_due_on: string | null;
  installment_count: number | null; currency: string | null; amount_due: number | string | null; received: number | string | null;
  balance: number | string | null; next_due_on: string | null; overdue: boolean | null; overdue_amount: number | string | null;
  payment_status: string | null; show_money: boolean; invoice_id: string | null; jersey_number: number | null; staff_notes: string | null;
  accepted_at: string | null; enrolled_at: string | null; withdrawn_at: string | null; withdrawal_reason: string | null;
  balance_at_withdrawal: number | string | null; registration_ok: boolean | null; sponsored: number | string | null;
};
export type UnenrolledMemberRow = {
  program_id: string; program_name: string; division_id: string; division_name: string; team_id: string; team_name: string;
  athlete_id: string; first_name: string; last_name: string; birth_year: number | null; jersey_number: number | null; joined_on: string | null;
};
export type AthleteEnrollmentRow = {
  application_id: string; program_id: string; program_name: string; season_year: number | null; division_name: string | null;
  package_name: string | null; status: string; tournaments: Json; arrangement_kind: string | null; agreed_fee: number | string | null;
  monthly_amount: number | string | null; currency: string | null; amount_due: number | string | null; received: number | string | null;
  balance: number | string | null; next_due_on: string | null; overdue: boolean | null; payment_status: string | null; show_money: boolean;
  accepted_at: string | null; enrolled_at: string | null; withdrawn_at: string | null; withdrawal_reason: string | null;
};
export type ReviewRow = {
  application_id: string; status: string; division_id: string | null; division_name: string | null; package_id: string | null;
  package_name: string | null; athlete_id: string; first_name: string; last_name: string; birth_year: number | null; dob: string | null;
  player_position: string | null; current_club: string | null; notes: string | null; video_url: string | null; is_member: boolean;
  decision_note: string | null; staff_notes: string | null; invoice_id: string | null; installment_count: number | null;
  sponsorship_kind: string | null; sponsorship_percent: number | string | null; applied_at: string; reviewed_at: string | null;
};
export type ReportRow = {
  application_id: string; program_id: string; program_name: string; season_year: number | null; division_name: string | null;
  package_name: string | null; athlete_name: string; birth_year: number | null; family_name: string; is_member: boolean;
  current_club: string | null; status: string; currency: string; invoice_number: string | null; invoiced: number | string;
  sponsored: number | string; collected: number | string; outstanding: number | string; installment_count: number | null;
  applied_at: string; accepted_at: string | null; enrolled_at: string | null;
};

type SelectionTables = {
  program_divisions: T<DivisionRow>;
  program_packages: T<PackageRow>;
  program_coaches: T<ProgramCoachRow>;
  program_applications: T<ApplicationRow>;
  program_tournaments: T<TournamentRow>;
  application_tournaments: T<ApplicationTournamentRow>;
};

type SelectionFunctions = {
  selection_apply: { Args: { p_program: string; p_athlete: string; p_division: string | null; p_package: string; p_payload?: Json }; Returns: Json };
  selection_apply_public: { Args: { p_payload: Json }; Returns: Json };
  selection_set_status: {
    Args: { p_application: string; p_status: string | null; p_note?: string | null; p_division?: string | null; p_staff_notes?: string | null };
    Returns: Json;
  };
  selection_change_package: { Args: { p_application: string; p_package: string }; Returns: Json };
  selection_choose_plan: { Args: { p_application: string; p_count: number }; Returns: Json };
  selection_withdraw: { Args: { p_application: string; p_note?: string | null }; Returns: Json };
  selection_review_list: { Args: { p_program: string }; Returns: ReviewRow[] };
  selection_program_stats: { Args: { p_program?: string | null }; Returns: Json };
  selection_report: {
    Args: { p_program?: string | null; p_season?: number | null; p_division?: string | null; p_package?: string | null };
    Returns: ReportRow[];
  };
  selection_head_coach: { Args: { p_program: string }; Returns: boolean };
  sponsorship_apply_service: { Args: { p_invoice: string }; Returns: Json };
  // migration 20250420102700_team_delete.sql
  create_division_team: { Args: { p_division: string; p_name?: string | null }; Returns: string };
  selection_delete_division: { Args: { p_division: string; p_move_to?: string | null; p_team_mode?: string }; Returns: Json };
  // migration 20250420102900_selection_roster.sql
  selection_roster: { Args: { p_program: string }; Returns: RosterRow[] };
  selection_athlete_enrollments: { Args: { p_athlete: string }; Returns: AthleteEnrollmentRow[] };
  selection_roster_health: { Args: { p_program?: string | null }; Returns: Json };
  selection_repair_registration: { Args: { p_application: string }; Returns: boolean };
  selection_enroll_now: { Args: { p_application: string; p_reason: string }; Returns: Json };
  selection_unenrolled_team_members: { Args: { p_program?: string | null }; Returns: UnenrolledMemberRow[] };
  selection_staff_add: {
    Args: {
      p_program: string; p_athlete: string; p_division: string | null; p_package: string; p_tournaments?: string[]; p_kind?: string;
      p_monthly?: number | null; p_first?: string | null; p_status?: string; p_override_reason?: string | null; p_notes?: string | null;
      p_fee?: number | null; p_fee_reason?: string | null; p_age_confirmed?: boolean;
    };
    Returns: Json;
  };
  selection_save_enrollment: { Args: { p_application: string; p_payload: Json }; Returns: Json };
  selection_set_arrangement: {
    Args: { p_application: string; p_kind: string; p_package?: string | null; p_monthly?: number | null; p_first?: string | null; p_reason?: string | null; p_fee?: number | null };
    Returns: Json;
  };
  selection_set_tournaments: { Args: { p_application: string; p_tournaments: string[]; p_override_reason?: string | null }; Returns: Json };
  selection_withdraw_tournament: { Args: { p_application: string; p_tournament: string; p_reason: string }; Returns: Json };
  selection_withdraw_enrollment: { Args: { p_application: string; p_reason: string; p_on?: string | null }; Returns: Json };
  selection_update_enrollment: { Args: { p_application: string; p_payload: Json }; Returns: Json };
  selection_move_enrollment: { Args: { p_application: string; p_program: string; p_division: string | null; p_package: string }; Returns: Json };
};

type Pub = Database["public"];
export type SelectionDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Omit<Pub["Tables"], keyof SelectionTables> & SelectionTables;
    Functions: Omit<Pub["Functions"], keyof SelectionFunctions> & SelectionFunctions;
  };
};
export type SelectionClient = SupabaseClient<SelectionDatabase>;

/** RLS-scoped client (user session). */
export async function selectionDb(): Promise<SelectionClient> {
  return (await createClient()) as unknown as SelectionClient;
}

/** Service-role client (server only; callers filter by org explicitly). */
export function selectionAdminDb(): SelectionClient {
  return createAdminClient() as unknown as SelectionClient;
}
