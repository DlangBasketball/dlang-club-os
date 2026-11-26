import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/log";

/**
 * Plan comparison for the prospect demo page, read from the platform plan
 * catalogue (public.plans, seeded from FEATURE_CATALOG tiers). No prices:
 * pricing is confirmed on the walkthrough.
 */
export const DEMO_PLAN_CODES = ["starter", "club", "academy", "federation"] as const;
export const DEMO_PLAN_FEATURES = [
  "registration",
  "invoicing",
  "online_payments",
  "camps",
  "multi_team",
  "coach_app",
  "reminders",
  "bookings",
  "member_cards",
  "multi_location",
  "federation_rollup",
] as const;

export type DemoPlan = {
  code: (typeof DEMO_PLAN_CODES)[number];
  maxAthletes: number | null;
  maxStaff: number | null;
  features: Record<(typeof DEMO_PLAN_FEATURES)[number], boolean>;
};

type PlanRow = { code: string; max_athletes: number | null; max_staff: number | null; features: Record<string, unknown> | null; sort_order: number };
type PlanQuery = {
  from(table: "plans"): {
    select(cols: string): {
      in(col: string, v: string[]): {
        eq(col: string, v: boolean): { order(col: string): PromiseLike<{ data: PlanRow[] | null; error: unknown }> };
      };
    };
  };
};

export async function getDemoPlans(): Promise<DemoPlan[]> {
  // public.plans is not in the generated types (platform catalogue table).
  const { data, error } = await (createAdminClient() as unknown as PlanQuery)
    .from("plans")
    .select("code,max_athletes,max_staff,features,sort_order")
    .in("code", [...DEMO_PLAN_CODES])
    .eq("is_active", true)
    .order("sort_order");
  if (error) {
    logError("demo.plans", error);
    return [];
  }
  return (data ?? []).map((p) => {
    const f = (p.features ?? {}) as Record<string, unknown>;
    return {
      code: p.code as DemoPlan["code"],
      maxAthletes: p.max_athletes,
      maxStaff: p.max_staff,
      features: Object.fromEntries(DEMO_PLAN_FEATURES.map((k) => [k, f[k] === true])) as DemoPlan["features"],
    };
  });
}
