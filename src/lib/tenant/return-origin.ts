import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { tenantReturnOrigin } from "./url";

/**
 * Server-side origin for Stripe return links of `orgId` (Checkout
 * success/cancel, Connect onboarding refresh/return). The org's hosts come
 * from its organizations row (service client, filtered by id); the current
 * request's Host is only used when it is one of those hosts or the platform
 * host. Outside a request (webhooks, jobs) the org's canonical host is used.
 */
export async function orgReturnOrigin(orgId: string): Promise<string> {
  let requestHost: string | null = null;
  try {
    requestHost = (await headers()).get("host");
  } catch {
    requestHost = null;
  }

  type OrgHosts = { slug: string | null; custom_domain: string | null };
  let org: OrgHosts | null = null;
  try {
    const { data } = await createAdminClient()
      .from("organizations")
      .select("slug,custom_domain")
      .eq("id", orgId)
      .maybeSingle();
    org = (data as OrgHosts | null) ?? null;
  } catch {
    org = null;
  }

  return tenantReturnOrigin({ slug: org?.slug, customDomain: org?.custom_domain }, requestHost);
}
