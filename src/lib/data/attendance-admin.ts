import { createClient } from "@/lib/supabase/server";

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(d: T): Result<T> => ({ data: d, error: null });
const fail = (e: string): Result<never> => ({ data: null, error: e });
const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => Boolean(x))));

export type AttendanceSessionRow = {
  id: string;
  programName: string;
  coachName: string;
  coachId: string | null;
  date: string;
  status: string;
  present: number; late: number; absent: number; excused: number; injuries: number; total: number;
};

export async function listAttendanceSessions(dateFilter?: string): Promise<Result<AttendanceSessionRow[]>> {
  const supabase = await createClient();
  let q = supabase.from("attendance_sessions").select("id,program_id,coach_id,session_date,status").order("session_date", { ascending: false }).limit(200);
  if (dateFilter) {
    const start = new Date(dateFilter); start.setHours(0, 0, 0, 0);
    const end = new Date(dateFilter); end.setHours(23, 59, 59, 999);
    q = q.gte("session_date", start.toISOString()).lte("session_date", end.toISOString());
  }
  const { data: sessions, error } = await q;
  if (error) return fail(error.message);

  const ids = (sessions ?? []).map((s) => s.id);
  const [marks, progs, coaches] = await Promise.all([
    ids.length ? supabase.from("attendance_marks").select("attendance_session_id,status,injury_flag").in("attendance_session_id", ids) : Promise.resolve({ data: [] as { attendance_session_id: string; status: string; injury_flag: boolean }[] }),
    supabase.from("programs").select("id,name").in("id", uniq((sessions ?? []).map((s) => s.program_id))),
    supabase.from("coaches").select("id,display_name").in("id", uniq((sessions ?? []).map((s) => s.coach_id))),
  ]);
  const pName = new Map((progs.data ?? []).map((p) => [p.id, p.name]));
  const cName = new Map((coaches.data ?? []).map((c) => [c.id, c.display_name]));
  const byS = new Map<string, { present: number; late: number; absent: number; excused: number; injuries: number; total: number }>();
  for (const m of marks.data ?? []) {
    const agg = byS.get(m.attendance_session_id) ?? { present: 0, late: 0, absent: 0, excused: 0, injuries: 0, total: 0 };
    agg[m.status as "present" | "late" | "absent" | "excused"]++; agg.total++; if (m.injury_flag) agg.injuries++;
    byS.set(m.attendance_session_id, agg);
  }
  return ok((sessions ?? []).map((s) => {
    const a = byS.get(s.id) ?? { present: 0, late: 0, absent: 0, excused: 0, injuries: 0, total: 0 };
    return { id: s.id, programName: pName.get(s.program_id ?? "") ?? "Session", coachName: cName.get(s.coach_id ?? "") ?? "—", coachId: s.coach_id ?? null, date: s.session_date, status: s.status, ...a };
  }));
}

export type SessionMark = { athleteId: string; name: string; status: string; notes: string | null; injury: boolean; correctedAt: string | null };
export type AttendanceChange = { id: string; at: string; actorName: string; action: string; athleteName: string | null; from: string | null; to: string | null; noteChanged: boolean; reason: string | null };
export type AttendanceSessionDetail = {
  id: string; programName: string; coachName: string; date: string; status: string; reopenedAt: string | null; correctionCount: number;
  marks: SessionMark[];
  /** Athletes of the club not yet marked (late arrivals / drop-ins). */
  addable: { id: string; name: string }[];
  history: AttendanceChange[];
};

export async function getAttendanceSessionDetail(id: string): Promise<Result<AttendanceSessionDetail | null>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return ok(null);
  const supabase = await createClient();
  const { data: s, error } = await supabase.from("attendance_sessions").select("id,org_id,program_id,coach_id,session_date,status,reopened_at,correction_count").eq("id", id).maybeSingle();
  if (error) return fail(error.message);
  if (!s) return ok(null);
  const [marksRes, prog, coach, regs, logs] = await Promise.all([
    supabase.from("attendance_marks").select("id,athlete_id,status,notes,injury_flag,corrected_at").eq("attendance_session_id", id),
    s.program_id ? supabase.from("programs").select("name").eq("id", s.program_id).maybeSingle() : Promise.resolve({ data: null }),
    s.coach_id ? supabase.from("coaches").select("display_name").eq("id", s.coach_id).maybeSingle() : Promise.resolve({ data: null }),
    s.program_id ? supabase.from("registrations").select("athlete_id").eq("program_id", s.program_id).neq("status", "cancelled") : Promise.resolve({ data: [] as { athlete_id: string }[] }),
    // audit_logs RLS: club admins only (others get no history).
    supabase.from("audit_logs").select("id,actor_id,action,old_data,new_data,created_at").eq("org_id", s.org_id)
      .in("action", ["attendance.correct", "attendance.mark_added", "attendance.mark_removed", "attendance.reopen"])
      .filter("new_data->>session_id", "eq", id).order("created_at", { ascending: false }).limit(100),
  ]);
  const marks = marksRes.data ?? [];
  const marked = new Set(marks.map((m) => m.athlete_id));
  const { data: allAthletes } = await supabase.from("athletes").select("id,first_name,last_name,status").eq("org_id", s.org_id).neq("status", "archived").order("last_name").limit(1000);
  const aName = new Map((allAthletes ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`]));
  const missing = uniq(marks.map((m) => m.athlete_id).filter((a) => !aName.has(a)));
  if (missing.length) {
    const { data: extra } = await supabase.from("athletes").select("id,first_name,last_name").in("id", missing);
    for (const a of extra ?? []) aName.set(a.id, `${a.first_name} ${a.last_name}`);
  }
  const registered = new Set((regs.data ?? []).map((r) => r.athlete_id));
  const addable = (allAthletes ?? []).filter((a) => !marked.has(a.id))
    .map((a) => ({ id: a.id, name: `${a.first_name} ${a.last_name}`, reg: registered.has(a.id) }))
    .sort((a, b) => Number(b.reg) - Number(a.reg) || a.name.localeCompare(b.name))
    .map(({ id: aid, name }) => ({ id: aid, name }));

  type Log = { id: number | string; actor_id: string | null; action: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; created_at: string };
  const logRows = ((logs as { data: Log[] | null }).data ?? []);
  const actorIds = uniq(logRows.map((l) => l.actor_id));
  const actors = actorIds.length ? (await supabase.from("profiles").select("id,full_name,email").in("id", actorIds)).data ?? [] : [];
  const actorName = new Map(actors.map((p) => [p.id, p.full_name ?? p.email ?? "—"]));
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const history = logRows.map((l) => ({
    id: String(l.id), at: l.created_at, actorName: l.actor_id ? actorName.get(l.actor_id) ?? "—" : "—", action: l.action,
    athleteName: str(l.new_data?.athlete_id) ? aName.get(String(l.new_data?.athlete_id)) ?? null : null,
    from: str(l.old_data?.status), to: l.action === "attendance.mark_removed" ? null : str(l.new_data?.status),
    noteChanged: l.new_data?.note_changed === true, reason: str(l.new_data?.reason),
  }));

  return ok({
    id: s.id,
    programName: (prog.data as { name?: string } | null)?.name ?? "—",
    coachName: (coach.data as { display_name?: string } | null)?.display_name ?? "—",
    date: s.session_date, status: s.status,
    reopenedAt: (s as { reopened_at?: string | null }).reopened_at ?? null,
    correctionCount: (s as { correction_count?: number }).correction_count ?? 0,
    marks: marks.map((m) => ({ athleteId: m.athlete_id, name: aName.get(m.athlete_id) ?? "—", status: m.status, notes: m.notes, injury: m.injury_flag, correctedAt: (m as { corrected_at?: string | null }).corrected_at ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    addable,
    history,
  });
}

export type AthleteAttendanceRow = { date: string; programName: string; status: string; notes: string | null; injury: boolean };
export async function athleteAttendanceHistory(athleteId: string): Promise<Result<AthleteAttendanceRow[]>> {
  const supabase = await createClient();
  const { data: marks, error } = await supabase.from("attendance_marks").select("attendance_session_id,status,notes,injury_flag").eq("athlete_id", athleteId).limit(100);
  if (error) return fail(error.message);
  const sessionIds = uniq((marks ?? []).map((m) => m.attendance_session_id));
  const sessions = sessionIds.length ? await supabase.from("attendance_sessions").select("id,program_id,session_date").in("id", sessionIds) : { data: [] as { id: string; program_id: string | null; session_date: string }[] };
  const sMap = new Map((sessions.data ?? []).map((s) => [s.id, s]));
  const progs = await supabase.from("programs").select("id,name").in("id", uniq((sessions.data ?? []).map((s) => s.program_id)));
  const pName = new Map((progs.data ?? []).map((p) => [p.id, p.name]));
  return ok((marks ?? []).map((m) => {
    const s = sMap.get(m.attendance_session_id);
    return { date: s?.session_date ?? "", programName: pName.get(s?.program_id ?? "") ?? "Session", status: m.status, notes: m.notes, injury: m.injury_flag };
  }).sort((a, b) => b.date.localeCompare(a.date)));
}
