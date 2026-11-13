import "server-only";
import type { Translator } from "@/lib/i18n/translator";
import { addDayKey, expandShiftTemplates, windowFor, zonedDayKey } from "@/lib/staff/hours";
import type { StaffClient } from "@/lib/staff/db";
import { mergeSources, type CalendarItem } from "./aggregate";

/**
 * Loads calendar items for one viewer. The same code serves the in-app
 * calendars (RLS client) and the ICS feed (service client): every query is
 * filtered explicitly by the viewer's org and scope, so the feed never shows
 * more than the viewer could see in the app.
 *
 *   admin   everything in the org
 *   coach   own programme sessions, events of teams they coach and club-wide
 *           team events, own training bookings, own planned shifts, club
 *           events for everyone / staff
 *   parent  their children's team events and club-wide team events, sessions
 *           and camp editions of programmes the children are registered in,
 *           the children's bookings, club events for everyone / parents
 *
 * Titles never carry athletes' names (feeds leave the app).
 */
export type CalendarAudience = "admin" | "coach" | "parent";

export type CalendarScope = {
  orgId: string;
  profileId: string;
  audience: CalendarAudience;
  coachId: string | null;
  teamIds: string[];
  athleteIds: string[];
  programIds: string[];
};

export async function resolveScope(db: StaffClient, orgId: string, profileId: string, audience: CalendarAudience): Promise<CalendarScope> {
  const scope: CalendarScope = { orgId, profileId, audience, coachId: null, teamIds: [], athleteIds: [], programIds: [] };
  if (audience === "coach" || audience === "admin") {
    const { data: coach } = await db.from("coaches").select("id").eq("org_id", orgId).eq("profile_id", profileId).limit(1).maybeSingle();
    scope.coachId = coach?.id ?? null;
    if (audience === "coach" && scope.coachId) {
      const { data: links } = await db.from("team_coaches").select("team_id").eq("org_id", orgId).eq("coach_id", scope.coachId);
      scope.teamIds = (links ?? []).map((l) => l.team_id);
    }
  }
  if (audience === "parent") {
    const { data: members } = await db.from("family_members").select("family_id").eq("profile_id", profileId);
    const familyIds = (members ?? []).map((m) => m.family_id);
    if (familyIds.length) {
      const { data: kids } = await db.from("athletes").select("id").eq("org_id", orgId).in("family_id", familyIds);
      scope.athleteIds = (kids ?? []).map((k) => k.id);
    }
    if (scope.athleteIds.length) {
      const [{ data: tm }, { data: regs }] = await Promise.all([
        db.from("team_memberships").select("team_id,status").eq("org_id", orgId).in("athlete_id", scope.athleteIds),
        db.from("registrations").select("program_id,status").eq("org_id", orgId).in("athlete_id", scope.athleteIds),
      ]);
      scope.teamIds = Array.from(new Set((tm ?? []).filter((m) => m.status !== "inactive").map((m) => m.team_id)));
      scope.programIds = Array.from(new Set((regs ?? []).filter((r) => r.status !== "cancelled").map((r) => r.program_id)));
    }
  }
  return scope;
}

function hrefFor(audience: CalendarAudience, kind: CalendarItem["kind"], ids: { id: string; programId?: string | null; profileId?: string | null }): string | null {
  switch (kind) {
    case "team_event":
      return audience === "admin" ? `/admin/schedule/${ids.id}` : audience === "coach" ? `/coach/team/events/${ids.id}` : "/parent/schedule";
    case "session":
      return audience === "admin" ? (ids.programId ? `/admin/programs/${ids.programId}` : null) : audience === "coach" ? `/coach/attendance/${ids.id}` : "/parent/schedule";
    case "camp":
      return audience === "admin" ? (ids.programId ? `/admin/programs/${ids.programId}` : null) : audience === "parent" && ids.programId ? `/parent/camps/${ids.programId}` : null;
    case "booking":
      return audience === "admin" ? `/admin/bookings/${ids.id}` : audience === "coach" ? "/coach/schedule" : `/parent/bookings/${ids.id}`;
    case "shift":
      return audience === "admin" ? (ids.profileId ? `/admin/timesheets/${ids.profileId}` : null) : "/coach/clock";
    case "club_event":
      return audience === "admin" ? `/admin/calendar/events/${ids.id}` : null;
  }
}

/** Items touching club-local days [fromKey, toKey] for this scope. */
export async function loadCalendarItems(
  db: StaffClient,
  scope: CalendarScope,
  range: { from: string; to: string; timeZone: string },
  t: Translator,
): Promise<CalendarItem[]> {
  const { orgId, audience } = scope;
  const win = windowFor(addDayKey(range.from, -1), addDayKey(range.to, 1), range.timeZone);
  const fromIso = win.from.toISOString();
  const toIso = win.to.toISOString();
  const isAdmin = audience === "admin";
  const isCoach = audience === "coach";
  const isParent = audience === "parent";

  // ---- team events --------------------------------------------------------
  const eventsQ = (async () => {
    let q = db.from("events")
      .select("id,team_id,program_session_id,type,title,venue_id,location_text,starts_at,ends_at,opponent,status,notes")
      .eq("org_id", orgId).lt("starts_at", toIso).gt("ends_at", fromIso).order("starts_at").limit(1000);
    if (!isAdmin) {
      q = scope.teamIds.length ? q.or(`team_id.is.null,team_id.in.(${scope.teamIds.join(",")})`) : q.is("team_id", null);
    }
    const { data } = await q;
    return data ?? [];
  })();

  // ---- programme sessions -------------------------------------------------
  const sessionsQ = (async () => {
    if (isCoach && !scope.coachId) return [];
    if (isParent && scope.programIds.length === 0) return [];
    let q = db.from("program_sessions").select("id,program_id,coach_id,starts_at,ends_at,location")
      .eq("org_id", orgId).gte("starts_at", new Date(win.from.getTime() - 864e5).toISOString()).lt("starts_at", toIso).order("starts_at").limit(1000);
    if (isCoach) q = q.eq("coach_id", scope.coachId as string);
    if (isParent) q = q.in("program_id", scope.programIds);
    const { data } = await q;
    return data ?? [];
  })();

  // ---- camp editions --------------------------------------------------------
  const campsQ = (async () => {
    if (isCoach) return [];
    if (isParent && scope.programIds.length === 0) return [];
    let q = db.from("camp_editions").select("id,org_id,program_id,name,starts_on,ends_on,venue_id,location_name,city,status,archived_at")
      .eq("org_id", orgId).lte("starts_on", range.to).gte("ends_on", range.from).is("archived_at", null).limit(500);
    q = isParent ? q.in("program_id", scope.programIds).eq("status", "published") : q.neq("status", "cancelled");
    const { data } = await q;
    return data ?? [];
  })();

  // ---- training bookings ----------------------------------------------------
  const bookingsQ = (async () => {
    if (isCoach && !scope.coachId) return [];
    if (isParent && scope.athleteIds.length === 0) return [];
    let q = db.from("training_bookings").select("id,service_id,coach_id,slot_start,slot_end,status")
      .eq("org_id", orgId).gte("slot_start", fromIso).lt("slot_start", toIso).neq("status", "cancelled").order("slot_start").limit(1000);
    if (isCoach) q = q.eq("coach_id", scope.coachId as string);
    if (isParent) q = q.in("athlete_id", scope.athleteIds);
    const { data } = await q;
    return data ?? [];
  })();

  // ---- planned shifts -------------------------------------------------------
  const shiftsQ = (async () => {
    if (isParent) return [];
    let q = db.from("staff_shift_templates")
      .select("id,profile_id,venue_id,weekday,start_time,end_time,valid_from,valid_until,label,is_active")
      .eq("org_id", orgId).eq("is_active", true).limit(1000);
    if (!isAdmin) q = q.eq("profile_id", scope.profileId);
    const { data } = await q;
    return data ?? [];
  })();

  // ---- club events ----------------------------------------------------------
  const clubQ = (async () => {
    let q = db.from("club_events").select("id,title,type,starts_at,ends_at,all_day,venue_id,location,audience,description,team_id")
      .eq("org_id", orgId).lt("starts_at", toIso).gte("ends_at", fromIso).order("starts_at").limit(500);
    if (isCoach) q = q.in("audience", ["everyone", "staff"]);
    if (isParent) q = q.in("audience", ["everyone", "parents"]);
    const { data } = await q;
    return data ?? [];
  })();

  const [events, sessions, camps, bookings, templates, clubEvents] = await Promise.all([eventsQ, sessionsQ, campsQ, bookingsQ, shiftsQ, clubQ]);

  // ---- lookups ----------------------------------------------------------------
  const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => !!x)));
  const teamIds = uniq([...events.map((e) => e.team_id), ...clubEvents.map((c) => c.team_id)]);
  const programIds = uniq([...sessions.map((s) => s.program_id), ...camps.map((c) => c.program_id)]);
  const venueIds = uniq([...events.map((e) => e.venue_id), ...camps.map((c) => c.venue_id), ...templates.map((s) => s.venue_id), ...clubEvents.map((c) => c.venue_id)]);
  const serviceIds = uniq(bookings.map((b) => b.service_id));
  const profileIds = isAdmin ? uniq(templates.map((s) => s.profile_id)) : [];

  const [teams, teamCoaches, programs, venues, services, profiles] = await Promise.all([
    teamIds.length ? db.from("teams").select("id,name,color").eq("org_id", orgId).in("id", teamIds).then((r) => r.data ?? []) : Promise.resolve([]),
    teamIds.length && !isParent ? db.from("team_coaches").select("team_id,coach_id").eq("org_id", orgId).in("team_id", teamIds).then((r) => r.data ?? []) : Promise.resolve([]),
    programIds.length ? db.from("programs").select("id,name").eq("org_id", orgId).in("id", programIds).then((r) => r.data ?? []) : Promise.resolve([]),
    venueIds.length ? db.from("venues").select("id,name").eq("org_id", orgId).in("id", venueIds).then((r) => r.data ?? []) : Promise.resolve([]),
    serviceIds.length ? db.from("training_services").select("id,name,duration_min").eq("org_id", orgId).in("id", serviceIds).then((r) => r.data ?? []) : Promise.resolve([]),
    profileIds.length ? db.from("profiles").select("id,full_name,email").eq("org_id", orgId).in("id", profileIds).then((r) => r.data ?? []) : Promise.resolve([]),
  ]);
  const teamById = new Map(teams.map((x) => [x.id, x]));
  const programName = new Map(programs.map((p) => [p.id, p.name]));
  const venueName = new Map(venues.map((v) => [v.id, v.name]));
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const personName = new Map(profiles.map((p) => [p.id, p.full_name || String(p.email ?? "")]));
  const coachesOfTeam = new Map<string, string[]>();
  for (const tc of teamCoaches) coachesOfTeam.set(tc.team_id, [...(coachesOfTeam.get(tc.team_id) ?? []), tc.coach_id]);

  const items: CalendarItem[] = [];

  for (const e of events) {
    const team = e.team_id ? teamById.get(e.team_id) : undefined;
    const typeLabel = t.dynamic(`staff.calendar.eventTypes.${e.type}`);
    const base = e.title?.trim() || (e.opponent ? t("staff.calendar.versus", { type: typeLabel, opponent: e.opponent }) : typeLabel);
    items.push({
      id: `team_event:${e.id}`, kind: "team_event", sourceId: e.id,
      title: team ? `${team.name} · ${base}` : base, subtype: e.type,
      start: e.starts_at, end: e.ends_at, allDay: false,
      location: (e.venue_id ? venueName.get(e.venue_id) : null) ?? e.location_text ?? null,
      venueId: e.venue_id, teamId: e.team_id, coachIds: e.team_id ? coachesOfTeam.get(e.team_id) ?? [] : [],
      profileId: null, status: e.status, href: hrefFor(audience, "team_event", { id: e.id }), color: team?.color ?? null,
      description: isParent ? null : e.notes, linkedSessionId: e.program_session_id,
    });
  }

  for (const s of sessions) {
    const end = s.ends_at ?? new Date(Date.parse(s.starts_at) + 90 * 60000).toISOString();
    items.push({
      id: `session:${s.id}`, kind: "session", sourceId: s.id,
      title: programName.get(s.program_id) ?? t("staff.calendar.kinds.session"), subtype: null,
      start: s.starts_at, end, allDay: false, location: s.location, venueId: null, teamId: null,
      coachIds: s.coach_id ? [s.coach_id] : [], profileId: null, status: null,
      href: hrefFor(audience, "session", { id: s.id, programId: s.program_id }), color: null, description: null,
    });
  }

  for (const c of camps) {
    const prog = programName.get(c.program_id) ?? t("staff.calendar.kinds.camp");
    items.push({
      id: `camp:${c.id}`, kind: "camp", sourceId: c.id,
      title: c.name ? `${prog} · ${c.name}` : prog, subtype: c.status,
      start: c.starts_on, end: c.ends_on, allDay: true,
      location: (c.venue_id ? venueName.get(c.venue_id) : null) ?? c.location_name ?? c.city ?? null,
      venueId: c.venue_id, teamId: null, coachIds: [], profileId: null, status: c.status === "draft" ? "draft" : null,
      href: hrefFor(audience, "camp", { id: c.id, programId: c.program_id }), color: null, description: null,
    });
  }

  for (const b of bookings) {
    const svc = serviceById.get(b.service_id);
    const end = b.slot_end ?? new Date(Date.parse(b.slot_start) + (svc?.duration_min ?? 60) * 60000).toISOString();
    items.push({
      id: `booking:${b.id}`, kind: "booking", sourceId: b.id,
      title: svc?.name ?? t("staff.calendar.kinds.booking"), subtype: b.status,
      start: b.slot_start, end, allDay: false, location: null, venueId: null, teamId: null,
      coachIds: [b.coach_id], profileId: null, status: b.status,
      href: hrefFor(audience, "booking", { id: b.id }), color: null, description: null,
    });
  }

  const shifts = expandShiftTemplates(
    templates.map((s) => ({
      id: s.id, profileId: s.profile_id, venueId: s.venue_id, weekday: s.weekday, startTime: s.start_time, endTime: s.end_time,
      validFrom: s.valid_from, validUntil: s.valid_until, isActive: s.is_active,
    })),
    range.from, range.to, range.timeZone,
  );
  const labelOf = new Map(templates.map((s) => [s.id, s.label]));
  for (const s of shifts) {
    const who = isAdmin ? personName.get(s.profileId) : null;
    items.push({
      id: `shift:${s.templateId}:${s.dayKey}`, kind: "shift", sourceId: s.templateId,
      title: who ? t("staff.calendar.shiftOf", { name: who }) : labelOf.get(s.templateId) || t("staff.calendar.kinds.shift"),
      subtype: null, start: s.start.toISOString(), end: s.end.toISOString(), allDay: false,
      location: s.venueId ? venueName.get(s.venueId) ?? null : null, venueId: s.venueId, teamId: null, coachIds: [],
      profileId: s.profileId, status: null, href: hrefFor(audience, "shift", { id: s.templateId, profileId: s.profileId }), color: null,
      description: labelOf.get(s.templateId) ?? null,
    });
  }

  for (const c of clubEvents) {
    items.push({
      id: `club_event:${c.id}`, kind: "club_event", sourceId: c.id, title: c.title, subtype: c.type,
      start: c.all_day ? zonedDayKey(c.starts_at, range.timeZone) : c.starts_at,
      end: c.all_day ? zonedDayKey(c.ends_at, range.timeZone) : c.ends_at,
      allDay: c.all_day,
      location: (c.venue_id ? venueName.get(c.venue_id) : null) ?? c.location ?? null,
      venueId: c.venue_id, teamId: c.team_id, coachIds: [], profileId: null, status: null,
      href: hrefFor(audience, "club_event", { id: c.id }), color: c.team_id ? teamById.get(c.team_id)?.color ?? null : null,
      description: c.description,
    });
  }

  return mergeSources(items);
}
