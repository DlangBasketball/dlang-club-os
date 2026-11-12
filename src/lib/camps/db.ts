import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

/**
 * Typed view of the camp + discount tables (migration
 * 20250420100100_camps_discounts.sql). Kept local, like src/lib/sportsops/db.ts,
 * so the shared generated types do not need a hand edit; `npm run types`
 * merges them later.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type CampEditionRow = {
  id: string; org_id: string; program_id: string; name: string | null; starts_on: string; ends_on: string;
  venue_id: string | null; location_name: string | null; address: string | null; city: string | null;
  capacity: number | null; registration_opens_at: string | null; registration_closes_at: string | null;
  status: "draft" | "published" | "archived" | "cancelled"; notes: string | null; archived_at: string | null;
  created_at: string; updated_at: string;
};
export type CampTimeSlotRow = {
  id: string; org_id: string; program_id: string; edition_id: string | null; label: string; starts_at: string; ends_at: string;
  sort: number; created_at: string; updated_at: string;
};
export type CampAgeGroupRow = {
  id: string; org_id: string; program_id: string; label: string; min_age: number | null; max_age: number | null;
  time_slot_id: string | null; is_active: boolean; sort: number; created_at: string; updated_at: string;
};
export type CampPriceOptionRow = {
  id: string; org_id: string; program_id: string; edition_id: string | null; label: string; days_count: number;
  includes_lunch: boolean; price: number | string; currency: string | null; is_active: boolean; sort: number;
  created_at: string; updated_at: string;
};
export type DiscountRow = {
  id: string; org_id: string; name: string; description: string | null; kind: "percent" | "fixed_amount";
  value: number | string; currency: string | null; scope: "all" | "camps" | "training" | "program" | "service";
  scope_program_id: string | null; scope_service_id: string | null;
  rule: "promo_code" | "sibling" | "early_bird" | "manual"; code: string | null;
  max_redemptions: number | null; max_redemptions_per_family: number | null;
  valid_from: string | null; valid_until: string | null; sibling_min_position: number | null;
  early_bird_days_before: number | null; stackable: boolean; is_active: boolean; created_by: string | null;
  created_at: string; updated_at: string;
};
export type AppliedDiscountRow = {
  id: string; org_id: string; discount_id: string; registration_id: string | null; invoice_id: string | null;
  invoice_item_id: string | null; invoice_adjustment_id: string | null; source: string; source_id: string | null;
  family_id: string | null; athlete_id: string | null; rule: string; name: string; code: string | null; kind: string;
  value: number | string; amount: number | string; currency: string; reason: string | null; created_by: string | null;
  created_at: string; voided_at: string | null; void_reason: string | null;
};
export type CampRegistrationRow = Database["public"]["Tables"]["registrations"]["Row"] & {
  camp_edition_id: string | null; camp_price_option_id: string | null; camp_age_group_id: string | null;
  camp_days: string[] | null; camp_includes_lunch: boolean | null; invoice_id: string | null;
  price_list_amount: number | string | null; price_discount_amount: number | string | null;
  price_amount: number | string | null; price_currency: string | null; price_snapshot: Json | null;
};

type CampTables = {
  camp_editions: T<CampEditionRow>;
  camp_time_slots: T<CampTimeSlotRow>;
  camp_age_groups: T<CampAgeGroupRow>;
  camp_price_options: T<CampPriceOptionRow>;
  discounts: T<DiscountRow>;
  applied_discounts: T<AppliedDiscountRow>;
  registrations: T<CampRegistrationRow>;
  venues: T<{ id: string; org_id: string; name: string; address: string | null; city: string | null; postal_code: string | null; is_active: boolean }>;
};

type CampFunctions = {
  org_currency: { Args: { p_org: string }; Returns: string };
  register_camp: { Args: { p_payload: Json }; Returns: Json };
  apply_manual_discount: { Args: { p_registration: string; p_discount: string; p_reason?: string | null; p_amount?: number | null }; Returns: Json };
};

type Pub = Database["public"];
export type CampsDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Omit<Pub["Tables"], "registrations"> & CampTables;
    Functions: Pub["Functions"] & CampFunctions;
  };
};
export type CampsClient = SupabaseClient<CampsDatabase>;

/** RLS-scoped client (the signed-in user's session). */
export async function campsDb(): Promise<CampsClient> {
  return (await createClient()) as unknown as CampsClient;
}

/** Service-role client: public camp pages and register_camp only; always filter by org. */
export function campsAdminDb(): CampsClient {
  return createAdminClient() as unknown as CampsClient;
}
