import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";
import type { MembershipReportDbRow, SeasonOverviewDbRow } from "./membership-report";
import type { AccountingTransactionDbRow } from "./transactions";

/**
 * Typed view of the RPCs of migration 20250420103700_finance_reports.sql.
 * Kept local (like src/lib/accounting/db.ts); merges into src/types/database.ts
 * once the types are regenerated with `npm run types`.
 */
type Functions = {
  club_membership_month_report: {
    Args: { p_season: string; p_month: string; p_team?: string | null; p_status?: string | null };
    Returns: MembershipReportDbRow[];
  };
  club_membership_season_overview: { Args: { p_season: string; p_team?: string | null }; Returns: SeasonOverviewDbRow[] };
  accounting_transactions: {
    Args: { p_from: string; p_to: string; p_entity?: string | null; p_category?: string | null };
    Returns: AccountingTransactionDbRow[];
  };
  accounting_last_exports: { Args: Record<string, never>; Returns: { kind: string; ok: boolean; exported_at: string; details: Json }[] };
};

type Pub = Database["public"];
export type FinanceReportsDatabase = {
  public: Omit<Pub, "Functions"> & { Functions: Omit<Pub["Functions"], keyof Functions> & Functions };
};
export type FinanceReportsClient = SupabaseClient<FinanceReportsDatabase>;

/** RLS-scoped client (user session); the functions re-check admin / finance. */
export async function financeReportsDb(): Promise<FinanceReportsClient> {
  return (await createClient()) as unknown as FinanceReportsClient;
}
