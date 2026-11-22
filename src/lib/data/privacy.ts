import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";
import { must } from "@/lib/data/must";

export type DeletionRequest = { id: string; familyName: string; requestedBy: string; reason: string | null; status: string; createdAt: string };

export async function listDeletionRequests(): Promise<DeletionRequest[]> {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return [];
  const admin = createAdminClient();
  const rows = must(await admin.from("deletion_requests").select("id,family_id,requested_by,reason,status,created_at").eq("org_id", me.orgId).order("created_at", { ascending: false }), "deletion requests");
  const fam = rows.map((r) => r.family_id);
  const prof = rows.map((r) => r.requested_by).filter((x): x is string => !!x);
  const [families, profiles] = await Promise.all([
    fam.length ? admin.from("families").select("id,name").in("id", fam) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    prof.length ? admin.from("profiles").select("id,full_name,email").in("id", prof) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
  ]);
  const fName = new Map((families.data ?? []).map((f) => [f.id, f.name]));
  const pName = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name ?? p.email]));
  return rows.map((r) => ({ id: r.id, familyName: fName.get(r.family_id) ?? "—", requestedBy: r.requested_by ? pName.get(r.requested_by) ?? "—" : "—", reason: r.reason, status: r.status, createdAt: r.created_at }));
}

/** The current parent's family id (first family they guard), for self-service data tools. */
export async function getMyFamilyId(): Promise<string | null> {
  const me = await getSessionUser();
  if (!me) return null;
  if (!me?.orgId) return null;
  const admin = createAdminClient();
  // Only a family of the CURRENT club (a person may be a guardian in several clubs).
  const { data: links } = await admin.from("family_members").select("family_id").eq("profile_id", me.id);
  const ids = (links ?? []).map((l) => l.family_id);
  if (!ids.length) return null;
  const { data } = await admin.from("families").select("id").in("id", ids).eq("org_id", me.orgId).limit(1).maybeSingle();
  return data?.id ?? null;
}
