import { createClient } from "@/lib/supabase/server";

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(d: T): Result<T> => ({ data: d, error: null });
const fail = (e: string): Result<never> => ({ data: null, error: e });
const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => Boolean(x))));

export type AttendanceSessionRow = {
  id: string;
  programName: string;
  coachName: string;
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
    return { id: s.id, programName: pName.get(s.program_id ?? "") ?? "Session", coachName: cName.get(s.coach_id ?? "") ?? "—", date: s.session_date, status: s.status, ...a };
  }));
}

export type SessionMark = { athleteId: string; name: string; status: string; notes: string | null; injury: boolean };
export async function getAttendanceSessionDetail(id: string): Promise<Result<{ programName: string; coachName: string; date: string; status: string; marks: SessionMark[] } | null>> {
  const supabase = await createClient();
  const { data: s, error } = await supabase.from("attendance_sessions").select("id,program_id,coach_id,session_date,status").eq("id", id).maybeSingle();
  if (error) return fail(error.message);
  if (!s) return ok(null);
  const [marksRes, prog, coach] = await Promise.all([
    supabase.from("attendance_marks").select("athlete_id,status,notes,injury_flag").eq("attendance_session_id", id),
    s.program_id ? supabase.from("programs").select("name").eq("id", s.program_id).maybeSingle() : Promise.resolve({ data: null }),
    s.coach_id ? supabase.from("coaches").select("display_name").eq("id", s.coach_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const athleteIds = uniq((marksRes.data ?? []).map((m) => m.athlete_id));
  const athletes = athleteIds.length ? await supabase.from("athletes").select("id,first_name,last_name").in("id", athleteIds) : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const aName = new Map((athletes.data ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`]));
  return ok({
    programName: (prog.data as { name?: string } | null)?.name ?? "Session",
    coachName: (coach.data as { display_name?: string } | null)?.display_name ?? "—",
    date: s.session_date, status: s.status,
    marks: (marksRes.data ?? []).map((m) => ({ athleteId: m.athlete_id, name: aName.get(m.athlete_id) ?? "Athlete", status: m.status, notes: m.notes, injury: m.injury_flag })),
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
