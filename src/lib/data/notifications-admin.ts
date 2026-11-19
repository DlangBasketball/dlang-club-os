import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";

async function orgOf(): Promise<string | null> {
  const me = await getSessionUser();
  return me?.orgId ?? null;
}

export type EmailLog = {
  id: string; toEmail: string; subject: string | null; template: string | null;
  status: string; attempts: number; error: string | null; createdAt: string; sentAt: string | null;
};

export async function listEmailLogs(filter: "all" | "failed" | "sent" = "all", limit = 100): Promise<EmailLog[]> {
  const orgId = await orgOf();
  if (!orgId) return [];
  const admin = createAdminClient();
  let q = admin.from("email_logs").select("id,to_email,subject,template,status,attempts,error,created_at,sent_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(limit);
  if (filter === "failed") q = q.eq("status", "failed");
  if (filter === "sent") q = q.in("status", ["sent", "delivered"]);
  const { data } = await q;
  return (data ?? []).map((r) => ({ id: r.id, toEmail: r.to_email, subject: r.subject, template: r.template, status: r.status, attempts: r.attempts ?? 0, error: r.error, createdAt: r.created_at, sentAt: r.sent_at }));
}

export async function emailStats(): Promise<{ sent: number; failed: number; queued: number; total: number }> {
  const orgId = await orgOf();
  if (!orgId) return { sent: 0, failed: 0, queued: 0, total: 0 };
  const admin = createAdminClient();
  const { data } = await admin.from("email_logs").select("status").eq("org_id", orgId);
  const rows = data ?? [];
  return {
    sent: rows.filter((r) => r.status === "sent" || r.status === "delivered").length,
    failed: rows.filter((r) => r.status === "failed" || r.status === "bounced").length,
    queued: rows.filter((r) => r.status === "queued").length,
    total: rows.length,
  };
}

export type AdminNotif = { id: string; title: string; body: string | null; type: string; recipientName: string; createdAt: string; readAt: string | null };

export async function listRecentNotifications(limit = 25): Promise<AdminNotif[]> {
  const orgId = await orgOf();
  if (!orgId) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("notifications").select("id,title,body,type,recipient_id,created_at,read_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(limit);
  const ids = Array.from(new Set((data ?? []).map((n) => n.recipient_id).filter((x): x is string => Boolean(x))));
  const profs = ids.length ? (await admin.from("profiles").select("id,full_name,email").in("id", ids)).data ?? [] : [];
  const nameById = new Map(profs.map((p) => [p.id, p.full_name ?? p.email]));
  return (data ?? []).map((n) => ({ id: n.id, title: n.title, body: n.body, type: n.type, recipientName: n.recipient_id ? nameById.get(n.recipient_id) ?? "—" : "—", createdAt: n.created_at, readAt: n.read_at }));
}

/** Counts for the bulk-reminder UI: how many overdue invoices and how many parents. */
export async function reminderTargets(): Promise<{ overdueInvoices: number; parents: number }> {
  const orgId = await orgOf();
  if (!orgId) return { overdueInvoices: 0, parents: 0 };
  const admin = createAdminClient();
  const [{ count: overdue }, fams] = await Promise.all([
    admin.from("invoices").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "overdue").eq("reminders_paused", false),
    admin.from("families").select("id").eq("org_id", orgId),
  ]);
  const famIds = (fams.data ?? []).map((f) => f.id);
  const members = famIds.length ? (await admin.from("family_members").select("profile_id").in("family_id", famIds)).data ?? [] : [];
  const parents = new Set(members.map((m) => m.profile_id)).size;
  return { overdueInvoices: overdue ?? 0, parents };
}
