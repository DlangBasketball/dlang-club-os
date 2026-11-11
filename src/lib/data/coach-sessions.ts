import { createClient } from "@/lib/supabase/server";

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(d: T): Result<T> => ({ data: d, error: null });
const fail = (e: string): Result<never> => ({ data: null, error: e });

export type CoachSession = {
  programSessionId: string;
  programId: string;
  programName: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  attendanceStatus: "not_started" | "open" | "submitted" | "locked";
  attendanceSessionId: string | null;
  rosterSize: number | null;
};

function dayBounds(d: Date) {
  const start = new Date(d); start.setHours(0, 0, 0, 0);
  const end = new Date(d); end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Sessions the signed-in coach leads. RLS already scopes program_sessions to
 *  the current coach, so this only ever returns their own sessions. */
export async function listCoachSessions(opts?: { todayOnly?: boolean }): Promise<Result<CoachSession[]>> {
  const supabase = await createClient();
  let q = supabase
    .from("program_sessions")
    .select("id,program_id,starts_at,ends_at,location")
    .order("starts_at", { ascending: true });
  if (opts?.todayOnly) {
    const { start, end } = dayBounds(new Date());
    q = q.gte("starts_at", start).lte("starts_at", end);
  } else {
    q = q.gte("starts_at", new Date(Date.now() - 7 * 864e5).toISOString());
  }
  const { data: sessions, error } = await q.limit(100);
  if (error) return fail(error.message);

  const programIds = Array.from(new Set((sessions ?? []).map((s) => s.program_id)));
  const sessionIds = (sessions ?? []).map((s) => s.id);
  const [progRes, attRes] = await Promise.all([
    programIds.length ? supabase.from("programs").select("id,name").in("id", programIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    sessionIds.length ? supabase.from("attendance_sessions").select("id,program_session_id,status,roster_size").in("program_session_id", sessionIds) : Promise.resolve({ data: [] as { id: string; program_session_id: string | null; status: string; roster_size: number | null }[] }),
  ]);
  const pName = new Map((progRes.data ?? []).map((p) => [p.id, p.name]));
  const att = new Map((attRes.data ?? []).map((a) => [a.program_session_id, a]));

  return ok((sessions ?? []).map((s) => {
    const a = att.get(s.id);
    return {
      programSessionId: s.id,
      programId: s.program_id,
      programName: pName.get(s.program_id) ?? "Session",
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      location: s.location,
      attendanceStatus: (a?.status as CoachSession["attendanceStatus"]) ?? "not_started",
      attendanceSessionId: a?.id ?? null,
      rosterSize: a?.roster_size ?? null,
    };
  }));
}

export type RosterEntry = {
  athleteId: string;
  fullName: string;
  status: "present" | "late" | "absent" | "excused" | null;
  notes: string | null;
  injuryFlag: boolean;
  allergies: string | null;
  conditions: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
};

/** Opens (or fetches) the attendance session for a program session, then loads
 *  the roster. Both calls enforce coach-ownership server-side. */
export async function getRosterForProgramSession(
  programSessionId: string,
): Promise<Result<{ attendanceSessionId: string; status: string; programName: string; roster: RosterEntry[] }>> {
  const supabase = await createClient();
  const { data: opened, error: openErr } = await supabase.rpc("open_attendance_session", { p_program_session: programSessionId });
  if (openErr) return fail(openErr.message);
  const attendanceSessionId = (opened as { attendance_session_id?: string } | null)?.attendance_session_id;
  if (!attendanceSessionId) return fail("Could not open session");

  const [{ data: roster, error: rosterErr }, { data: att }, { data: ps }] = await Promise.all([
    supabase.rpc("session_roster", { p_attendance_session: attendanceSessionId }),
    supabase.from("attendance_sessions").select("status,program_id").eq("id", attendanceSessionId).maybeSingle(),
    supabase.from("program_sessions").select("program_id").eq("id", programSessionId).maybeSingle(),
  ]);
  if (rosterErr) return fail(rosterErr.message);

  const programId = att?.program_id ?? ps?.program_id ?? null;
  let programName = "Session";
  if (programId) {
    const { data: prog } = await supabase.from("programs").select("name").eq("id", programId).maybeSingle();
    programName = prog?.name ?? "Session";
  }

  return ok({
    attendanceSessionId,
    status: att?.status ?? "open",
    programName,
    roster: ((roster ?? []) as Record<string, unknown>[]).map((r) => ({
      athleteId: r.athlete_id as string,
      fullName: r.full_name as string,
      status: (r.status as RosterEntry["status"]) ?? null,
      notes: (r.notes as string | null) ?? null,
      injuryFlag: Boolean(r.injury_flag),
      allergies: (r.allergies as string | null) ?? null,
      conditions: (r.conditions as string | null) ?? null,
      emergencyContactName: (r.emergency_contact_name as string | null) ?? null,
      emergencyContactPhone: (r.emergency_contact_phone as string | null) ?? null,
    })),
  });
}
