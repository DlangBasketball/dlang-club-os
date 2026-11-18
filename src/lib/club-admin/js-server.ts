import "server-only";
import { caDb } from "./db";
import type { JsMarks, JsParticipant, JsSession } from "./js";

/**
 * J+S activity data of one offer (programme) and period, read through the
 * admin's RLS session: attendance sessions with their duration and coach,
 * attendance marks, participants (registered or marked). AHV numbers are
 * NOT loaded here (see public.js_ahv_numbers, admin + audited).
 */
const DEFAULT_MINUTES = 60;

function localParts(iso: string, timeZone: string): { day: string; time: string } {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { day, time };
}

export async function loadJsOffer(orgId: string, programId: string, from: string, to: string, timeZone: string): Promise<{
  program: { id: string; name: string; js_offer_number: string | null } | null;
  sessions: JsSession[];
  participants: JsParticipant[];
  marks: JsMarks;
}> {
  const db = await caDb();
  const { data: program } = await db.from("programs").select("id,name,js_offer_number,js_session_minutes").eq("id", programId).eq("org_id", orgId).maybeSingle();
  if (!program) return { program: null, sessions: [], participants: [], marks: new Map() };
  // Period bounds in UTC with a one-day margin; filtered on the club-local day below.
  const lo = new Date(`${from}T00:00:00Z`).getTime() - 86_400_000;
  const hi = new Date(`${to}T23:59:59Z`).getTime() + 86_400_000;
  const { data: rawSessions } = await db.from("attendance_sessions")
    .select("id,program_session_id,coach_id,session_date,status")
    .eq("org_id", orgId).eq("program_id", programId)
    .gte("session_date", new Date(lo).toISOString()).lte("session_date", new Date(hi).toISOString())
    .order("session_date");
  const sess = (rawSessions ?? []) as { id: string; program_session_id: string | null; coach_id: string | null; session_date: string }[];
  const psIds = Array.from(new Set(sess.map((s) => s.program_session_id).filter((x): x is string => !!x)));
  const coachIds = Array.from(new Set(sess.map((s) => s.coach_id).filter((x): x is string => !!x)));
  const [ps, coaches, marksRes, regs] = await Promise.all([
    psIds.length ? db.from("program_sessions").select("id,starts_at,ends_at,location,coach_id").in("id", psIds) : Promise.resolve({ data: [] }),
    coachIds.length ? db.from("coaches").select("id,display_name,js_person_number").in("id", coachIds) : Promise.resolve({ data: [] }),
    sess.length ? db.from("attendance_marks").select("attendance_session_id,athlete_id,status").in("attendance_session_id", sess.map((s) => s.id)) : Promise.resolve({ data: [] }),
    db.from("registrations").select("athlete_id").eq("org_id", orgId).eq("program_id", programId).in("status", ["pending", "confirmed", "completed"]),
  ]);
  const psm = new Map(((ps.data ?? []) as { id: string; starts_at: string; ends_at: string | null; location: string | null }[]).map((p) => [p.id, p]));
  const cm = new Map(((coaches.data ?? []) as { id: string; display_name: string; js_person_number: string | null }[]).map((c) => [c.id, c]));
  const fallback = (program as { js_session_minutes: number | null }).js_session_minutes ?? DEFAULT_MINUTES;

  const sessions: JsSession[] = [];
  for (const s of sess) {
    const p = s.program_session_id ? psm.get(s.program_session_id) : undefined;
    const start = p?.starts_at ?? s.session_date;
    const { day, time } = localParts(start, timeZone);
    if (day < from || day > to) continue;
    const minutes = p?.ends_at ? Math.max(1, Math.round((new Date(p.ends_at).getTime() - new Date(p.starts_at).getTime()) / 60_000)) : fallback;
    const c = s.coach_id ? cm.get(s.coach_id) : undefined;
    sessions.push({ id: s.id, day, time, minutes, coachName: c?.display_name ?? null, coachNumber: c?.js_person_number ?? null, location: p?.location ?? null });
  }
  const kept = new Set(sessions.map((s) => s.id));
  const marks: JsMarks = new Map();
  for (const m of (marksRes.data ?? []) as { attendance_session_id: string; athlete_id: string; status: "present" | "late" | "absent" | "excused" }[]) {
    if (!kept.has(m.attendance_session_id)) continue;
    if (!marks.has(m.athlete_id)) marks.set(m.athlete_id, new Map());
    marks.get(m.athlete_id)!.set(m.attendance_session_id, m.status);
  }
  const ids = Array.from(new Set([...((regs.data ?? []) as { athlete_id: string }[]).map((r) => r.athlete_id), ...marks.keys()]));
  const { data: aths } = ids.length
    ? await db.from("athletes").select("id,first_name,last_name,dob,gender,nationality").in("id", ids)
    : { data: [] };
  const participants: JsParticipant[] = ((aths ?? []) as { id: string; first_name: string; last_name: string; dob: string | null; gender: string | null; nationality: string | null }[])
    .map((a) => ({ id: a.id, firstName: a.first_name, lastName: a.last_name, dob: a.dob, sex: a.gender, nationality: a.nationality }));
  return {
    program: { id: program.id, name: program.name, js_offer_number: (program as { js_offer_number: string | null }).js_offer_number },
    sessions, participants, marks,
  };
}
