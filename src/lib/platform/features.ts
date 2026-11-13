import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FeatureKey } from "./catalog";
import {
  entitlementAllows,
  evaluateLimit,
  resolveEntitlements,
  type Entitlements,
  type LimitCheck,
  type LimitResource,
} from "./entitlements";
import { asPlatform, type PlanRow, type SubscriptionRow } from "./types";

/**
 * Feature gating & plan limits for a tenant (server-side).
 *
 *   if (!(await hasFeature(me.orgId, "bookings"))) return upsell();
 *   const lim = await checkLimit(me.orgId, "athletes");
 *   if (!lim.allowed) return { error: `Plan limit reached (${lim.limit})` };
 *
 * Reads with the service-role client (the caller has already resolved which
 * org it acts for), memoised per request. The database mirror
 * public.org_has_feature() / org_within_limit() can be used inside SQL.
 */

type OrgRef = string | { id: string } | { orgId: string } | Entitlements;

function orgIdOf(org: OrgRef): string {
  if (typeof org === "string") return org;
  if ("orgId" in org) return org.orgId;
  return org.id;
}

function isEntitlements(org: OrgRef): org is Entitlements {
  return typeof org === "object" && org !== null && "features" in org && "limits" in org;
}

export const getEntitlements = cache(async (orgId: string): Promise<Entitlements> => {
  const db = asPlatform(createAdminClient());
  const [{ data: sub }, { data: org }] = await Promise.all([
    db.from("subscriptions").select("*").eq("org_id", orgId).maybeSingle(),
    db.from("organizations").select("id, suspended_at").eq("id", orgId).maybeSingle(),
  ]);
  let plan: PlanRow | null = null;
  if (sub?.plan_code) {
    const { data } = await db.from("plans").select("*").eq("code", sub.plan_code).maybeSingle();
    plan = (data as PlanRow | null) ?? null;
  }
  return resolveEntitlements(orgId, (sub as SubscriptionRow | null) ?? null, plan, Boolean(org?.suspended_at));
});

/** True when the org's live subscription grants `feature`. */
export async function hasFeature(org: OrgRef, feature: FeatureKey | string): Promise<boolean> {
  const ent = isEntitlements(org) ? org : await getEntitlements(orgIdOf(org));
  return entitlementAllows(ent, feature);
}

async function countUsage(orgId: string, resource: LimitResource): Promise<number> {
  const db = createAdminClient();
  if (resource === "athletes") {
    const { count } = await db
      .from("athletes")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .neq("status", "archived");
    return count ?? 0;
  }
  const { data } = await db.from("staff_roles").select("profile_id").eq("org_id", orgId);
  return new Set((data ?? []).map((r) => r.profile_id)).size;
}

/** Whether `adding` more athletes/staff fits in the org's plan. */
export async function checkLimit(org: OrgRef, resource: LimitResource, adding = 1): Promise<LimitCheck> {
  const orgId = orgIdOf(org);
  const ent = isEntitlements(org) ? org : await getEntitlements(orgId);
  const used = await countUsage(orgId, resource);
  return evaluateLimit(ent, resource, used, adding);
}

/** Throws a typed error when the feature is missing — handy in server actions. */
export class FeatureNotAvailableError extends Error {
  constructor(public readonly feature: string) {
    super(`FEATURE_NOT_AVAILABLE:${feature}`);
  }
}

export async function requireFeature(org: OrgRef, feature: FeatureKey | string): Promise<void> {
  if (!(await hasFeature(org, feature))) throw new FeatureNotAvailableError(feature);
}
