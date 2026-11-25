import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

/**
 * Finance read path of athletes (view public.billing_athletes, migration
 * 20250420106300_flexible_links_finance_scope.sql): identity, family, status,
 * sponsorship and licence fee of the caller's club, admin / finance only.
 * Finance never selects the athletes table (no DOB, sex, sports / profile
 * fields, school, notes, photo, medical). Admins read the same rows here, so
 * billing screens behave the same for both roles.
 *
 * Typed locally (like src/lib/training/db.ts) so the shared generated types do
 * not need a hand edit; `npm run types` merges them later.
 */
export type BillingAthleteRow = {
  id: string; org_id: string; family_id: string; first_name: string; last_name: string; status: string;
  archived_at: string | null; merged_into_id: string | null; created_at: string;
  sponsorship_kind: string; sponsorship_percent: number | null; sponsorship_scope: string[]; sponsor_name: string | null;
  sponsorship_reason: string | null; sponsorship_from: string | null; sponsorship_until: string | null; sponsored_at: string | null;
  licence_fee: number | null;
};

type Pub = Database["public"];
type BillingDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Pub["Tables"] & {
      billing_athletes: { Row: BillingAthleteRow; Insert: Record<string, never>; Update: Record<string, never>; Relationships: [] };
    };
    Functions: Pub["Functions"] & {
      athlete_sponsorship_set: { Args: { p_athlete: string | null; p_family: string | null; p_row: Json }; Returns: string[] };
    };
  };
};
export type BillingClient = SupabaseClient<BillingDatabase>;

/** Same client, typed with the billing view (RLS-scoped session). */
export function asBillingClient(db: object): BillingClient {
  return db as unknown as BillingClient;
}

/** RLS-scoped session client with the billing view. */
export async function billingDb(): Promise<BillingClient> {
  return asBillingClient(await createClient());
}

/** Columns every billing screen needs. */
export const BILLING_ATHLETE_COLUMNS = "id,first_name,last_name,family_id,status";
