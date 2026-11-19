import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";

export type AuditEntry = { id: string; actorName: string; action: string; targetTable: string | null; targetId: string | null; createdAt: string };

export async function listAuditLogs(opts?: { table?: string; limit?: number }): Promise<AuditEntry[]> {
  const me = await getSessionUser();
  if (!me?.orgId) return [];
  const admin = createAdminClient();
  let q = admin.from("audit_logs").select("id,actor_id,action,target_table,target_id,created_at").eq("org_id", me.orgId).order("created_at", { ascending: false }).limit(opts?.limit ?? 100);
  if (opts?.table) q = q.eq("target_table", opts.table);
  const { data } = await q;
  const rows = data ?? [];
  const ids = Array.from(new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x)));
  const profs = ids.length ? (await admin.from("profiles").select("id,full_name,email").in("id", ids)).data ?? [] : [];
  const name = new Map(profs.map((p) => [p.id, p.full_name ?? p.email]));
  return rows.map((r) => ({ id: String(r.id), actorName: r.actor_id ? name.get(r.actor_id) ?? "—" : "System", action: r.action, targetTable: r.target_table, targetId: r.target_id, createdAt: r.created_at }));
}

export async function auditTables(): Promise<string[]> {
  const me = await getSessionUser();
  if (!me?.orgId) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("audit_logs").select("target_table").eq("org_id", me.orgId).limit(1000);
  return Array.from(new Set((data ?? []).map((r) => r.target_table).filter((x): x is string => !!x))).sort();
}
