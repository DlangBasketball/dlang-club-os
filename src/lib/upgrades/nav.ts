import "server-only";
import type { SessionUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { routeFeatureMap } from "./catalog";
import { lockedHrefs } from "./resolve";
import { getOrgFeatureContext } from "./server";

/**
 * Nav entries of modules outside the club's plan.
 *   admin app (admins + finance): shown with an "Upgrade" badge by default, or
 *     hidden when the club turned app_settings.settings.upgrades_show_locked off;
 *   coach & parent apps: always hidden (members never see upsell or prices).
 * The pages themselves are gated server-side (FeatureGate / requireFeature);
 * this only shapes the menu.
 */
export async function upgradeNav(user: SessionUser, area: "admin" | "coach" | "parent"): Promise<{ hidden: string[]; locked: string[] }> {
  if (!user.orgId) return { hidden: [], locked: [] };
  try {
    const ctx = await getOrgFeatureContext(user.orgId);
    const locked = lockedHrefs(routeFeatureMap(area), ctx.access);
    if (area !== "admin") return { hidden: locked, locked: [] };
    const { data } = await createAdminClient().from("app_settings").select("settings").eq("org_id", user.orgId).maybeSingle();
    const show = (data?.settings as Record<string, unknown> | null)?.upgrades_show_locked !== false;
    return show ? { hidden: [], locked } : { hidden: locked, locked: [] };
  } catch {
    return { hidden: [], locked: [] };
  }
}

/** The club's "show locked modules" preference (default on). */
export async function showLockedModules(orgId: string): Promise<boolean> {
  const { data } = await createAdminClient().from("app_settings").select("settings").eq("org_id", orgId).maybeSingle();
  return (data?.settings as Record<string, unknown> | null)?.upgrades_show_locked !== false;
}
