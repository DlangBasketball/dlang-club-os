"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppRole } from "@/lib/auth/roles";

export type ActionResult = { ok: true } | { ok: false; error: string };
const STAFF_ROLES: AppRole[] = ["admin", "finance", "coach"];

async function getAdmin() {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return null;
  return me as typeof me & { orgId: string };
}

export async function assignRole(profileId: string, role: string): Promise<ActionResult> {
  const me = await getAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  if (!STAFF_ROLES.includes(role as AppRole)) return { ok: false, error: "Unknown role" };
  const r = role as AppRole;
  const admin = createAdminClient();
  const { data: existing } = await admin.from("staff_roles").select("id").eq("org_id", me.orgId).eq("profile_id", profileId).eq("role", r).maybeSingle();
  if (existing) return { ok: true };
  const { error } = await admin.from("staff_roles").insert({ org_id: me.orgId, profile_id: profileId, role: r });
  if (error) return { ok: false, error: error.message };
  await admin.from("audit_logs").insert({ org_id: me.orgId, actor_id: me.id, action: "staff.assign_role", target_table: "staff_roles", target_id: profileId, new_data: { role } });
  revalidatePath("/admin/settings/staff");
  return { ok: true };
}

export async function removeRole(profileId: string, role: string): Promise<ActionResult> {
  const me = await getAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  if (profileId === me.id && role === "admin") return { ok: false, error: "You can't remove your own admin role" };
  const admin = createAdminClient();
  const { error } = await admin.from("staff_roles").delete().eq("org_id", me.orgId).eq("profile_id", profileId).eq("role", role as AppRole);
  if (error) return { ok: false, error: error.message };
  await admin.from("audit_logs").insert({ org_id: me.orgId, actor_id: me.id, action: "staff.remove_role", target_table: "staff_roles", target_id: profileId, new_data: { role } });
  revalidatePath("/admin/settings/staff");
  return { ok: true };
}
