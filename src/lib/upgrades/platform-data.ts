import "server-only";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import type { AddonRevenueRow } from "@/lib/platform/mrr";
import type { PlanRow } from "@/lib/platform/types";
import { upgradesUserDb, type AddonPriceRow, type FeatureGrantRow } from "./db";
import { getOrgFeatureContext, type OrgFeatureContext } from "./server";

/**
 * Platform console reads. Each one checks the caller is a platform admin
 * first; grants, plans and prices are read under the operator's own session
 * (RLS: is_platform_admin()). The per-tenant resolution reuses the same
 * resolver the app uses, so the console shows exactly what the club gets.
 */

export async function getAddonRevenueRows(): Promise<{ rows: AddonRevenueRow[]; pending: (FeatureGrantRow & { org_name: string })[] }> {
  await requirePlatformAdmin();
  const db = await upgradesUserDb();
  const [{ data }, { data: orgs }] = await Promise.all([
    db.from("org_feature_grants").select("*").in("kind", ["addon", "trial"]).limit(20000),
    db.from("organizations").select("id, name").limit(20000),
  ]);
  const rows = (data ?? []) as FeatureGrantRow[];
  const names = new Map(((orgs ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));
  return {
    rows,
    pending: rows
      .filter((r) => r.kind === "addon" && r.status === "pending")
      .map((r) => ({ ...r, org_name: names.get(r.org_id) ?? r.org_id }))
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1)),
  };
}

export async function getTenantEntitlements(orgId: string): Promise<OrgFeatureContext | null> {
  await requirePlatformAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return null;
  return getOrgFeatureContext(orgId);
}

export async function getFeatureMatrix(): Promise<{ plans: PlanRow[]; prices: AddonPriceRow[] }> {
  await requirePlatformAdmin();
  const db = await upgradesUserDb();
  const [{ data: plans }, { data: prices }] = await Promise.all([
    db.from("plans").select("*").order("sort_order"),
    db.from("feature_addon_prices").select("*"),
  ]);
  return { plans: (plans ?? []) as PlanRow[], prices: (prices ?? []) as AddonPriceRow[] };
}
