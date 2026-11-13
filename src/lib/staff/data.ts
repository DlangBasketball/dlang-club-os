import "server-only";
import { staffDb, type EntryStatus, type GeoStatusDb, type StaffHoursRow } from "./db";
import { addDayKey, windowFor, zonedDayKey } from "./hours";
import { logError } from "@/lib/log";

/**
 * Server-side reads for staff time, lesson plans and roll-call history.
 * Every query runs with the signed-in user's client (RLS) and is filtered by
 * the caller's org explicitly as well.
 */
export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(d: T): Result<T> => ({ data: d, error: null });
const fail = (e: string): Result<never> => ({ data: null, error: e });

export type EntryView = {
  id: string;
  profileId: string;
  clockInAt: string;
  clockOutAt: string | null;
  status: EntryStatus;
  geoStatus: GeoStatusDb;
  source: "app" | "admin";
  note: string | null;
  venueId: string | null;
  venueName: string | null;
  linkedTitle: string | null;
  linkedHref: string | null;
  correctedAt: string | null;
  correctionReason: string | null;
  breaks: { id: string; startedAt: string; endedAt: string | null }[];
};

const ENTRY_COLS =
  "id,profile_id,clock_in_at,clock_out_at,status,geo_status,source,note,venue_id,program_session_id,event_id,corrected_at,correction_reason";

async function hydrateEntries(orgId: string, rows: {
  id: string; profile_id: string; clock_in_at: string; clock_out_at: string | null; status: EntryStatus; geo_status: GeoStatusDb;
  source: "app" | "admin"; note: string | null; venue_id: string | null; program_session_id: string | null; event_id: string | null;
  corrected_at: string | null; correction_reason: string | null;
}[], linkBase: "admin" | "coach"): Promise<EntryView[]> {
  if (!rows.length) return [];
  const db = await staffDb();
  const ids = rows.map((r) => r.id);
  const venueIds = Array.from(new Set(rows.map((r) => r.venue_id).filter((x): x is string => !!x)));
  const sessionIds = Array.from(new Set(rows.map((r) => r.program_session_id).filter((x): x is string => !!x)));
  const eventIds = Array.from(new Set(rows.map((r) => r.event_id).filter((x): x is string => !!x)));
  const [breaks, venues, sessions, events] = await Promise.all([
    db.from("staff_time_breaks").select("id,time_entry_id,started_at,ended_at").eq("org_id", orgId).in("time_entry_id", ids).order("started_at"),
    venueIds.length ? db.from("venues").select("id,name").eq("org_id", orgId).in("id", venueIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    sessionIds.length ? db.from("program_sessions").select("id,program_id").eq("org_id", orgId).in("id", sessionIds) : Promise.resolve({ data: [] as { id: string; program_id: string }[] }),
    eventIds.length ? db.from("events").select("id,title,type,team_id").eq("org_id", orgId).in("id", eventIds) : Promise.resolve({ data: [] as { id: string; title: string | null; type: string; team_id: string | null }[] }),
  ]);
  const programIds = Array.from(new Set((sessions.data ?? []).map((s) => s.program_id)));
  const teamIds = Array.from(new Set((events.data ?? []).map((e) => e.team_id).filter((x): x is string => !!x)));
  const [programs, teams] = await Promise.all([
    programIds.length ? db.from("programs").select("id,name").eq("org_id", orgId).in("id", programIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    teamIds.length ? db.from("teams").select("id,name").eq("org_id", orgId).in("id", teamIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const venueName = new Map((venues.data ?? []).map((v) => [v.id, v.name]));
  const programName = new Map((programs.data ?? []).map((p) => [p.id, p.name]));
  const sessionProgram = new Map((sessions.data ?? []).map((s) => [s.id, s.program_id]));
  const teamName = new Map((teams.data ?? []).map((x) => [x.id, x.name]));
  const eventById = new Map((events.data ?? []).map((e) => [e.id, e]));
  const breaksBy = new Map<string, EntryView["breaks"]>();
  for (const b of breaks.data ?? []) {
    breaksBy.set(b.time_entry_id, [...(breaksBy.get(b.time_entry_id) ?? []), { id: b.id, startedAt: b.started_at, endedAt: b.ended_at }]);
  }
  return rows.map((r) => {
    let linkedTitle: string | null = null;
    let linkedHref: string | null = null;
    if (r.program_session_id) {
      const pid = sessionProgram.get(r.program_session_id);
      linkedTitle = pid ? programName.get(pid) ?? null : null;
      linkedHref = linkBase === "coach" ? `/coach/attendance/${r.program_session_id}` : pid ? `/admin/programs/${pid}` : null;
    } else if (r.event_id) {
      const e = eventById.get(r.event_id);
      linkedTitle = e ? [e.team_id ? teamName.get(e.team_id) : null, e.title].filter(Boolean).join(" · ") || null : null;
      linkedHref = linkBase === "coach" ? `/coach/team/events/${r.event_id}` : `/admin/schedule/${r.event_id}`;
    }
    return {
      id: r.id, profileId: r.profile_id, clockInAt: r.clock_in_at, clockOutAt: r.clock_out_at, status: r.status, geoStatus: r.geo_status,
      source: r.source, note: r.note, venueId: r.venue_id, venueName: r.venue_id ? venueName.get(r.venue_id) ?? null : null,
      linkedTitle, linkedHref, correctedAt: r.corrected_at, correctionReason: r.correction_reason, breaks: breaksBy.get(r.id) ?? [],
    };
  });
}

/** Time entries of one employee on club-local days [from, to] (own entries, or any as admin/finance). */
export async function listEntries(orgId: string, profileId: string, from: string, to: string, timeZone: string, linkBase: "admin" | "coach"): Promise<Result<EntryView[]>> {
  try {
    const db = await staffDb();
    const win = windowFor(from, to, timeZone);
    const { data, error } = await db.from("staff_time_entries").select(ENTRY_COLS)
      .eq("org_id", orgId).eq("profile_id", profileId)
      .gte("clock_in_at", new Date(win.from.getTime() - 864e5).toISOString()).lt("clock_in_at", win.to.toISOString())
      .order("clock_in_at", { ascending: false }).limit(500);
    if (error) return fail(error.message);
    const rows = (data ?? []).filter((r) => {
      const k = zonedDayKey(r.clock_in_at, timeZone);
      const kOut = r.clock_out_at ? zonedDayKey(r.clock_out_at, timeZone) : k;
      return kOut >= from && k <= to;
    });
    return ok(await hydrateEntries(orgId, rows, linkBase));
  } catch (e) {
    logError("staff.listEntries", e);
    return fail("load_failed");
  }
}

export type ClockState = {
  open: EntryView | null;
  onBreak: boolean;
  missed: EntryView[];
  recent: EntryView[];
};

/** The signed-in employee's current shift, open break, missed clock-outs and the last 7 days. */
export async function getMyClockState(orgId: string, profileId: string, timeZone: string): Promise<Result<ClockState>> {
  try {
    const db = await staffDb();
    const today = zonedDayKey(new Date(), timeZone);
    const [{ data: openRows, error }, { data: missedRows }] = await Promise.all([
      db.from("staff_time_entries").select(ENTRY_COLS).eq("org_id", orgId).eq("profile_id", profileId).eq("status", "open").limit(1),
      db.from("staff_time_entries").select(ENTRY_COLS).eq("org_id", orgId).eq("profile_id", profileId).eq("status", "missed")
        .order("clock_in_at", { ascending: false }).limit(10),
    ]);
    if (error) return fail(error.message);
    const [open] = await hydrateEntries(orgId, openRows ?? [], "coach");
    const missed = await hydrateEntries(orgId, missedRows ?? [], "coach");
    const recent = await listEntries(orgId, profileId, addDayKey(today, -6), today, timeZone, "coach");
    return ok({
      open: open ?? null,
      onBreak: !!open?.breaks.some((b) => !b.endedAt),
      missed,
      recent: recent.data ?? [],
    });
  } catch (e) {
    logError("staff.getMyClockState", e);
    return fail("load_failed");
  }
}

export type Employee = { profileId: string; name: string; email: string | null; roles: string[]; coachId: string | null };

/** Everyone with a staff role in the org (admin view). */
export async function listEmployees(orgId: string): Promise<Result<Employee[]>> {
  const db = await staffDb();
  const { data: roles, error } = await db.from("staff_roles").select("profile_id,role").eq("org_id", orgId).in("role", ["admin", "finance", "coach"]);
  if (error) return fail(error.message);
  const ids = Array.from(new Set((roles ?? []).map((r) => r.profile_id)));
  if (!ids.length) return ok([]);
  const [{ data: profiles }, { data: coaches }] = await Promise.all([
    db.from("profiles").select("id,full_name,email").eq("org_id", orgId).in("id", ids),
    db.from("coaches").select("id,profile_id").eq("org_id", orgId).in("profile_id", ids),
  ]);
  const coachOf = new Map((coaches ?? []).map((c) => [c.profile_id as string, c.id]));
  const rolesOf = new Map<string, string[]>();
  for (const r of roles ?? []) rolesOf.set(r.profile_id, [...(rolesOf.get(r.profile_id) ?? []), r.role]);
  return ok(
    (profiles ?? [])
      .map((p) => ({ profileId: p.id, name: p.full_name || String(p.email ?? ""), email: p.email ? String(p.email) : null, roles: rolesOf.get(p.id) ?? [], coachId: coachOf.get(p.id) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
}

/** staff_hours() for the org (finance / admin). */
export async function getStaffHours(orgId: string, from: string, to: string): Promise<Result<StaffHoursRow[]>> {
  const db = await staffDb();
  const { data, error } = await db.rpc("staff_hours", { p_org: orgId, p_from: from, p_to: to });
  if (error) return fail(error.message);
  return ok((data ?? []) as StaffHoursRow[]);
}

export type TemplateView = {
  id: string; profileId: string; venueId: string | null; weekday: number; startTime: string; endTime: string;
  validFrom: string | null; validUntil: string | null; label: string | null; isActive: boolean;
};

export async function listShiftTemplates(orgId: string, profileId?: string): Promise<Result<TemplateView[]>> {
  const db = await staffDb();
  let q = db.from("staff_shift_templates").select("id,profile_id,venue_id,weekday,start_time,end_time,valid_from,valid_until,label,is_active")
    .eq("org_id", orgId).order("weekday").order("start_time");
  if (profileId) q = q.eq("profile_id", profileId);
  const { data, error } = await q;
  if (error) return fail(error.message);
  return ok((data ?? []).map((t) => ({
    id: t.id, profileId: t.profile_id, venueId: t.venue_id, weekday: t.weekday, startTime: t.start_time.slice(0, 5), endTime: t.end_time.slice(0, 5),
    validFrom: t.valid_from, validUntil: t.valid_until, label: t.label, isActive: t.is_active,
  })));
}

export type VenueGeo = { id: string; name: string; latitude: number | null; longitude: number | null; radiusM: number; isActive: boolean };

export async function listVenuesGeo(orgId: string): Promise<VenueGeo[]> {
  const db = await staffDb();
  const { data } = await db.from("venues").select("id,name,latitude,longitude,geofence_radius_m,is_active").eq("org_id", orgId).order("name");
  return (data ?? []).map((v) => ({
    id: v.id, name: v.name,
    latitude: v.latitude === null ? null : Number(v.latitude), longitude: v.longitude === null ? null : Number(v.longitude),
    radiusM: v.geofence_radius_m ?? 300, isActive: v.is_active,
  }));
}

export type TimesheetView = { id: string; periodStart: string; periodEnd: string; status: "approved" | "reopened"; plannedMinutes: number; workedMinutes: number; approvedAt: string | null; note: string | null };

export async function listTimesheets(orgId: string, profileId: string, from: string, to: string): Promise<TimesheetView[]> {
  const db = await staffDb();
  const { data } = await db.from("staff_timesheets").select("id,period_start,period_end,status,planned_minutes,worked_minutes,approved_at,note")
    .eq("org_id", orgId).eq("profile_id", profileId).lte("period_start", to).gte("period_end", from).order("period_start");
  return (data ?? []).map((s) => ({
    id: s.id, periodStart: s.period_start, periodEnd: s.period_end, status: s.status, plannedMinutes: s.planned_minutes,
    workedMinutes: s.worked_minutes, approvedAt: s.approved_at, note: s.note,
  }));
}

/** Org-wide missed clock-outs (admin dashboard banner). */
export async function countMissedClockOuts(orgId: string): Promise<number> {
  const db = await staffDb();
  const { count } = await db.from("staff_time_entries").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "missed");
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Roll-call history (attendance sessions the coach took)
// ---------------------------------------------------------------------------

export type RollCall = {
  attendanceSessionId: string; programSessionId: string | null; programName: string | null; date: string; status: string;
  present: number; late: number; absent: number; excused: number; total: number;
};

export async function listMyRollCalls(orgId: string, coachId: string, limit = 50): Promise<Result<RollCall[]>> {
  const db = await staffDb();
  const { data, error } = await db.from("attendance_sessions").select("id,program_id,program_session_id,session_date,status")
    .eq("org_id", orgId).eq("coach_id", coachId).order("session_date", { ascending: false }).limit(limit);
  if (error) return fail(error.message);
  const rows = data ?? [];
  if (!rows.length) return ok([]);
  const programIds = Array.from(new Set(rows.map((r) => r.program_id).filter((x): x is string => !!x)));
  const [{ data: programs }, { data: marks }] = await Promise.all([
    programIds.length ? db.from("programs").select("id,name").in("id", programIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    db.from("attendance_marks").select("attendance_session_id,status").eq("org_id", orgId).in("attendance_session_id", rows.map((r) => r.id)),
  ]);
  const name = new Map((programs ?? []).map((p) => [p.id, p.name]));
  const counts = new Map<string, Record<string, number>>();
  for (const m of marks ?? []) {
    const c = counts.get(m.attendance_session_id) ?? {};
    c[m.status] = (c[m.status] ?? 0) + 1;
    counts.set(m.attendance_session_id, c);
  }
  return ok(rows.map((r) => {
    const c = counts.get(r.id) ?? {};
    const present = c.present ?? 0, late = c.late ?? 0, absent = c.absent ?? 0, excused = c.excused ?? 0;
    return {
      attendanceSessionId: r.id, programSessionId: r.program_session_id, programName: r.program_id ? name.get(r.program_id) ?? null : null,
      date: r.session_date, status: r.status, present, late, absent, excused, total: present + late + absent + excused,
    };
  }));
}

// ---------------------------------------------------------------------------
// Lesson plans
// ---------------------------------------------------------------------------

export type Drill = { name: string; minutes: number | null; description: string | null };
export type LessonPlanView = {
  id: string; programSessionId: string | null; eventId: string | null; coachId: string | null; title: string | null;
  objectives: string | null; drills: Drill[]; notes: string | null; attachmentPath: string | null; attachmentName: string | null;
  sharedWithParents: boolean; sharedAt: string | null; updatedAt: string;
};

export function parseDrills(v: unknown): Drill[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 50).flatMap((d) => {
    if (!d || typeof d !== "object") return [];
    const o = d as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name : "";
    if (!name.trim()) return [];
    const minutes = typeof o.minutes === "number" && Number.isFinite(o.minutes) ? o.minutes : null;
    return [{ name, minutes, description: typeof o.description === "string" && o.description.trim() ? o.description : null }];
  });
}

const PLAN_COLS = "id,program_session_id,event_id,coach_id,title,objectives,drills,notes,attachment_path,attachment_name,shared_with_parents,shared_at,updated_at";

type PlanRow = {
  id: string; program_session_id: string | null; event_id: string | null; coach_id: string | null; title: string | null;
  objectives: string | null; drills: unknown; notes: string | null; attachment_path: string | null; attachment_name: string | null;
  shared_with_parents: boolean; shared_at: string | null; updated_at: string;
};
const toPlan = (p: PlanRow): LessonPlanView => ({
  id: p.id, programSessionId: p.program_session_id, eventId: p.event_id, coachId: p.coach_id, title: p.title, objectives: p.objectives,
  drills: parseDrills(p.drills), notes: p.notes, attachmentPath: p.attachment_path, attachmentName: p.attachment_name,
  sharedWithParents: p.shared_with_parents, sharedAt: p.shared_at, updatedAt: p.updated_at,
});

export async function getLessonPlan(orgId: string, kind: "session" | "event", itemId: string): Promise<LessonPlanView | null> {
  const db = await staffDb();
  const { data } = await db.from("lesson_plans").select(PLAN_COLS).eq("org_id", orgId)
    .eq(kind === "session" ? "program_session_id" : "event_id", itemId).maybeSingle();
  return data ? toPlan(data as PlanRow) : null;
}

/** Plans readable by the caller for these items (parents: shared plans of their children only — RLS). */
export async function lessonPlansFor(orgId: string, ids: { sessionIds?: string[]; eventIds?: string[] }): Promise<Map<string, LessonPlanView>> {
  const db = await staffDb();
  const out = new Map<string, LessonPlanView>();
  const [s, e] = await Promise.all([
    ids.sessionIds?.length ? db.from("lesson_plans").select(PLAN_COLS).eq("org_id", orgId).in("program_session_id", ids.sessionIds) : Promise.resolve({ data: [] }),
    ids.eventIds?.length ? db.from("lesson_plans").select(PLAN_COLS).eq("org_id", orgId).in("event_id", ids.eventIds) : Promise.resolve({ data: [] }),
  ]);
  for (const p of [...((s.data ?? []) as PlanRow[]), ...((e.data ?? []) as PlanRow[])]) {
    out.set(p.program_session_id ?? (p.event_id as string), toPlan(p));
  }
  return out;
}

export type LessonPlanListItem = LessonPlanView & { itemTitle: string | null; itemStart: string | null; coachName: string | null; href: string };

/** All plans of the org (admin). */
export async function listLessonPlans(orgId: string, limit = 200): Promise<Result<LessonPlanListItem[]>> {
  const db = await staffDb();
  const { data, error } = await db.from("lesson_plans").select(PLAN_COLS).eq("org_id", orgId).order("updated_at", { ascending: false }).limit(limit);
  if (error) return fail(error.message);
  const plans = ((data ?? []) as PlanRow[]).map(toPlan);
  const sessionIds = plans.map((p) => p.programSessionId).filter((x): x is string => !!x);
  const eventIds = plans.map((p) => p.eventId).filter((x): x is string => !!x);
  const coachIds = Array.from(new Set(plans.map((p) => p.coachId).filter((x): x is string => !!x)));
  const [sessions, events, coaches] = await Promise.all([
    sessionIds.length ? db.from("program_sessions").select("id,program_id,starts_at").eq("org_id", orgId).in("id", sessionIds) : Promise.resolve({ data: [] as { id: string; program_id: string; starts_at: string }[] }),
    eventIds.length ? db.from("events").select("id,title,type,team_id,starts_at").eq("org_id", orgId).in("id", eventIds) : Promise.resolve({ data: [] as { id: string; title: string | null; type: string; team_id: string | null; starts_at: string }[] }),
    coachIds.length ? db.from("coaches").select("id,display_name").eq("org_id", orgId).in("id", coachIds) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
  ]);
  const programIds = Array.from(new Set((sessions.data ?? []).map((s) => s.program_id)));
  const teamIds = Array.from(new Set((events.data ?? []).map((e) => e.team_id).filter((x): x is string => !!x)));
  const [programs, teams] = await Promise.all([
    programIds.length ? db.from("programs").select("id,name").in("id", programIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    teamIds.length ? db.from("teams").select("id,name").in("id", teamIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const programName = new Map((programs.data ?? []).map((p) => [p.id, p.name]));
  const teamName = new Map((teams.data ?? []).map((x) => [x.id, x.name]));
  const sessionById = new Map((sessions.data ?? []).map((s) => [s.id, s]));
  const eventById = new Map((events.data ?? []).map((e) => [e.id, e]));
  const coachName = new Map((coaches.data ?? []).map((c) => [c.id, c.display_name]));
  return ok(plans.map((p) => {
    if (p.programSessionId) {
      const s = sessionById.get(p.programSessionId);
      return { ...p, itemTitle: s ? programName.get(s.program_id) ?? null : null, itemStart: s?.starts_at ?? null, coachName: p.coachId ? coachName.get(p.coachId) ?? null : null, href: `/admin/lesson-plans/session/${p.programSessionId}` };
    }
    const e = eventById.get(p.eventId as string);
    const title = e ? [e.team_id ? teamName.get(e.team_id) : null, e.title].filter(Boolean).join(" · ") || null : null;
    return { ...p, itemTitle: title, itemStart: e?.starts_at ?? null, coachName: p.coachId ? coachName.get(p.coachId) ?? null : null, href: `/admin/lesson-plans/event/${p.eventId}` };
  }));
}

/** Short-lived signed URLs for plan attachments (Storage RLS decides who may read). */
export async function lessonPlanAttachmentUrls(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = Array.from(new Set(paths.filter((p): p is string => !!p)));
  const out = new Map<string, string>();
  if (!wanted.length) return out;
  try {
    const db = await staffDb();
    const { data } = await db.storage.from("lesson-plans").createSignedUrls(wanted, 300);
    for (const item of data ?? []) if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
  } catch (e) {
    logError("staff.lessonPlanAttachmentUrls", e);
  }
  return out;
}

export type PlanTarget = { kind: "session" | "event"; id: string; title: string; startsAt: string; endsAt: string | null; location: string | null; canEdit: boolean; coachId: string | null };

/** The session / event a plan belongs to, if the caller can read it. */
export async function getPlanTarget(orgId: string, kind: "session" | "event", id: string): Promise<PlanTarget | null> {
  const db = await staffDb();
  if (kind === "session") {
    const { data: s } = await db.from("program_sessions").select("id,program_id,coach_id,starts_at,ends_at,location").eq("org_id", orgId).eq("id", id).maybeSingle();
    if (!s) return null;
    const [{ data: prog }, { data: can }] = await Promise.all([
      db.from("programs").select("name").eq("id", s.program_id).maybeSingle(),
      db.rpc("can_plan_lesson", { p_session: id, p_event: null }),
    ]);
    return { kind, id, title: prog?.name ?? "", startsAt: s.starts_at, endsAt: s.ends_at, location: s.location, canEdit: can === true, coachId: s.coach_id };
  }
  const { data: e } = await db.from("events").select("id,team_id,title,type,starts_at,ends_at,location_text,venue_id").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (!e) return null;
  const [{ data: team }, { data: venue }, { data: can }] = await Promise.all([
    e.team_id ? db.from("teams").select("name").eq("id", e.team_id).maybeSingle() : Promise.resolve({ data: null }),
    e.venue_id ? db.from("venues").select("name").eq("id", e.venue_id).maybeSingle() : Promise.resolve({ data: null }),
    db.rpc("can_plan_lesson", { p_session: null, p_event: id }),
  ]);
  const title = [team?.name, e.title].filter(Boolean).join(" · ");
  return { kind, id, title, startsAt: e.starts_at, endsAt: e.ends_at, location: venue?.name ?? e.location_text, canEdit: can === true, coachId: null };
}
