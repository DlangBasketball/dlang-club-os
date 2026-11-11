import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

/**
 * Types for the SaaS operator layer (migration 20250420091700_platform_saas).
 *
 * Kept OUT of src/types/database.ts on purpose (so parallel tracks don't fight
 * over that file): `asPlatform(client)` re-types any Supabase client so the
 * platform tables and RPCs are known to the query builder. Once the schema
 * types are regenerated with `npm run types` this cast becomes a no-op.
 */

export type Currency = "CHF" | "EUR" | "USD";
export type BillingInterval = "month" | "year";
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "paused";
export type DomainStatus = "pending" | "verified" | "failed" | "disabled";

export type PlanRow = {
  code: string;
  name: string;
  tagline: string | null;
  description: string | null;
  audience: string | null;
  sort_order: number;
  is_public: boolean;
  is_active: boolean;
  is_custom: boolean;
  trial_days: number;
  max_athletes: number | null;
  max_staff: number | null;
  features: Record<string, boolean>;
  created_at: string;
  updated_at: string;
};

export type PlanPriceRow = {
  plan_code: string;
  currency: Currency;
  billing_interval: BillingInterval;
  amount: number;
  stripe_price_id: string | null;
  updated_at: string;
};

export type SubscriptionRow = {
  id: string;
  org_id: string;
  plan_code: string;
  status: SubscriptionStatus;
  currency: Currency;
  billing_interval: BillingInterval;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  feature_overrides: Record<string, boolean>;
  limit_overrides: Record<string, number | null>;
  custom_amount: number | null;
  last_stripe_event_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type UsageSnapshotRow = {
  id: string;
  org_id: string;
  captured_on: string;
  athletes: number;
  staff: number;
  families: number;
  programs: number;
  registrations_30d: number;
  invoices_30d: number;
  invoiced_30d: number;
  created_at: string;
};

export type TenantDomainRow = {
  id: string;
  org_id: string;
  domain: string;
  status: DomainStatus;
  verification_token: string;
  is_primary: boolean;
  verified_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type BillingEventRow = {
  id: string;
  type: string;
  org_id: string | null;
  received_at: string;
  processed_at: string | null;
  attempts: number;
  error: string | null;
  payload: Json | null;
};

export type PlatformAuditRow = {
  id: number;
  actor_id: string | null;
  action: string;
  org_id: string | null;
  details: Json;
  created_at: string;
};

export type PlatformOrgRow = {
  id: string;
  name: string;
  slug: string;
  country: string | null;
  currency: string | null;
  sport: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type TenantOverviewRow = {
  org_id: string;
  name: string;
  slug: string | null;
  sport: string | null;
  country: string | null;
  currency: string | null;
  created_at: string;
  suspended_at: string | null;
  plan_code: string | null;
  plan_name: string | null;
  status: SubscriptionStatus | null;
  billing_interval: BillingInterval | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  athletes: number;
  staff: number;
  max_athletes: number | null;
  max_staff: number | null;
  mrr: number;
};

export type SignupPlan = {
  code: string;
  name: string;
  tagline: string | null;
  isCustom: boolean;
  maxAthletes: number | null;
  prices: { currency: string; interval: string; amount: number }[];
};

export type SignupValues = {
  name: string;
  slug: string;
  sport: string;
  country: string;
  currency: Currency;
  locale: string;
  fullName: string;
  plan: string;
};

type Loose = Record<string, unknown>;
type Table<Row> = { Row: Row; Insert: Loose; Update: Loose; Relationships: [] };

type PlatformTables = {
  platform_admins: Table<{ profile_id: string; note: string | null; created_by: string | null; created_at: string }>;
  plans: Table<PlanRow>;
  plan_prices: Table<PlanPriceRow>;
  subscriptions: Table<SubscriptionRow>;
  usage_snapshots: Table<UsageSnapshotRow>;
  tenant_domains: Table<TenantDomainRow>;
  billing_events: Table<BillingEventRow>;
  platform_audit_log: Table<PlatformAuditRow>;
  organizations: Table<PlatformOrgRow>;
};

type PlatformFunctions = {
  is_platform_admin: { Args: Record<string, never>; Returns: boolean };
  is_slug_available: { Args: { p_slug: string }; Returns: boolean };
  provision_tenant: {
    Args: {
      p_name: string;
      p_slug: string;
      p_sport: string;
      p_country: string;
      p_currency: string;
      p_locale?: string;
      p_full_name?: string | null;
      p_plan?: string;
    };
    Returns: Json;
  };
  org_has_feature: { Args: { p_org: string; p_feature: string }; Returns: boolean };
  org_within_limit: { Args: { p_org: string; p_resource: string; p_adding?: number }; Returns: boolean };
  capture_usage_snapshot: { Args: { p_org: string }; Returns: undefined };
  capture_all_usage_snapshots: { Args: Record<string, never>; Returns: number };
  platform_tenant_overview: { Args: Record<string, never>; Returns: TenantOverviewRow[] };
  platform_set_org_suspended: { Args: { p_org: string; p_suspended: boolean; p_reason?: string | null }; Returns: Json };
  platform_change_plan: {
    Args: {
      p_org: string;
      p_plan: string;
      p_status?: string | null;
      p_trial_ends_at?: string | null;
      p_custom_amount?: number | null;
    };
    Returns: Json;
  };
  platform_upsert_plan: { Args: { p_plan: Json; p_prices: Json }; Returns: Json };
};

type Base = Database["public"];

export type PlatformDatabase = {
  public: {
    Tables: Omit<Base["Tables"], keyof PlatformTables> & PlatformTables;
    Views: Base["Views"];
    Functions: Omit<Base["Functions"], keyof PlatformFunctions> & PlatformFunctions;
    Enums: Base["Enums"];
    CompositeTypes: Base["CompositeTypes"];
  };
};

export type PlatformClient = SupabaseClient<PlatformDatabase>;

/** Re-type a Supabase client so platform tables/RPCs are visible. No runtime effect. */
export function asPlatform(client: { from: unknown; rpc: unknown }): PlatformClient {
  return client as unknown as PlatformClient;
}
