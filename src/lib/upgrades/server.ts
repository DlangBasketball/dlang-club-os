import "server-only";
import { cache } from "react";
import { getSessionUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSubscriptionLive } from "@/lib/platform/entitlements";
import type { PlanRow, SubscriptionRow } from "@/lib/platform/types";
import { isCoreFeature } from "./catalog";
import { upgradesAdminDb, type AddonPriceRow, type FeatureGrantRow, type PendingPlanColumns } from "./db";
import { isEnabled, resolveFeatures, type AccessMap, type PlanLite, type ResolveInput } from "./resolve";

/**
 * Server-side feature gating — THE single entry point:
 *
 *   if (!(await hasFeature(orgId, "accounting"))) return notFound();
 *   await requireFeature(orgId, "ops_equipment");      // throws FeatureNotAvailableError
 *   await assertFeature("payment_plans");               // the signed-in user's club
 *
 * The org id always comes from the server (session profile, the org that owns
 * a public slug, or the org a webhook maps to) — never from the client.
 * Reads use the service role filtered by that org id and are memoised per
 * request (React cache). Mirrors public.org_feature_enabled() in SQL.
 */

export class FeatureNotAvailableError extends Error {
  constructor(public readonly feature: string) {
    super(`FEATURE_NOT_AVAILABLE:${feature}`);
    this.name = "FeatureNotAvailableError";
  }
}

export type OrgFeatureContext = {
  orgId: string;
  input: ResolveInput;
  access: AccessMap;
  subscription: (SubscriptionRow & PendingPlanColumns) | null;
  plans: PlanRow[];
  grants: FeatureGrantRow[];
};

type LegacyAiRow = { scope: string; source: string; status: string; starts_at: string | null; ends_at: string | null };

function legacyAiSource(rows: LegacyAiRow[], now: Date): "paid_addon" | "complimentary" | null {
  const t = now.getTime();
  for (const r of rows) {
    if (r.scope !== "org" || r.status !== "active") continue;
    if (r.starts_at && new Date(r.starts_at).getTime() > t) continue;
    if (r.ends_at && new Date(r.ends_at).getTime() <= t) continue;
    if (r.source === "complimentary" || r.source === "paid_addon") return r.source;
  }
  return null;
}

export function pricesByFeature(rows: Pick<AddonPriceRow, "feature_key" | "currency" | "amount" | "is_active">[]) {
  const out: Record<string, Record<string, number | null>> = {};
  for (const r of rows) {
    if (!r.is_active) continue;
    (out[r.feature_key] ??= {})[r.currency] = Number(r.amount);
  }
  return out;
}

async function loadContext(orgId: string, now = new Date()): Promise<OrgFeatureContext> {
  const db = upgradesAdminDb();
  const [subRes, orgRes, plansRes, grantsRes, pricesRes, aiRes] = await Promise.all([
    db.from("subscriptions").select("*").eq("org_id", orgId).maybeSingle(),
    db.from("organizations").select("id, suspended_at, currency").eq("id", orgId).maybeSingle(),
    db.from("plans").select("*").order("sort_order"),
    db.from("org_feature_grants").select("*").eq("org_id", orgId),
    db.from("feature_addon_prices").select("feature_key, currency, amount, is_active"),
    createAiQuery(orgId),
  ]);
  const sub = (subRes.data as (SubscriptionRow & PendingPlanColumns) | null) ?? null;
  const suspended = Boolean(orgRes.data?.suspended_at);
  const plans = (plansRes.data ?? []) as PlanRow[];
  const grants = (grantsRes.data ?? []) as FeatureGrantRow[];
  const currency = sub?.currency ?? (orgRes.data?.currency as string | null) ?? "CHF";
  const input: ResolveInput = {
    planCode: sub?.plan_code ?? null,
    plans: plans as unknown as PlanLite[],
    live: isSubscriptionLive(sub, suspended, now),
    suspended,
    overrides: sub?.feature_overrides ?? {},
    grants,
    currency,
    prices: pricesByFeature((pricesRes.data ?? []) as AddonPriceRow[]),
    legacyAi: legacyAiSource((aiRes.data ?? []) as LegacyAiRow[], now),
    now,
  };
  return { orgId, input, access: resolveFeatures(input), subscription: sub, plans, grants };
}

function createAiQuery(orgId: string) {
  return createAdminClient().from("ai_assistant_addons").select("scope, source, status, starts_at, ends_at").eq("org_id", orgId);
}

/** Everything needed to show / decide a club's features. Memoised per request. */
export const getOrgFeatureContext = cache(async (orgId: string): Promise<OrgFeatureContext> => loadContext(orgId));

/** Per-feature access for a club. Memoised per request. */
export async function getFeatureAccess(orgId: string): Promise<AccessMap> {
  return (await getOrgFeatureContext(orgId)).access;
}

/** True when the club may use `feature` right now (core features: always). */
export async function hasFeature(orgId: string | null | undefined, feature: string): Promise<boolean> {
  if (isCoreFeature(feature)) return true;
  if (!orgId) return false;
  return isEnabled(await getFeatureAccess(orgId), feature);
}

/** Throws FeatureNotAvailableError when the club does not have `feature`. */
export async function requireFeature(orgId: string | null | undefined, feature: string): Promise<void> {
  if (!(await hasFeature(orgId, feature))) throw new FeatureNotAvailableError(feature);
}

/**
 * Server-action guard for the signed-in user's own club. Without a session it
 * does nothing: the action's own auth check refuses the call (public actions
 * gate explicitly with requireFeature(orgOfSlug, key)).
 */
export async function assertFeature(feature: string): Promise<void> {
  const me = await getSessionUser();
  if (!me?.orgId) return;
  await requireFeature(me.orgId, feature);
}

/**
 * Clubs that have `feature` (crons / batch jobs): one batch read instead of
 * one per club. Scheduled jobs of a module skip every club without it.
 */
export type OrgSet = { has: (orgId: string) => boolean; ids: string[] };

export async function orgsWithFeature(feature: string, now = new Date()): Promise<OrgSet> {
  const db = upgradesAdminDb();
  const [subs, orgs, plans, grants, ai] = await Promise.all([
    db.from("subscriptions").select("*"),
    db.from("organizations").select("id, suspended_at, currency"),
    db.from("plans").select("*"),
    db.from("org_feature_grants").select("*").in("status", ["active", "canceling"]),
    createAdminClient().from("ai_assistant_addons").select("org_id, scope, source, status, starts_at, ends_at"),
  ]);
  const subByOrg = new Map(((subs.data ?? []) as SubscriptionRow[]).map((s) => [s.org_id, s]));
  const grantsByOrg = new Map<string, FeatureGrantRow[]>();
  for (const g of (grants.data ?? []) as FeatureGrantRow[]) grantsByOrg.set(g.org_id, [...(grantsByOrg.get(g.org_id) ?? []), g]);
  const aiByOrg = new Map<string, LegacyAiRow[]>();
  for (const r of ai.data ?? []) aiByOrg.set(r.org_id, [...(aiByOrg.get(r.org_id) ?? []), r]);
  const allowed = new Set<string>();
  const core = isCoreFeature(feature);
  for (const o of (orgs.data ?? []) as { id: string; suspended_at: string | null; currency: string | null }[]) {
    const sub = subByOrg.get(o.id) ?? null;
    const suspended = Boolean(o.suspended_at);
    const access = resolveFeatures({
      planCode: sub?.plan_code ?? null,
      plans: (plans.data ?? []) as unknown as PlanLite[],
      live: isSubscriptionLive(sub, suspended, now),
      suspended,
      overrides: sub?.feature_overrides ?? {},
      grants: grantsByOrg.get(o.id) ?? [],
      currency: sub?.currency ?? o.currency ?? "CHF",
      prices: null,
      legacyAi: legacyAiSource(aiByOrg.get(o.id) ?? [], now),
      now,
    });
    if (core || isEnabled(access, feature)) allowed.add(o.id);
  }
  return { has: (orgId: string) => allowed.has(orgId), ids: Array.from(allowed) };
}
