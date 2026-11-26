import { hasFeature } from "@/lib/upgrades/server";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant, resolveTenant } from "@/lib/tenant/server";
import { hostNamesOtherClub } from "@/lib/training/format";
import { isValidSlug } from "@/lib/tenant/host";
import type { Tenant } from "@/lib/tenant/types";
import { logError } from "@/lib/log";
import { rowToWebsiteSettings, type WebsiteSettings } from "./settings-shape";

/**
 * Server-side website-connection reads. Service-role client: EVERY query is
 * filtered by an org id that the server resolved itself (request host or the
 * ?club= slug, checked against the host), never by a client-supplied id.
 * Loosely typed until src/types/database.ts is regenerated.
 */
export type WebsiteDb = SupabaseClient<any, "public", any>;

export function websiteDb(): WebsiteDb {
  return createAdminClient() as unknown as WebsiteDb;
}

export async function getWebsiteSettings(orgId: string, db: WebsiteDb = websiteDb()): Promise<WebsiteSettings> {
  try {
    const { data } = await db.from("website_settings").select("*").eq("org_id", orgId).maybeSingle();
    return rowToWebsiteSettings(orgId, data as Record<string, unknown> | null);
  } catch (e) {
    logError("website.settings", e);
    return rowToWebsiteSettings(orgId, null);
  }
}

export type PublicClub = { tenant: Tenant & { id: string }; settings: WebsiteSettings };

/**
 * Club of a public website request: ?club=<slug>, else the request host's
 * club. A host that names a club (its subdomain / custom domain) only serves
 * that club. Unknown, suspended or not-connected clubs -> null (404).
 */
export async function resolvePublicClub(clubParam: string | null | undefined): Promise<PublicClub | null> {
  const host = await getTenant();
  const slug = typeof clubParam === "string" && clubParam.trim() ? clubParam.trim().toLowerCase() : null;
  if (slug && !isValidSlug(slug)) return null;
  if (slug && hostNamesOtherClub(host, slug)) return null;
  const tenant = slug && slug !== host.slug ? await resolveTenant({ slug }) : host;
  if (!tenant.id || tenant.source === "unknown" || tenant.status === "suspended") return null;
  if (!(await hasFeature(tenant.id, "website_connect"))) return null;
  const settings = await getWebsiteSettings(tenant.id);
  if (!settings.enabled) return null;
  return { tenant: tenant as Tenant & { id: string }, settings };
}
