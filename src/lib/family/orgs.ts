import "server-only";
import type { AppRole } from "@/lib/auth/roles";
import { logError } from "@/lib/log";
import { familyDb } from "./db";

export type MyOrg = { id: string; name: string; roles: AppRole[]; current: boolean };

/**
 * The signed-in person's clubs (active memberships). Open invitations sent
 * to their email are claimed first, so a second club shows up right away.
 */
export async function getMyOrgs(): Promise<MyOrg[]> {
  try {
    const db = await familyDb();
    await db.rpc("claim_my_invitations");
    const { data, error } = await db.rpc("my_org_memberships");
    if (error) {
      logError("family.myOrgs", error);
      return [];
    }
    return (data ?? []).map((r) => ({ id: r.org_id, name: r.name, roles: r.roles ?? [], current: Boolean(r.is_current) }));
  } catch (e) {
    logError("family.myOrgs", e);
    return [];
  }
}
