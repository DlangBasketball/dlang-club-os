import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Display name of a tenant (for email sender names and headers). Server only. */
export async function getOrgName(orgId: string | null | undefined): Promise<string | null> {
  if (!orgId) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? null;
}
