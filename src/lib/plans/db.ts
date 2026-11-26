import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

/**
 * Typed view of the tables and RPCs of migration
 * 20250420101000_instalments_recurring_autopay.sql. Kept local like
 * src/lib/shop/db.ts; merges into src/types/database.ts once the types are
 * regenerated with `npm run types`.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type PlanSettingsRow = {
  org_id: string; enabled: boolean; product_types: string[]; allowed_counts: number[]; min_amount: number;
  fee_kind: string; fee_value: number; first_at_signup: boolean; schedule_kind: string; day_of_month: number;
  custom_dates: string[]; camp_last_days_before: number | null; autopay_enabled: boolean; retry_days: number[];
  remind_before_days: number; overdue_repeat_days: number; mandate_version: string; created_at: string; updated_at: string;
};
export type PlanRow = {
  id: string; org_id: string; family_id: string; invoice_id: string | null; program_id: string | null; athlete_id: string | null;
  kind: "installments" | "recurring"; description: string | null; currency: string; amount_total: number | null;
  amount_per_period: number | null; installment_count: number | null; frequency: string; interval_count: number;
  start_date: string; end_date: string | null; next_run_date: string | null; due_days: number;
  status: "active" | "paused" | "completed" | "cancelled"; created_by: string | null; created_at: string; updated_at: string;
  source: string | null; fee_amount: number; fee_adjustment_id: string | null; original_due_date: string | null; autopay: boolean;
  template_id: string | null; team_id: string | null; manual_discount_ids: string[]; paused_at: string | null; pause_reason: string | null;
  cancelled_at: string | null; cancel_reason: string | null;
};
export type InstalmentRow = {
  id: string; org_id: string; plan_id: string; seq: number; due_date: string; amount: number; currency: string;
  invoice_id: string | null; status: "scheduled" | "invoiced" | "paid" | "cancelled" | "skipped"; reminded_at: string | null;
  created_at: string; updated_at: string; amount_paid: number; paid_at: string | null; period_start: string | null;
  period_end: string | null; skipped_reason: string | null; reminded_before_at: string | null; overdue_reminded_at: string | null;
  autopay_status: "processing" | "succeeded" | "requires_action" | "failed" | "fallback" | null; autopay_attempts: number;
  autopay_round_start: number; autopay_first_on: string | null; autopay_next_on: string | null;
};
export type TemplateRow = {
  id: string; org_id: string; name: string; description: string | null; amount: number; currency: string;
  frequency: "monthly" | "quarterly" | "yearly"; billing_day: number; start_date: string; end_date: string | null;
  program_id: string | null; team_id: string | null; proration: "none" | "daily" | "half_month"; due_days: number;
  apply_discounts: boolean; is_active: boolean; created_by: string | null; created_at: string; updated_at: string;
};
export type PauseRow = {
  id: string; org_id: string; plan_id: string; starts_on: string; ends_on: string; kind: "holiday" | "injury" | "other";
  note: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type MandateRow = {
  id: string; org_id: string; family_id: string; status: "pending" | "active" | "replaced" | "revoked" | "detached";
  enabled: boolean; stripe_account_id: string | null; stripe_customer_id: string | null; stripe_payment_method_id: string | null;
  setup_session_id: string | null; card_brand: string | null; card_last4: string | null; card_exp_month: number | null;
  card_exp_year: number | null; consent_version: string; consent_text: string; consented_at: string; consented_by: string | null;
  activated_at: string | null; revoked_at: string | null; revoked_by: string | null; expiry_notified_at: string | null;
  created_at: string; updated_at: string;
};
export type ChargeRow = {
  id: string; org_id: string; family_id: string; mandate_id: string; installment_id: string; invoice_id: string; amount: number;
  currency: string; attempt: number; idempotency_key: string; payment_intent_id: string | null;
  status: "processing" | "succeeded" | "requires_action" | "failed"; failure_code: string | null; decline_code: string | null;
  next_retry_on: string | null; created_at: string; updated_at: string;
};
export type GenerateRow = {
  plan_id: string; family_id: string; athlete_id: string | null; period_start: string; period_end: string; amount: number;
  discount: number; net: number; action: "invoice" | "skip_pause" | "skip_zero" | "skip_sponsored"; installment_id: string | null; invoice_id: string | null;
};

type PlanTables = {
  payment_plan_settings: T<PlanSettingsRow>;
  payment_plans: T<PlanRow>;
  payment_plan_installments: T<InstalmentRow>;
  recurring_fee_templates: T<TemplateRow>;
  recurring_plan_pauses: T<PauseRow>;
  autopay_mandates: T<MandateRow>;
  autopay_charges: T<ChargeRow>;
};

type PlanFunctions = {
  plan_choose: { Args: { p_invoice: string; p_count: number }; Returns: Json };
  plan_attach_checkout: { Args: { p_org: string; p_invoice: string; p_count: number; p_source: string | null }; Returns: Json };
  plan_admin_create: { Args: { p_invoice: string; p_dates: string[]; p_amounts: number[]; p_fee?: number }; Returns: Json };
  plan_invoice_context: { Args: { p_invoice: string }; Returns: Json };
  plan_reschedule: { Args: { p_plan: string; p_items: Json; p_reason?: string | null }; Returns: Json };
  plan_set_paused: { Args: { p_plan: string; p_paused: boolean; p_reason?: string | null }; Returns: Json };
  plan_cancel: { Args: { p_plan: string; p_reason: string }; Returns: Json };
  recurring_enrol: { Args: { p_template: string; p_athletes: string[]; p_start: string; p_amount?: number | null }; Returns: number };
  recurring_enrol_team: { Args: { p_template: string; p_team: string; p_start: string }; Returns: number };
  recurring_end: { Args: { p_plan: string; p_end: string; p_reason?: string | null }; Returns: Json };
  recurring_add_pause: { Args: { p_plan: string; p_from: string; p_to: string; p_kind: string; p_note?: string | null }; Returns: string };
  recurring_remove_pause: { Args: { p_pause: string }; Returns: undefined };
  recurring_skip_period: { Args: { p_plan: string; p_period_start: string; p_reason: string }; Returns: Json };
  recurring_generate: { Args: { p_org: string; p_as_of?: string; p_dry_run?: boolean }; Returns: GenerateRow[] };
  run_recurring_billing: { Args: { p_org: string; p_as_of?: string }; Returns: number };
  plans_cron_work: { Args: { p_org: string; p_today?: string }; Returns: Json };
  plan_mark_reminded: { Args: { p_installment: string; p_kind: string }; Returns: boolean };
  autopay_start_setup: { Args: { p_family: string; p_consent_version: string; p_consent_text: string }; Returns: Json };
  autopay_attach_session: { Args: { p_mandate: string; p_org: string; p_customer: string; p_session: string; p_account: string | null }; Returns: undefined };
  autopay_activate: {
    Args: { p_mandate: string; p_account: string | null; p_customer: string | null; p_payment_method: string; p_brand: string | null; p_last4: string | null; p_exp_month: number | null; p_exp_year: number | null };
    Returns: Json;
  };
  autopay_set_enabled: { Args: { p_mandate: string; p_enabled: boolean }; Returns: Json };
  autopay_revoke: { Args: { p_mandate: string }; Returns: Json };
  autopay_payment_method_event: {
    Args: { p_account: string | null; p_payment_method: string; p_detached: boolean; p_brand?: string | null; p_last4?: string | null; p_exp_month?: number | null; p_exp_year?: number | null };
    Returns: number;
  };
  autopay_mark_expiry_notified: { Args: { p_mandate: string }; Returns: boolean };
  autopay_begin_charge: { Args: { p_installment: string; p_today?: string }; Returns: Json };
  autopay_charge_result: {
    Args: { p_charge: string | null; p_payment_intent: string | null; p_status: string; p_code?: string | null; p_decline?: string | null; p_account?: string | null; p_today?: string };
    Returns: Json;
  };
  autopay_retry_now: { Args: { p_installment: string }; Returns: Json };
  installment_outstanding: { Args: { p_installment: string }; Returns: number };
};

type Pub = Database["public"];
export type PlansDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Omit<Pub["Tables"], keyof PlanTables> & PlanTables;
    Functions: Omit<Pub["Functions"], keyof PlanFunctions> & PlanFunctions;
  };
};
export type PlansClient = SupabaseClient<PlansDatabase>;

/** RLS-scoped client (user session). */
export async function plansDb(): Promise<PlansClient> {
  return (await createClient()) as unknown as PlansClient;
}

/** Service-role client (server only; callers filter by org explicitly). */
export function plansAdminDb(): PlansClient {
  return createAdminClient() as unknown as PlansClient;
}
