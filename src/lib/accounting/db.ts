import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

/**
 * Typed view of the tables and RPCs of migration
 * 20250420101300_accounting_bank_refunds_dunning.sql. Kept local (like
 * src/lib/plans/db.ts); merges into src/types/database.ts once the types are
 * regenerated with `npm run types`.
 */
type T<Row> = { Row: Row; Insert: Partial<Row> & Record<string, unknown>; Update: Partial<Row> & Record<string, unknown>; Relationships: [] };

export type PeriodLockRow = {
  id: string; org_id: string; period_start: string; period_end: string; closed_at: string; closed_by: string | null;
  reopened_at: string | null; reopened_by: string | null; reopen_reason: string | null; created_at: string; updated_at: string;
};
export type AccountRow = { id: string; org_id: string; number: string; name: string; type: string; is_active: boolean; created_at: string; updated_at: string };
export type MappingRow = { id: string; org_id: string; key: string; account_number: string | null; vat_code: string | null; created_at: string; updated_at: string };
export type ImportRow = {
  id: string; org_id: string; file_name: string; file_sha256: string; message_id: string | null; format: "camt.053" | "camt.054";
  account_last4: string | null; statement_from: string | null; statement_to: string | null; entry_count: number; duplicate_count: number;
  skipped_count: number; matched_count: number; booked_count: number; total_amount: number; currency: string | null;
  imported_by: string | null; created_at: string; updated_at: string;
};
export type BankEntryRow = {
  id: string; org_id: string; import_id: string; bank_ref: string; amount: number; currency: string; booking_date: string | null;
  value_date: string | null; reference: string | null; reference_type: "QRR" | "SCOR" | "NON"; debtor_name: string | null;
  debtor_iban_last4: string | null; remittance: string | null; status: "unmatched" | "suggested" | "booked" | "ignored";
  match_kind: "reference" | "heuristic" | "manual" | null; match_score: number | null; invoice_id: string | null; payment_id: string | null;
  booked_by: string | null; booked_at: string | null; ignored_reason: string | null; created_at: string; updated_at: string;
};
export type RefundPolicyRow = {
  id: string; org_id: string; product_type: "camp" | "training" | "team_season" | "shop"; full_until_days: number | null;
  partial_percent: number; partial_until_days: number | null; medical_mode: "none" | "credit" | "refund" | "choice";
  medical_percent: number; notes: string | null; is_active: boolean; created_at: string; updated_at: string;
};
export type RefundRequestRow = {
  id: string; org_id: string; family_id: string; invoice_id: string | null; registration_id: string | null; booking_id: string | null;
  product_type: string; starts_on: string | null; days_before: number | null; medical: boolean; reason: string | null;
  preference: "family_credit" | "stripe_refund" | "bank_refund" | null; policy_snapshot: Json | null; computed_percent: number;
  base_amount: number; computed_amount: number; final_amount: number | null; payout_amount: number | null; currency: string;
  override_reason: string | null; resolution: string | null;
  status: "requested" | "processing" | "stripe_failed" | "completed" | "rejected"; credit_note_id: string | null;
  invoice_cancelled: boolean; refund_payment_id: string | null; stripe_payment_intent: string | null; stripe_refund_id: string | null;
  stripe_error: string | null; iban_last4: string | null; requested_by: string | null; requested_at: string; processed_by: string | null;
  processed_at: string | null; rejected_reason: string | null; created_at: string; updated_at: string;
};
export type RefundBankRow = { id: string; org_id: string; refund_request_id: string; account_holder: string; iban: string; created_by: string | null; created_at: string; updated_at: string };
export type DunningSettingsRow = {
  org_id: string; enabled: boolean; level1_days: number; level2_days: number; level2_fee: number; level3_days: number; level3_fee: number;
  collection_days: number; min_balance: number; created_at: string; updated_at: string;
};
export type DunningPauseRow = { id: string; org_id: string; family_id: string; paused_until: string | null; reason: string; created_by: string | null; created_at: string; updated_at: string };
export type DunningCaseRow = {
  id: string; org_id: string; invoice_id: string; family_id: string; level: number; status: "active" | "collection" | "resolved";
  last_notice_at: string | null; collection_at: string | null; collection_exported_at: string | null; resolved_at: string | null;
  resolved_reason: string | null; created_at: string; updated_at: string;
};
export type DunningNoticeRow = {
  id: string; org_id: string; case_id: string; invoice_id: string; family_id: string; level: number; fee_amount: number;
  adjustment_id: string | null; balance: number; currency: string; ref_due_date: string; sent_at: string | null; send_attempts: number;
  created_at: string; updated_at: string;
};
export type ReimbursementRow = {
  id: string; org_id: string; funder_kind: "city" | "canton" | "foundation" | "js" | "other"; funder_name: string; family_id: string | null;
  invoice_id: string | null; period_start: string | null; period_end: string | null; amount_expected: number; amount_received: number | null;
  currency: string; status: "expected" | "requested" | "received" | "rejected"; requested_on: string | null; received_on: string | null;
  reference: string | null; notes: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type SupportDiscountRow = {
  id: string; org_id: string; name: string; description: string | null; kind: "percent" | "fixed_amount"; value: number; currency: string | null;
  scope: string; scope_program_id: string | null; rule: string; scope_family_id: string | null; max_amount: number | null;
  support_reason: string | null; valid_from: string | null; valid_until: string | null; is_active: boolean; created_by: string | null;
  created_at: string; updated_at: string;
};
export type OpenItemRow = {
  invoice_id: string; number: string; family_id: string; family_name: string | null; issued_on: string; due_date: string | null;
  currency: string; amount_due: number; paid: number; open_amount: number; days_overdue: number; dunning_level: number;
};

type Tables = {
  accounting_period_locks: T<PeriodLockRow>;
  accounting_accounts: T<AccountRow>;
  accounting_mappings: T<MappingRow>;
  bank_statement_imports: T<ImportRow>;
  bank_entries: T<BankEntryRow>;
  refund_policies: T<RefundPolicyRow>;
  refund_requests: T<RefundRequestRow>;
  refund_bank_details: T<RefundBankRow>;
  dunning_settings: T<DunningSettingsRow>;
  dunning_family_pauses: T<DunningPauseRow>;
  dunning_cases: T<DunningCaseRow>;
  dunning_notices: T<DunningNoticeRow>;
  external_reimbursements: T<ReimbursementRow>;
  discounts: T<SupportDiscountRow>;
};

type Functions = {
  accounting_close_period: { Args: { p_month: string }; Returns: Json };
  accounting_reopen_period: { Args: { p_month: string; p_reason: string }; Returns: Json };
  accounting_seed_chart: { Args: { p_accounts: Json; p_mappings: Json }; Returns: Json };
  accounting_journal_source: { Args: { p_from: string; p_to: string }; Returns: Json };
  accounting_open_items: { Args: { p_date: string }; Returns: OpenItemRow[] };
  bank_import: { Args: { p_meta: Json; p_entries: Json; p_auto_book: boolean }; Returns: Json };
  bank_entry_confirm: { Args: { p_entry: string; p_invoice?: string | null }; Returns: Json };
  bank_entry_ignore: { Args: { p_entry: string; p_reason: string }; Returns: Json };
  bank_entry_reopen: { Args: { p_entry: string; p_reason: string }; Returns: Json };
  refund_quote: { Args: { p_registration?: string | null; p_booking?: string | null; p_invoice?: string | null; p_medical?: boolean; p_on?: string | null }; Returns: Json };
  refund_request_create: { Args: { p_payload: Json }; Returns: Json };
  refund_request_process: { Args: { p_request: string; p_resolution: string; p_amount?: number | null; p_override_reason?: string | null }; Returns: Json };
  refund_request_stripe_params: { Args: { p_request: string }; Returns: Json };
  refund_request_stripe_result: { Args: { p_request: string; p_org: string; p_refund_id: string | null; p_error?: string | null }; Returns: Json };
  refund_request_reject: { Args: { p_request: string; p_reason: string }; Returns: Json };
  dunning_run: { Args: { p_org: string; p_today?: string; p_dry_run?: boolean }; Returns: Json };
  dunning_mark_sent: { Args: { p_notice: string; p_org: string; p_ok: boolean }; Returns: undefined };
  dunning_resolve_case: { Args: { p_case: string; p_reason: string }; Returns: Json };
  dunning_mark_exported: { Args: { p_cases: string[] }; Returns: number };
  family_support_apply: { Args: { p_invoice: string }; Returns: Json };
  family_support_sweep: { Args: { p_org: string }; Returns: Json };
  apply_stripe_refund: { Args: { p_payment_intent: string; p_refund_id: string; p_amount: number; p_currency?: string | null; p_account?: string | null }; Returns: Json };
};

type Pub = Database["public"];
export type AccountingDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Omit<Pub["Tables"], keyof Tables> & Tables;
    Functions: Omit<Pub["Functions"], keyof Functions> & Functions;
  };
};
export type AccountingClient = SupabaseClient<AccountingDatabase>;

/** RLS-scoped client (user session). */
export async function accountingDb(): Promise<AccountingClient> {
  return (await createClient()) as unknown as AccountingClient;
}

/** Service-role client (server only; callers filter by org explicitly). */
export function accountingAdminDb(): AccountingClient {
  return createAdminClient() as unknown as AccountingClient;
}
