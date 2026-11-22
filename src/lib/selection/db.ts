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
