import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";
import { getFormatter } from "@/lib/i18n/server";

export type Bundle = { text: string; hasData: boolean };

function age(dob: string | null): string {
  if (!dob) return "";
  const d = new Date(dob);
  const a = Math.floor((Date.now() - d.getTime()) / 31557600000);
  return Number.isFinite(a) ? `age ${a}` : "";
}

/**
 * PARENT context. Built with the RLS-scoped SESSION client, so every query is
 * automatically limited to this guardian's own family. Medical notes and any
 * payment-card data are deliberately EXCLUDED from what the model ever sees.
 */
export async function buildParentContext(): Promise<Bundle> {
  const f = await getFormatter();
  const sb = await createClient();
  const [fam, ath, regs, inv, bk] = await Promise.all([
    sb.from("families").select("name"),
    sb.from("athletes").select("id,first_name,last_name,dob,status"),
    sb.from("registrations").select("athlete_id,program_id,status"),
    sb.from("invoices").select("number,total_chf,status,due_date"),
    sb.from("training_bookings").select("athlete_id,service_id,coach_id,slot_start,status").order("slot_start", { ascending: true }).limit(20),
  ]);
  const athletes = ath.data ?? [];
  if (athletes.length === 0 && (inv.data ?? []).length === 0) return { text: "No records found for this family.", hasData: false };

  // resolve names for programs / services / coaches (also RLS-scoped/public)
  const progIds = Array.from(new Set((regs.data ?? []).map((r) => r.program_id).filter(Boolean) as string[]));
  const svcIds = Array.from(new Set((bk.data ?? []).map((b) => b.service_id).filter(Boolean) as string[]));
  const coachIds = Array.from(new Set((bk.data ?? []).map((b) => b.coach_id).filter(Boolean) as string[]));
  const [progs, svcs, coaches] = await Promise.all([
    progIds.length ? sb.from("programs").select("id,name").in("id", progIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    svcIds.length ? sb.from("training_services").select("id,name").in("id", svcIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    coachIds.length ? sb.from("coaches").select("id,display_name").in("id", coachIds) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
  ]);
  const pName = new Map((progs.data ?? []).map((p) => [p.id, p.name]));
  const sName = new Map((svcs.data ?? []).map((s) => [s.id, s.name]));
  const cName = new Map((coaches.data ?? []).map((c) => [c.id, c.display_name]));
  const aName = new Map(athletes.map((a) => [a.id, `${a.first_name} ${a.last_name}`]));

  const lines: string[] = [];
  lines.push(`FAMILY: ${(fam.data ?? [])[0]?.name ?? "—"}`);
  lines.push("CHILDREN:");
  for (const a of athletes) lines.push(`- ${a.first_name} ${a.last_name} (${[age(a.dob), a.status].filter(Boolean).join(", ")})`);
  lines.push("REGISTRATIONS:");
  for (const r of regs.data ?? []) lines.push(`- ${aName.get(r.athlete_id) ?? "Child"} — ${pName.get(r.program_id ?? "") ?? "Program"} (${r.status})`);
  lines.push("INVOICES:");
  for (const i of inv.data ?? []) lines.push(`- ${i.number} — ${f.money(Number(i.total_chf))} — ${i.status}${i.due_date ? ` — due ${f.date(i.due_date)}` : ""}`);
  lines.push("BOOKINGS:");
  for (const b of bk.data ?? []) lines.push(`- ${sName.get(b.service_id ?? "") ?? "Session"} with ${cName.get(b.coach_id ?? "") ?? "coach"} — ${f.date(b.slot_start)} (${b.status})`);
  lines.push("\nNote: medical records and payment-card details are intentionally not available here.");
  return { text: lines.join("\n"), hasData: true };
}

/** ADMIN context: org-wide aggregates via the admin client (admin is authorised org-wide). */
export async function buildAdminContext(): Promise<Bundle> {
  const f = await getFormatter();
  const me = await getSessionUser();
  if (!me?.orgId) return { text: "No organization.", hasData: false };
  const admin = createAdminClient();
  const org = me.orgId;
  const count = async (t: string, mod?: (q: any) => any): Promise<number> => {
    let q: any = admin.from(t as any).select("id", { count: "exact", head: true }).eq("org_id", org);
    if (mod) q = mod(q);
    const { count: c } = await q;
    return c ?? 0;
  };
  const [families, athletes, activeRegs, invPaid, invSent, invOverdue, bookings] = await Promise.all([
    count("families"), count("athletes"),
    count("registrations", (q: any) => q.eq("status", "confirmed")),
    count("invoices", (q: any) => q.eq("status", "paid")),
    count("invoices", (q: any) => q.eq("status", "sent")),
    count("invoices", (q: any) => q.eq("status", "overdue")),
    count("training_bookings", (q: any) => q.eq("status", "booked")),
  ]);
  // outstanding amount (sent + overdue)
  const { data: openInv } = await admin.from("invoices").select("total_chf").eq("org_id", org).in("status", ["sent", "overdue"]);
  const outstanding = (openInv ?? []).reduce((s, r) => s + Number(r.total_chf), 0);
  const { data: recentReg } = await admin.from("registrations").select("created_at,status").eq("org_id", org).order("created_at", { ascending: false }).limit(5);
  const { data: recentSessions } = await admin.from("attendance_sessions").select("id,created_at").eq("org_id", org).order("created_at", { ascending: false }).limit(5);

  const lines = [
    `CLUB OPERATIONS SUMMARY (as of ${f.date(new Date().toISOString())}):`,
    `- Families: ${families}`,
    `- Athletes: ${athletes}`,
    `- Confirmed registrations: ${activeRegs}`,
    `- Invoices: ${invPaid} paid, ${invSent} sent, ${invOverdue} overdue`,
    `- Outstanding (sent + overdue): ${f.money(outstanding)}`,
    `- Active bookings: ${bookings}`,
    `- Recent registrations (last 5): ${(recentReg ?? []).map((r) => `${r.status} ${f.date(r.created_at)}`).join("; ") || "none"}`,
    `- Recent attendance sessions: ${(recentSessions ?? []).length}`,
  ];
  return { text: lines.join("\n"), hasData: true };
}

/** COACH context: only sessions/rosters assigned to this coach (RLS-scoped session client). */
export async function buildCoachContext(): Promise<Bundle> {
  const f = await getFormatter();
  const sb = await createClient();
  const { data: sessions } = await sb.from("attendance_sessions").select("id,session_date,status,roster_size").order("session_date", { ascending: false }).limit(15);
  const list = sessions ?? [];
  if (list.length === 0) return { text: "No assigned sessions found.", hasData: false };
  const lines = ["YOUR ASSIGNED ATTENDANCE SESSIONS:"];
  for (const s of list) lines.push(`- ${s.session_date ? f.date(s.session_date) : "session"} — status ${s.status} — roster ${s.roster_size ?? 0}`);
  lines.push("\nNote: you do not have access to financial or medical information.");
  return { text: lines.join("\n"), hasData: true };
}
