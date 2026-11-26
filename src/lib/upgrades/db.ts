import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlatformDatabase } from "@/lib/platform/types";

/**
 * Typed view of migration 20250420102100_feature_upgrades.sql (feature
 * catalog, add-on prices, per-club grants, plan-change request columns),
 * layered on the platform tables. Kept local (like src/lib/operations/db.ts)
 * so parallel tracks do not fight over src/types/database.ts.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type PlatformFeatureRow = {
  key: string;
  category: string;
  is_core: boolean;
  default_tier: string | null;
  requires: string[];
  sort_order: number;
  label: string;
  is_active: boolean;
  stripe_product_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AddonPriceRow = {
  feature_key: string;
  currency: "CHF" | "EUR" | "USD";
  amount: number;
  stripe_price_id: string | null;
  is_active: boolean;
  updated_at: string;
};

export type FeatureGrantRow = {
  id: string;
  org_id: string;
  feature_key: string;
  kind: "addon" | "trial" | "complimentary" | "founding" | "complimentary_all" | "block";
  status: "pending" | "active" | "canceling" | "canceled" | "expired";
  starts_at: string;
  ends_at: string | null;
  currency: string | null;
  amount: number | null;
  stripe_subscription_item_id: string | null;
  requested_by: string | null;
  granted_by: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type PendingPlanColumns = {
  pending_plan_code: string | null;
  pending_plan_effective_at: string | null;
  pending_plan_requested_at: string | null;
  pending_plan_requested_by: string | null;
};

type P = PlatformDatabase["public"];
type Sub = P["Tables"]["subscriptions"]["Row"] & PendingPlanColumns;

export type UpgradesDatabase = {
  public: {
    Tables: Omit<P["Tables"], "subscriptions"> & {
      subscriptions: T<Sub>;
      platform_features: T<PlatformFeatureRow>;
      feature_addon_prices: T<AddonPriceRow>;
      org_feature_grants: T<FeatureGrantRow>;
    };
    Views: P["Views"];
    Functions: P["Functions"] & {
      org_feature_enabled: { Args: { p_org: string; p_key: string }; Returns: boolean };
      platform_set_feature_grant: {
        Args: { p_org: string; p_key: string; p_kind: string; p_ends_at?: string | null; p_note?: string | null };
        Returns: string;
      };
      platform_update_feature_grant: { Args: { p_grant: string; p_status: string }; Returns: undefined };
      platform_set_plan_feature: { Args: { p_plan: string; p_key: string; p_included: boolean }; Returns: undefined };
      platform_set_addon_price: {
        Args: { p_key: string; p_currency: string; p_amount: number | null; p_stripe_price_id?: string | null };
        Returns: undefined;
      };
    };
    Enums: P["Enums"];
    CompositeTypes: P["CompositeTypes"];
  };
};

export type UpgradesClient = SupabaseClient<UpgradesDatabase>;

/** Service-role client (bypasses RLS): server-only, always filter by org_id. */
export function upgradesAdminDb(): UpgradesClient {
  return createAdminClient() as unknown as UpgradesClient;
}

/** The caller's own session (RLS applies): platform RPCs, own-club reads. */
export async function upgradesUserDb(): Promise<UpgradesClient> {
  return (await createClient()) as unknown as UpgradesClient;
}
