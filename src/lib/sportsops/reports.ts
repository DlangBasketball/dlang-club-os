import "server-only";
import { sportsDb } from "./db";
import type { Result } from "./data";

const ok = <T>(d: T): Result<T> => ({ data: d, error: null });
const fail = (e: string): Result<never> => ({ data: null, error: e });
const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => Boolean(x))));
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export type Range = { from: string; to: string }; // YYYY-MM-DD inclusive

const startIso = (d: string) => new Date(`${d}T00:00:00Z`).toISOString();
const endIso = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString();

// ---------------------------------------------------------------------------
// Attendance (from the existing attendance_sessions / attendance_marks)
//   rate = (present + late) / all marks
//   A session is attributed to a team when the team links to the session's
//   program; otherwise to the program itself ("Program: <name>").
// ---------------------------------------------------------------------------
export type AttendanceTeamRow = { key: string; group: string; sessions: number; marks: number; present: number; late: number; absent: number; excused: number; rate: number | null };
export type AttendanceAthleteRow = { athleteId: string; name: string; teams: string; marks: number; present: number; late: number; absent: number; excused: number; rate: number | null };

export async function attendanceReport(range: Range): Promise<Result<{ byTeam: AttendanceTeamRow[]; byAthlete: AttendanceAthleteRow[] }>> {
  const db = await sportsDb();
  const { data: sessions, error } = await db.from("attendance_sessions")
    .select("id,program_id,session_date").gte("session_date", startIso(range.from)).lt("session_date", endIso(range.to)).limit(5000);
  if (error) return fail(error.message);
  const sIds = (sessions ?? []).map((s) => s.id);
  if (!sIds.length) return ok({ byTeam: [], byAthlete: [] });

  const marks: { attendance_session_id: string; athlete_id: string; status: string }[] = [];
  for (let i = 0; i < sIds.length; i += 300) {
    const { data, error: mErr } = await db.from("attendance_marks").select("attendance_session_id,athlete_id,status").in("attendance_session_id", sIds.slice(i, i + 300));
    if (mErr) return fail(mErr.message);
    marks.push(...(data ?? []));
  }
  const programIds = uniq((sessions ?? []).map((s) => s.program_id));
  const athleteIds = uniq(marks.map((m) => m.athlete_id));
  const [teams, programs, athletes, mems] = await Promise.all([
    programIds.length ? db.from("teams").select("id,name,program_id").in("program_id", programIds) : Promise.resolve({ data: [] as { id: string; name: string; program_id: string | null }[] }),
    programIds.length ? db.from("programs").select("id,name").in("id", programIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    athleteIds.length ? db.from("athletes").select("id,first_name,last_name").in("id", athleteIds) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
    athleteIds.length ? db.from("team_memberships").select("athlete_id,team_id,status").in("athlete_id", athleteIds) : Promise.resolve({ data: [] as { athlete_id: string; team_id: string; status: string }[] }),
  ]);
  const teamByProgram = new Map<string, { id: string; name: string }>();
  for (const t of teams.data ?? []) if (t.program_id && !teamByProgram.has(t.program_id)) teamByProgram.set(t.program_id, t);
  const programName = new Map((programs.data ?? []).map((p) => [p.id, p.name]));
  const sessionGroup = new Map<string, { key: string; group: string }>();
  for (const s of sessions ?? []) {
    const team = s.program_id ? teamByProgram.get(s.program_id) : undefined;
    sessionGroup.set(s.id, team
      ? { key: `t:${team.id}`, group: team.name }
      : s.program_id ? { key: `p:${s.program_id}`, group: `Program: ${programName.get(s.program_id) ?? "—"}` } : { key: "none", group: "Unassigned" });
  }

  const blank = () => ({ marks: 0, present: 0, late: 0, absent: 0, excused: 0 });
  const bump = (c: ReturnType<typeof blank>, st: string) => {
    c.marks += 1;
    if (st === "present" || st === "late" || st === "absent" || st === "excused") c[st] += 1;
  };
  const groups = new Map<string, ReturnType<typeof blank> & { group: string; sessions: Set<string> }>();
  const people = new Map<string, ReturnType<typeof blank>>();
  for (const m of marks) {
    const g = sessionGroup.get(m.attendance_session_id) ?? { key: "none", group: "Unassigned" };
    const gc = groups.get(g.key) ?? { ...blank(), group: g.group, sessions: new Set<string>() };
    bump(gc, m.status); gc.sessions.add(m.attendance_session_id); groups.set(g.key, gc);
    const pc = people.get(m.athlete_id) ?? blank();
    bump(pc, m.status); people.set(m.athlete_id, pc);
  }
  const teamNames = new Map<string, string>();
  const allTeamIds = uniq((mems.data ?? []).filter((m) => m.status !== "inactive").map((m) => m.team_id));
  if (allTeamIds.length) {
    const { data: tn } = await db.from("teams").select("id,name").in("id", allTeamIds);
    for (const t of tn ?? []) teamNames.set(t.id, t.name);
  }
  const athleteName = new Map((athletes.data ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`]));

  const byTeam = Array.from(groups.entries()).map(([key, c]) => ({
    key, group: c.group, sessions: c.sessions.size, marks: c.marks, present: c.present, late: c.late, absent: c.absent, excused: c.excused,
    rate: pct(c.present + c.late, c.marks),
  })).sort((a, b) => a.group.localeCompare(b.group));
  const byAthlete = Array.from(people.entries()).map(([id, c]) => ({
    athleteId: id, name: athleteName.get(id) ?? "Athlete",
    teams: (mems.data ?? []).filter((m) => m.athlete_id === id && m.status !== "inactive").map((m) => teamNames.get(m.team_id)).filter(Boolean).join(", "),
    marks: c.marks, present: c.present, late: c.late, absent: c.absent, excused: c.excused, rate: pct(c.present + c.late, c.marks),
  })).sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || a.name.localeCompare(b.name));
  return ok({ byTeam, byAthlete });
}

// ---------------------------------------------------------------------------
// Finance: revenue by program, outstanding receivables
// ---------------------------------------------------------------------------
type InvoiceLite = { id: string; number: string; program_id: string | null; family_id: string; total_chf: number; status: string; due_date: string | null; issued_at: string; currency: string };

async function paidByInvoice(ids: string[]) {
  const db = await sportsDb();
  const paid = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await db.from("payments").select("invoice_id,amount_chf,status").in("invoice_id", ids.slice(i, i + 300)).eq("status", "succeeded");
    for (const p of data ?? []) paid.set(p.invoice_id, (paid.get(p.invoice_id) ?? 0) + Number(p.amount_chf));
  }
  return paid;
}

export type RevenueRow = { programId: string | null; program: string; invoices: number; invoiced: number; collected: number; outstanding: number };

export async function revenueByProgram(range: Range): Promise<Result<RevenueRow[]>> {
  const db = await sportsDb();
  const { data, error } = await db.from("invoices")
    .select("id,number,program_id,family_id,total_chf,status,due_date,issued_at,currency")
    .gte("issued_at", startIso(range.from)).lt("issued_at", endIso(range.to)).limit(10000);
  if (error) return fail(error.message);
  const invoices = ((data ?? []) as unknown as InvoiceLite[]).filter((i) => !["void", "cancelled", "draft"].includes(i.status));
  const paid = await paidByInvoice(invoices.map((i) => i.id));
  const pIds = uniq(invoices.map((i) => i.program_id));
  const { data: progs } = pIds.length ? await db.from("programs").select("id,name").in("id", pIds) : { data: [] as { id: string; name: string }[] };
  const pName = new Map((progs ?? []).map((p) => [p.id, p.name]));
  const rows = new Map<string, RevenueRow>();
  for (const inv of invoices) {
    const k = inv.program_id ?? "none";
    const r = rows.get(k) ?? { programId: inv.program_id, program: inv.program_id ? pName.get(inv.program_id) ?? "—" : "Other / unassigned", invoices: 0, invoiced: 0, collected: 0, outstanding: 0 };
    const total = Number(inv.total_chf);
    const got = inv.status === "refunded" ? 0 : Math.min(paid.get(inv.id) ?? (inv.status === "paid" ? total : 0), total);
    r.invoices += 1; r.invoiced += total; r.collected += got; r.outstanding += inv.status === "refunded" ? 0 : Math.max(total - got, 0);
    rows.set(k, r);
  }
  return ok(Array.from(rows.values()).sort((a, b) => b.invoiced - a.invoiced));
}

export type ReceivableRow = { invoiceId: string; number: string; family: string; program: string; total: number; paid: number; balance: number; status: string; dueDate: string | null; daysOverdue: number; bucket: "current" | "1-30" | "31-60" | "61-90" | "90+" };

export async function outstandingReceivables(): Promise<Result<ReceivableRow[]>> {
  const db = await sportsDb();
  const { data, error } = await db.from("invoices")
    .select("id,number,program_id,family_id,total_chf,status,due_date,issued_at,currency")
    .in("status", ["pending", "sent", "partially_paid", "overdue"] as never[]).order("due_date", { ascending: true }).limit(5000);
  if (error) return fail(error.message);
  const invoices = (data ?? []) as unknown as InvoiceLite[];
  const paid = await paidByInvoice(invoices.map((i) => i.id));
  const [fams, progs] = await Promise.all([
    uniq(invoices.map((i) => i.family_id)).length ? db.from("families").select("id,name").in("id", uniq(invoices.map((i) => i.family_id))) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    uniq(invoices.map((i) => i.program_id)).length ? db.from("programs").select("id,name").in("id", uniq(invoices.map((i) => i.program_id))) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const fName = new Map((fams.data ?? []).map((f) => [f.id, f.name]));
  const pName = new Map((progs.data ?? []).map((p) => [p.id, p.name]));
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  return ok(invoices.map((i) => {
    const total = Number(i.total_chf);
    const p = Math.min(paid.get(i.id) ?? 0, total);
    const days = i.due_date ? Math.max(Math.floor((today - Date.parse(i.due_date)) / 864e5), 0) : 0;
    const bucket: ReceivableRow["bucket"] = days === 0 ? "current" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
    return {
      invoiceId: i.id, number: i.number, family: fName.get(i.family_id) ?? "—", program: i.program_id ? pName.get(i.program_id) ?? "—" : "—",
      total, paid: p, balance: Math.max(total - p, 0), status: i.status, dueDate: i.due_date, daysOverdue: days, bucket,
    };
  }).filter((r) => r.balance > 0));
}

// ---------------------------------------------------------------------------
// Registrations by program
// ---------------------------------------------------------------------------
export type RegistrationRow = { programId: string; program: string; capacity: number | null; pending: number; confirmed: number; waitlist: number; cancelled: number; completed: number; total: number; fill: number | null };

export async function registrationsByProgram(range: Range): Promise<Result<RegistrationRow[]>> {
  const db = await sportsDb();
  const { data, error } = await db.from("registrations").select("program_id,status,created_at")
    .gte("created_at", startIso(range.from)).lt("created_at", endIso(range.to)).limit(20000);
  if (error) return fail(error.message);
  const pIds = uniq((data ?? []).map((r) => r.program_id));
  const { data: progs } = pIds.length ? await db.from("programs").select("id,name,capacity").in("id", pIds) : { data: [] as { id: string; name: string; capacity: number | null }[] };
  const prog = new Map((progs ?? []).map((p) => [p.id, p]));
  const rows = new Map<string, RegistrationRow>();
  for (const r of data ?? []) {
    const p = prog.get(r.program_id);
    const row = rows.get(r.program_id) ?? { programId: r.program_id, program: p?.name ?? "—", capacity: p?.capacity ?? null, pending: 0, confirmed: 0, waitlist: 0, cancelled: 0, completed: 0, total: 0, fill: null };
    const st = r.status as keyof Pick<RegistrationRow, "pending" | "confirmed" | "waitlist" | "cancelled" | "completed">;
    if (st in row) row[st] += 1;
    row.total += 1;
    rows.set(r.program_id, row);
  }
  return ok(Array.from(rows.values()).map((r) => ({ ...r, fill: r.capacity ? pct(r.confirmed + r.completed, r.capacity) : null })).sort((a, b) => b.total - a.total));
}

/** Default reporting window: current season if any, else the last 90 days. */
export async function defaultRange(): Promise<Range> {
  const db = await sportsDb();
  const { data } = await db.from("seasons").select("starts_on,ends_on").eq("is_current", true).maybeSingle();
  const today = new Date().toISOString().slice(0, 10);
  if (data) return { from: data.starts_on, to: data.ends_on < today ? data.ends_on : today };
  return { from: new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10), to: today };
}
