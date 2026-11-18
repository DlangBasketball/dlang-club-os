"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, postLoginDestination } from "@/lib/auth/get-user";
import { familyAdminDb, familyDb } from "@/lib/family/db";
import { fail, failDb, type FamilyResult } from "@/lib/family/action-helpers";
import { switchOrgSchema } from "@/lib/family/validation";
import { getTenant } from "@/lib/tenant/server";
import { tenantBaseUrl, tenantLink } from "@/lib/tenant/url";

/**
 * Switch the current club. The database (switch_current_org) only allows an
 * org where the person has an active membership and audits the switch in
 * both clubs; the client only names the target org.
 * Returns where to go next: the role home in the new club, on the club's own
 * host when the request came through a club-specific host.
 */
export async function switchOrg(input: { orgId: string }): Promise<FamilyResult<{ href: string }>> {
  const me = await getSessionUser();
  if (!me) return fail("forbidden");
  const p = switchOrgSchema.safeParse(input);
  if (!p.success) return fail("invalid");
  if (p.data.orgId === me.orgId) return { ok: true, data: { href: postLoginDestination(me) } };

  const db = await familyDb();
  const { error } = await db.rpc("switch_current_org", { p_org: p.data.orgId });
  if (error) return failDb("family.switchOrg", error);

  revalidatePath("/", "layout");
  const after = await getSessionUser();
  const path = after ? postLoginDestination(after) : "/";
  const tenant = await getTenant();
  if (tenant.source === "subdomain" || tenant.source === "custom_domain") {
    const { data: org } = await familyAdminDb().from("organizations").select("slug,custom_domain").eq("id", p.data.orgId).maybeSingle();
    const o = org as { slug?: string | null; custom_domain?: string | null } | null;
    return { ok: true, data: { href: tenantLink(tenantBaseUrl({ slug: o?.slug, customDomain: o?.custom_domain }), path) } };
  }
  return { ok: true, data: { href: path } };
}
