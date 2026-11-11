import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";
import type { AppRole } from "@/lib/auth/roles";

export type StaffMember = { profileId: string; name: string; email: string; roles: string[] };
export type PendingInvite = { id: string; email: string; role: string; status: string; expiresAt: string | null };

const STAFF_ROLES: AppRole[] = ["admin", "finance", "coach"];

export async function listStaff(): Promise<StaffMember[]> {
  const me = await getSessionUser();
  if (!me?.orgId) return [];
  const admin = createAdminClient();
  const { data: roles } = await admin.from("staff_roles").select("profile_id,role").eq("org_id", me.orgId);
  const ids = Array.from(new Set((roles ?? []).map((r) => r.profile_id)));
  const profs = ids.length ? (await admin.from("profiles").select("id,full_name,email").in("id", ids)).data ?? [] : [];
  const pById = new Map(profs.map((p) => [p.id, p]));
  const byProfile = new Map<string, string[]>();
  for (const r of roles ?? []) { const a = byProfile.get(r.profile_id) ?? []; a.push(r.role); byProfile.set(r.profile_id, a); }
  return Array.from(byProfile.entries()).map(([pid, rs]) => { const p = pById.get(pid); return { profileId: pid, name: p?.full_name ?? "—", email: p?.email ?? "—", roles: rs }; });
}

export async function listPendingStaffInvites(): Promise<PendingInvite[]> {
  const me = await getSessionUser();
  if (!me?.orgId) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("invitations").select("id,email,role,status,expires_at").eq("org_id", me.orgId).in("role", STAFF_ROLES).neq("status", "accepted").order("created_at", { ascending: false });
  return (data ?? []).map((i) => ({ id: i.id, email: i.email, role: i.role, status: i.status, expiresAt: i.expires_at }));
}
