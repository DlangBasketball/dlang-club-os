import type { Tenant } from "@/lib/tenant/types";

/** Path of the public club hub (works on every host, including the platform host). */
export const CLUB_HUB_PATH = "/club";

/**
 * Whether a signed-out visitor at "/" sees the club hub. Only on a host that
 * names a club (its subdomain or custom domain); the platform host keeps its
 * existing behaviour (sign-in), so it never shows one club to everyone.
 */
export function showsHubAtRoot(tenant: Pick<Tenant, "id" | "source">): boolean {
  return Boolean(tenant.id) && (tenant.source === "subdomain" || tenant.source === "custom_domain");
}
