"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchMany, retryEmailLog } from "@/lib/notifications/dispatch";
import type { NotifVars } from "@/lib/notifications/templates";

export type BulkResult = { ok: true; sent: number; failed: number; inApp: number; targets: number } | { ok: false; error: string };

async function getAdmin() {
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) return null;
  return me as typeof me & { orgId: string };
}

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "";
}

/** Email + in-app reminder to every guardian of every overdue invoice. */
export async function sendOverdueReminders(): Promise<BulkResult> {
  const me = await getAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  const admin = createAdminClient();

  const { data: invs } = await admin.from("invoices").select("id,number,family_id,total_chf,due_date").eq("org_id", me.orgId).eq("status", "overdue");
  if (!invs || invs.length === 0) return { ok: true, sent: 0, failed: 0, inApp: 0, targets: 0 };

  const invIds = invs.map((i) => i.id);
  const famIds = Array.from(new Set(invs.map((i) => i.family_id).filter((x): x is string => Boolean(x))));
  const [paysRes, membersRes] = await Promise.all([
    admin.from("payments").select("invoice_id,amount_chf").in("invoice_id", invIds),
    famIds.length ? admin.from("family_members").select("family_id,profile_id").in("family_id", famIds) : Promise.resolve({ data: [] as { family_id: string; profile_id: string }[] }),
  ]);
  const paid = new Map<string, number>();
  for (const p of paysRes.data ?? []) paid.set(p.invoice_id, (paid.get(p.invoice_id) ?? 0) + Number(p.amount_chf));

  const members = membersRes.data ?? [];
  const profIds = Array.from(new Set(members.map((m) => m.profile_id)));
  const profs = profIds.length ? (await admin.from("profiles").select("id,full_name,email").in("id", profIds)).data ?? [] : [];
  const profById = new Map(profs.map((p) => [p.id, p]));
  const guardiansByFam = new Map<string, { id: string; full_name: string | null; email: string }[]>();
  for (const m of members) {
    const pr = profById.get(m.profile_id);
    if (!pr) continue;
    const arr = guardiansByFam.get(m.family_id) ?? [];
    arr.push(pr);
    guardiansByFam.set(m.family_id, arr);
  }

  const rows = [];
  for (const inv of invs) {
    if (!inv.family_id) continue;
    const balance = Number(inv.total_chf) - (paid.get(inv.id) ?? 0);
    for (const g of guardiansByFam.get(inv.family_id) ?? []) {
      const vars: NotifVars = { parent_name: g.full_name ?? undefined, invoice_number: inv.number, amount_due: balance, due_date: inv.due_date ?? undefined, payment_link: `${siteUrl()}/parent/invoices/${inv.id}` };
      rows.push({ orgId: me.orgId as string, type: "payment_overdue" as const, recipientProfileId: g.id, toEmail: g.email, invoiceId: inv.id, vars });
    }
  }
  const res = await dispatchMany(rows);
  revalidatePath("/admin/notifications");
  return { ok: true, ...res, targets: rows.length };
}

/** Freeform broadcast to all parents. Supports {{parent_name}} etc. placeholders. */
export async function broadcastAnnouncement(input: { title: string; message: string; email: boolean }): Promise<BulkResult> {
  const me = await getAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  if (!input.title.trim() || !input.message.trim()) return { ok: false, error: "Title and message are required" };
  const admin = createAdminClient();

  const fams = (await admin.from("families").select("id").eq("org_id", me.orgId)).data ?? [];
  const famIds = fams.map((f) => f.id);
  const members = famIds.length ? (await admin.from("family_members").select("profile_id").in("family_id", famIds)).data ?? [] : [];
  const profIds = Array.from(new Set(members.map((m) => m.profile_id)));
  if (profIds.length === 0) return { ok: true, sent: 0, failed: 0, inApp: 0, targets: 0 };
  const profs = (await admin.from("profiles").select("id,full_name,email").in("id", profIds)).data ?? [];

  const rows = profs.map((p) => ({
    orgId: me.orgId as string,
    type: "announcement" as const,
    recipientProfileId: p.id,
    toEmail: input.email ? p.email : null,
    vars: { parent_name: p.full_name ?? undefined, title: input.title, message: input.message } as NotifVars,
  }));
  const res = await dispatchMany(rows);
  revalidatePath("/admin/notifications");
  return { ok: true, ...res, targets: rows.length };
}

export async function retryFailedEmail(logId: string): Promise<{ ok: boolean; error?: string }> {
  const me = await getAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  const res = await retryEmailLog(logId);
  revalidatePath("/admin/notifications");
  return res;
}

export async function retryAllFailed(): Promise<{ ok: boolean; retried: number; recovered: number }> {
  const me = await getAdmin();
  if (!me) return { ok: false, retried: 0, recovered: 0 };
  const admin = createAdminClient();
  const { data } = await admin.from("email_logs").select("id").eq("org_id", me.orgId).eq("status", "failed").limit(200);
  let recovered = 0;
  for (const row of data ?? []) {
    const r = await retryEmailLog(row.id);
    if (r.ok) recovered += 1;
  }
  revalidatePath("/admin/notifications");
  return { ok: true, retried: (data ?? []).length, recovered };
}
