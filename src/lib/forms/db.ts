import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

/**
 * Typed view of the forms / contracts / registration-form tables (migration
 * 20250420100800_forms_contracts.sql). Kept local like src/lib/development/db.ts;
 * merges into src/types/database.ts once the types are regenerated.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };
type Stamp = { created_at: string; updated_at: string };

export type FormRow = Stamp & {
  id: string; org_id: string; title: string; description: string | null; form_type: string; status: string;
  draft_schema: Json; current_version_id: string | null; created_by: string | null;
};
export type FormVersionRow = {
  id: string; org_id: string; form_id: string; version: number; title: string; form_type: string; schema: Json;
  published_by: string | null; published_at: string; created_at: string;
};
export type FormAssignmentRow = Stamp & {
  id: string; org_id: string; form_id: string; scope: string; program_id: string | null; team_id: string | null;
  training_service_id: string | null; renewal: string; renewal_months: number | null; due_date: string | null;
  is_required: boolean; is_active: boolean; created_by: string | null;
};
export type FormReminderRow = Stamp & {
  id: string; org_id: string; assignment_id: string; family_id: string; athlete_id: string | null; sent_by: string | null; sent_at: string;
};
export type FormSubmissionRow = Stamp & {
  id: string; org_id: string; form_id: string; form_version_id: string; assignment_id: string | null; athlete_id: string;
  family_id: string; answers: Json; signer_name: string | null; signature_path: string | null; ip_hash: string | null;
  submitted_by: string | null; submitted_at: string; valid_until: string | null; status: string; voided_at: string | null;
  voided_by: string | null; void_reason: string | null;
};
export type RegistrationFormConfigRow = Stamp & {
  id: string; org_id: string; program_id: string; builtin: Json; questions: Json; updated_by: string | null;
};
export type RegistrationAnswersRow = Stamp & {
  id: string; org_id: string; registration_id: string; athlete_id: string; program_id: string; answers: Json; questions: Json;
};
export type ContractTemplateRow = Stamp & {
  id: string; org_id: string; name: string; activity_type: string; program_id: string | null; title: string; body: string;
  version: number; status: string; auto_issue: boolean; published_at: string | null; created_by: string | null;
};
export type ContractRow = Stamp & {
  id: string; org_id: string; template_id: string; template_version: number; family_id: string; athlete_id: string | null;
  registration_id: string | null; purchase_id: string | null; program_id: string | null; source: string; title: string; body: string;
  merge_data: Json; status: string; issued_by: string | null; issued_at: string; signed_at: string | null; signer_name: string | null;
  signer_profile_id: string | null; ip_hash: string | null; pdf_path: string | null; voided_at: string | null; voided_by: string | null;
  void_reason: string | null; reissued_from: string | null;
};
export type TeamLiteRow = { id: string; org_id: string; name: string; is_active: boolean; program_id: string | null };
export type TeamMembershipLiteRow = { id: string; org_id: string; team_id: string; athlete_id: string; status: string };
export type PurchaseLiteRow = {
  id: string; org_id: string; athlete_id: string; family_id: string | null; service_id: string; sessions: number; amount: number;
  currency: string; status: string; expires_at: string | null; created_at: string;
};
export type RegistrationLiteRow = {
  id: string; org_id: string; athlete_id: string; program_id: string; status: string; notes: string | null; registered_by: string | null;
  camp_edition_id: string | null; price_amount: number | null; price_currency: string | null; created_at: string; updated_at: string;
};
export type CampEditionLiteRow = { id: string; org_id: string; program_id: string; starts_on: string; ends_on: string };

type FormsTables = {
  forms: T<FormRow>;
  form_versions: T<FormVersionRow>;
  form_assignments: T<FormAssignmentRow>;
  form_reminders: T<FormReminderRow>;
  form_submissions: T<FormSubmissionRow>;
  registration_form_configs: T<RegistrationFormConfigRow>;
  registration_answers: T<RegistrationAnswersRow>;
  contract_templates: T<ContractTemplateRow>;
  contracts: T<ContractRow>;
  teams: T<TeamLiteRow>;
  team_memberships: T<TeamMembershipLiteRow>;
  training_package_purchases: T<PurchaseLiteRow>;
  camp_editions: T<CampEditionLiteRow>;
  registrations: T<RegistrationLiteRow>;
};
type FormsFunctions = {
  publish_form: { Args: { p_form: string }; Returns: string };
  sign_contract: { Args: { p_contract: string; p_signer_name: string; p_ip_hash: string | null }; Returns: string };
  form_safety_answers: {
    Args: { p_athlete: string };
    Returns: { form_id: string; form_title: string; field_label: string; answer: string | null; submitted_at: string }[];
  };
};

type Pub = Database["public"];
export type FormsDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Omit<Pub["Tables"], keyof FormsTables> & FormsTables;
    Functions: Omit<Pub["Functions"], keyof FormsFunctions> & FormsFunctions;
  };
};
export type FormsClient = SupabaseClient<FormsDatabase>;

/** RLS-scoped client (user session). */
export async function formsDb(): Promise<FormsClient> {
  return (await createClient()) as unknown as FormsClient;
}

/** Service-role client (server only; callers always filter by org explicitly). */
export function formsAdminDb(): FormsClient {
  return createAdminClient() as unknown as FormsClient;
}

export const FORM_FILES_BUCKET = "form-files";
export const CONTRACTS_BUCKET = "contracts";
export const SIGNED_URL_TTL = 300;
