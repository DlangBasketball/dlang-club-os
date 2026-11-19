import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

/**
 * Typed view of the finance tables (migration 20250420100400_finance_expenses.sql)
 * plus the few columns of older tables this module reads. Kept local, like
 * src/lib/camps/db.ts, so the shared generated types need no hand edit;
 * `npm run types` merges them later.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type ExpenseRow = {
  id: string; org_id: string; expense_date: string; amount: number | string; currency: string;
  category_id: string | null; supplier_id: string | null; coach_id: string | null; program_id: string | null;
  camp_edition_id: string | null; team_id: string | null; venue_id: string | null; description: string | null;
  payment_method: string; status: "paid" | "unpaid"; paid_on: string | null;
  receipt_path: string | null; receipt_name: string | null; receipt_type: string | null;
  recurring_monthly: boolean; recurrence_parent_id: string | null; coach_payout_id: string | null;
  deleted_at: string | null; deleted_by: string | null; delete_reason: string | null;
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
};
export type ExpenseCategoryRow = { id: string; org_id: string; name: string; is_active: boolean; sort: number; created_at: string; updated_at: string };
export type ExpenseSupplierRow = { id: string; org_id: string; name: string; contact: string | null; notes: string | null; is_active: boolean; created_at: string; updated_at: string };
export type CoachPayRateRow = { id: string; org_id: string; coach_id: string; rate_type: "hourly" | "per_session"; amount: number | string; currency: string; notes: string | null; updated_at: string };
export type CoachPayoutRow = {
  id: string; org_id: string; coach_id: string; period_month: string; sessions: number; bookings: number; minutes: number;
  clock_minutes: number | null; rate_type: "hourly" | "per_session"; rate_amount: number | string; amount: number | string;
  currency: string; status: "paid" | "void"; paid_on: string; expense_id: string | null; breakdown: Json | null;
  void_reason: string | null; voided_at: string | null; created_at: string;
};
type CampEditionLite = { id: string; org_id: string; program_id: string; name: string | null; starts_on: string; ends_on: string; venue_id: string | null; location_name: string | null; city: string | null; status: string };
type VenueLite = { id: string; org_id: string; name: string; city: string | null; is_active: boolean };
type TeamLite = { id: string; org_id: string; name: string; is_active: boolean };
type RegistrationFin = Database["public"]["Tables"]["registrations"]["Row"] & {
  camp_edition_id: string | null; invoice_id: string | null; price_amount: number | string | null; price_currency: string | null;
};

type FinanceTables = {
  expenses: T<ExpenseRow>;
  expense_categories: T<ExpenseCategoryRow>;
  expense_suppliers: T<ExpenseSupplierRow>;
  coach_pay_rates: T<CoachPayRateRow>;
  coach_payouts: T<CoachPayoutRow>;
  camp_editions: T<CampEditionLite>;
  venues: T<VenueLite>;
  teams: T<TeamLite>;
  registrations: T<RegistrationFin>;
};

type FinanceFunctions = {
  generate_recurring_expenses: { Args: { p_until?: string | null }; Returns: number };
  record_coach_payout: {
    Args: {
      p_coach: string; p_month: string; p_amount: number; p_currency: string; p_rate_type: string; p_rate_amount: number;
      p_sessions: number; p_bookings: number; p_minutes: number; p_clock_minutes: number | null; p_breakdown: Json | null;
      p_paid_on: string; p_method: string; p_category_name: string; p_description: string;
    };
    Returns: Json;
  };
  void_coach_payout: { Args: { p_payout: string; p_reason: string }; Returns: undefined };
};

type Pub = Database["public"];
export type FinanceDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Omit<Pub["Tables"], "registrations"> & FinanceTables;
    Functions: Pub["Functions"] & FinanceFunctions;
  };
};
export type FinanceClient = SupabaseClient<FinanceDatabase>;

/** RLS-scoped client (signed-in user) with the finance tables typed. */
export async function financeDb(): Promise<FinanceClient> {
  return (await createClient()) as unknown as FinanceClient;
}
