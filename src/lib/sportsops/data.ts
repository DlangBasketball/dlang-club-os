import "server-only";
import { sportsDb, type EventRow, type EventStatus, type EventType, type HomeAway, type MembershipStatus, type RsvpStatus, type SeasonRow, type TeamRow } from "./db";
import { findConflicts } from "./conflicts";
import { rangeBounds } from "./time";
import { signCoachPhotos } from "@/lib/people/server";
import { isPhotoPathFor } from "@/lib/people/validation";

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(d: T): Result<T> => ({ data: d, error: null });
const fail = (e: string): Result<never> => ({ data: null, error: e });
const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => Boolean(x))));
const fullName = (a: { first_name: string; last_name: string }) => `${a.first_name} ${a.last_name}`;

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
export type Season = { id: string; name: string; startsOn: string; endsOn: string; isCurrent: boolean };
const toSeason = (s: SeasonRow): Season => ({ id: s.id, name: s.name, startsOn: s.starts_on, endsOn: s.ends_on, isCurrent: s.is_current });

export async function listSeasons(): Promise<Result<Season[]>> {
  const db = await sportsDb();
  const { data, error } = await db.from("seasons").select("*").order("starts_on", { ascending: false });
  if (error) return fail(error.message);
  return ok((data ?? []).map(toSeason));
}

export type Venue = { id: string; name: string; address: string | null; city: string | null; capacity: number | null; isActive: boolean; spaces: { id: string; name: string }[] };
export async function listVenues(): Promise<Result<Venue[]>> {
  const db = await sportsDb();
  const [v, s] = await Promise.all([
    db.from("venues").select("*").order("name"),
    db.from("venue_spaces").select("*").eq("is_active", true).order("name"),
  ]);
  if (v.error) return fail(v.error.message);
  if (s.error) return fail(s.error.message);
  return ok((v.data ?? []).map((x) => ({
    id: x.id, name: x.name, address: x.address, city: x.city, capacity: x.capacity, isActive: x.is_active,
    spaces: (s.data ?? []).filter((sp) => sp.venue_id === x.id).map((sp) => ({ id: sp.id, name: sp.name })),
  })));
}

export type Option = { id: string; name: string };
export async function listCoachOptions(): Promise<Result<Option[]>> {
  const db = await sportsDb();
  const { data, error } = await db.from("coaches").select("id,display_name,is_active").eq("is_active", true).order("display_name");
  if (error) return fail(error.message);
  return ok((data ?? []).map((c) => ({ id: c.id, name: c.display_name })));
}

export async function listProgramOptions(): Promise<Result<Option[]>> {
  const db = await sportsDb();
  const { data, error } = await db.from("programs").select("id,name").order("name");
  if (error) return fail(error.message);
  return ok((data ?? []).map((p) => ({ id: p.id, name: p.name })));
}

export async function listAthleteOptions(): Promise<Result<Option[]>> {
  const db = await sportsDb();
  const { data, error } = await db.from("athletes").select("id,first_name,last_name,status").neq("status", "archived").order("last_name");
  if (error) return fail(error.message);
  return ok((data ?? []).map((a) => ({ id: a.id, name: fullName(a) })));
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------
export type TeamSummary = {
  id: string; name: string; sport: string | null; ageGroup: string | null; gender: string | null; level: string | null;
  color: string | null; isActive: boolean; seasonId: string | null; seasonName: string | null; programId: string | null;
  coaches: { id: string; name: string; role: string; title: string | null; photoUrl: string | null }[]; rosterCount: number;
};

async function hydrateTeams(teams: TeamRow[]): Promise<Result<TeamSummary[]>> {
  const db = await sportsDb();
  const ids = teams.map((t) => t.id);
  if (!ids.length) return ok([]);
  const [tc, tm, se] = await Promise.all([
    db.from("team_coaches").select("team_id,coach_id,role").in("team_id", ids),
    db.from("team_memberships").select("team_id,status").in("team_id", ids),
    db.from("seasons").select("id,name").in("id", uniq(teams.map((t) => t.season_id))),
  ]);
  if (tc.error) return fail(tc.error.message);
  const coachIds = uniq((tc.data ?? []).map((r) => r.coach_id));
  type CoachLite = { id: string; org_id: string; display_name: string; role_title: string | null; photo_path: string | null };
  const co = coachIds.length
    ? await db.from("coaches").select("id,org_id,display_name,role_title,photo_path").in("id", coachIds)
    : { data: [] as CoachLite[] };
  const coachRows = (co.data ?? []) as CoachLite[];
  const coachName = new Map(coachRows.map((c) => [c.id, c.display_name]));
  const coachTitle = new Map(coachRows.map((c) => [c.id, c.role_title]));
  const coachPhoto = await signCoachPhotos(
    coachRows.filter((c) => isPhotoPathFor(c.photo_path, c.org_id, c.id)).map((c) => ({ id: c.id, photoPath: c.photo_path })),
  );
  const seasonName = new Map((se.data ?? []).map((s) => [s.id, s.name]));
  return ok(teams.map((t) => ({
    id: t.id, name: t.name, sport: t.sport, ageGroup: t.age_group, gender: t.gender, level: t.level, color: t.color,
    isActive: t.is_active, seasonId: t.season_id, seasonName: t.season_id ? seasonName.get(t.season_id) ?? null : null, programId: t.program_id,
    coaches: (tc.data ?? []).filter((r) => r.team_id === t.id).map((r) => ({
      id: r.coach_id, name: coachName.get(r.coach_id) ?? "Coach", role: r.role,
      title: coachTitle.get(r.coach_id) ?? null, photoUrl: coachPhoto.get(r.coach_id) ?? null,
    })),
    rosterCount: (tm.data ?? []).filter((m) => m.team_id === t.id && m.status !== "inactive").length,
  })));
}

export async function listTeams(opts: { seasonId?: string; includeInactive?: boolean } = {}): Promise<Result<TeamSummary[]>> {
  const db = await sportsDb();
  let q = db.from("teams").select("*").order("name");
  if (opts.seasonId) q = q.eq("season_id", opts.seasonId);
  if (!opts.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) return fail(error.message);
  return hydrateTeams(data ?? []);
}

export type RosterEntry = { membershipId: string; athleteId: string; name: string; jerseyNumber: number | null; position: string | null; status: MembershipStatus; joinedOn: string };
export type TeamDetail = TeamSummary & { notes: string | null; roster: RosterEntry[] };

export async function getTeam(id: string): Promise<Result<TeamDetail | null>> {
  const db = await sportsDb();
  const { data: team, error } = await db.from("teams").select("*").eq("id", id).maybeSingle();
  if (error) return fail(error.message);
  if (!team) return ok(null);
  const summary = await hydrateTeams([team]);
  if (summary.error !== null) return fail(summary.error);
  const { data: members, error: mErr } = await db.from("team_memberships").select("*").eq("team_id", id);
  if (mErr) return fail(mErr.message);
  const aIds = uniq((members ?? []).map((m) => m.athlete_id));
  const ath = aIds.length ? await db.from("athletes").select("id,first_name,last_name").in("id", aIds) : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const names = new Map((ath.data ?? []).map((a) => [a.id, fullName(a)]));
  const roster = (members ?? []).map((m) => ({
    membershipId: m.id, athleteId: m.athlete_id, name: names.get(m.athlete_id) ?? "Athlete", jerseyNumber: m.jersey_number,
    position: m.position, status: m.status, joinedOn: m.joined_on,
  })).sort((a, b) => (a.status === "inactive" ? 1 : 0) - (b.status === "inactive" ? 1 : 0) || (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999) || a.name.localeCompare(b.name));
  return ok({ ...summary.data[0], notes: team.notes, roster });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
export type EventItem = {
  id: string; type: EventType; title: string | null; status: EventStatus; startsAt: string; endsAt: string;
  teamId: string | null; teamName: string | null; teamColor: string | null; venueId: string | null; venueName: string | null;
  spaceId: string | null; spaceName: string | null; locationText: string | null; opponent: string | null; homeAway: HomeAway | null;
  notes: string | null; conflictsWith: string[]; result: { scoreFor: number; scoreAgainst: number; outcome: string } | null;
  venueAddress: string | null; locationName: string | null; seriesId: string | null; cancelReason: string | null; cancelledAt: string | null;
};

async function hydrateEvents(rows: EventRow[]): Promise<EventItem[]> {
  const db = await sportsDb();
  const ids = rows.map((e) => e.id);
  const [t, v, s, r] = await Promise.all([
    uniq(rows.map((e) => e.team_id)).length ? db.from("teams").select("id,name,color").in("id", uniq(rows.map((e) => e.team_id))) : Promise.resolve({ data: [] as { id: string; name: string; color: string | null }[] }),
    uniq(rows.map((e) => e.venue_id)).length ? db.from("venues").select("id,name,address,city").in("id", uniq(rows.map((e) => e.venue_id))) : Promise.resolve({ data: [] as { id: string; name: string; address: string | null; city: string | null }[] }),
    uniq(rows.map((e) => e.venue_space_id)).length ? db.from("venue_spaces").select("id,name").in("id", uniq(rows.map((e) => e.venue_space_id))) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ids.length ? db.from("game_results").select("event_id,score_for,score_against,outcome").in("event_id", ids) : Promise.resolve({ data: [] as { event_id: string; score_for: number; score_against: number; outcome: string }[] }),
  ]);
  const team = new Map((t.data ?? []).map((x) => [x.id, x]));
  const venue = new Map((v.data ?? []).map((x) => [x.id, x.name]));
  const venueAddr = new Map((v.data ?? []).map((x) => [x.id, [x.address, x.city].filter(Boolean).join(", ") || null]));
  const space = new Map((s.data ?? []).map((x) => [x.id, x.name]));
  const result = new Map((r.data ?? []).map((x) => [x.event_id, x]));
  const conflicts = findConflicts(rows.map((e) => ({ id: e.id, venueId: e.venue_id, spaceId: e.venue_space_id, startsAt: e.starts_at, endsAt: e.ends_at, status: e.status })));
  return rows.map((e) => {
    const res = result.get(e.id);
    return {
      id: e.id, type: e.type, title: e.title, status: e.status, startsAt: e.starts_at, endsAt: e.ends_at,
      teamId: e.team_id, teamName: e.team_id ? team.get(e.team_id)?.name ?? null : null, teamColor: e.team_id ? team.get(e.team_id)?.color ?? null : null,
      venueId: e.venue_id, venueName: e.venue_id ? venue.get(e.venue_id) ?? null : null,
      spaceId: e.venue_space_id, spaceName: e.venue_space_id ? space.get(e.venue_space_id) ?? null : null,
      locationText: e.location_text, opponent: e.opponent, homeAway: e.home_away, notes: e.notes,
      conflictsWith: conflicts.get(e.id) ?? [],
      result: res ? { scoreFor: res.score_for, scoreAgainst: res.score_against, outcome: res.outcome } : null,
      venueAddress: e.venue_id ? venueAddr.get(e.venue_id) ?? null : null,
      locationName: e.location_name ?? null, seriesId: e.series_id ?? null,
      cancelReason: e.cancel_reason ?? null, cancelledAt: e.cancelled_at ?? null,
    };
  });
}

/** Events in [fromKey, toKey] club-local days (RLS scopes what the caller may see). */
export async function listEvents(opts: { fromKey: string; toKey: string; teamIds?: string[]; includeCancelled?: boolean }): Promise<Result<EventItem[]>> {
  const db = await sportsDb();
  const { from, to } = rangeBounds(opts.fromKey, opts.toKey);
  let q = db.from("events").select("*").gte("starts_at", from).lt("starts_at", to).order("starts_at");
  if (opts.teamIds) {
    if (!opts.teamIds.length) return ok([]);
    q = q.in("team_id", opts.teamIds);
  }
  if (!opts.includeCancelled) q = q.neq("status", "cancelled");
  const { data, error } = await q.limit(1000);
  if (error) return fail(error.message);
  return ok(await hydrateEvents(data ?? []));
}

export async function listUpcomingEvents(opts: { teamIds?: string[]; limit?: number } = {}): Promise<Result<EventItem[]>> {
  const db = await sportsDb();
  let q = db.from("events").select("*").gte("ends_at", new Date().toISOString()).neq("status", "cancelled").order("starts_at");
  if (opts.teamIds) {
    if (!opts.teamIds.length) return ok([]);
    q = q.in("team_id", opts.teamIds);
  }
  const { data, error } = await q.limit(opts.limit ?? 50);
  if (error) return fail(error.message);
  return ok(await hydrateEvents(data ?? []));
}

export type RsvpLine = { athleteId: string; name: string; jerseyNumber: number | null; status: RsvpStatus | null; note: string | null; respondedAt: string | null };
export type EventDetail = EventItem & { rsvps: RsvpLine[]; resultNotes: string | null };

export async function getEvent(id: string): Promise<Result<EventDetail | null>> {
  const db = await sportsDb();
  const { data: ev, error } = await db.from("events").select("*").eq("id", id).maybeSingle();
  if (error) return fail(error.message);
  if (!ev) return ok(null);
  const [item] = await hydrateEvents([ev]);
  // Re-check conflicts against neighbours at the same venue.
  if (ev.venue_id) {
    const { data: c } = await db.rpc("event_conflicts", { p_venue: ev.venue_id, p_space: ev.venue_space_id, p_start: ev.starts_at, p_end: ev.ends_at, p_exclude_event: ev.id });
    item.conflictsWith = (c ?? []).map((x) => x.event_id);
  }
  const [rs, roster, gr] = await Promise.all([
    db.from("event_rsvps").select("*").eq("event_id", id),
    ev.team_id ? db.from("team_memberships").select("athlete_id,jersey_number,status").eq("team_id", ev.team_id).neq("status", "inactive") : Promise.resolve({ data: [] as { athlete_id: string; jersey_number: number | null; status: string }[] }),
    db.from("game_results").select("notes").eq("event_id", id).maybeSingle(),
  ]);
  const rsvp = new Map((rs.data ?? []).map((r) => [r.athlete_id, r]));
  const aIds = uniq([...(roster.data ?? []).map((m) => m.athlete_id), ...(rs.data ?? []).map((r) => r.athlete_id)]);
  const ath = aIds.length ? await db.from("athletes").select("id,first_name,last_name").in("id", aIds) : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const names = new Map((ath.data ?? []).map((a) => [a.id, fullName(a)]));
  const jersey = new Map((roster.data ?? []).map((m) => [m.athlete_id, m.jersey_number]));
  const rsvps = aIds.map((aid) => {
    const r = rsvp.get(aid);
    return { athleteId: aid, name: names.get(aid) ?? "Athlete", jerseyNumber: jersey.get(aid) ?? null, status: r?.status ?? null, note: r?.note ?? null, respondedAt: r?.responded_at ?? null };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return ok({ ...item, rsvps, resultNotes: gr.data?.notes ?? null });
}

/** RSVP tallies per event (for list views). */
export async function rsvpCounts(eventIds: string[]): Promise<Map<string, Record<RsvpStatus, number>>> {
  const out = new Map<string, Record<RsvpStatus, number>>();
  if (!eventIds.length) return out;
  const db = await sportsDb();
  const { data } = await db.from("event_rsvps").select("event_id,status").in("event_id", eventIds);
  for (const r of data ?? []) {
    const c = out.get(r.event_id) ?? { going: 0, maybe: 0, not_going: 0 };
    c[r.status] += 1;
    out.set(r.event_id, c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Coach: my teams
// ---------------------------------------------------------------------------
export async function getMyCoachTeams(): Promise<Result<TeamDetail[]>> {
  const db = await sportsDb();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return fail("Not signed in");
  const { data: coach } = await db.from("coaches").select("id").eq("profile_id", user.id).maybeSingle();
  if (!coach) return ok([]);
  const { data: links, error } = await db.from("team_coaches").select("team_id").eq("coach_id", coach.id);
  if (error) return fail(error.message);
  const out: TeamDetail[] = [];
  for (const l of links ?? []) {
    const t = await getTeam(l.team_id);
    if (t.data && t.data.isActive) out.push(t.data);
  }
  return ok(out.sort((a, b) => a.name.localeCompare(b.name)));
}

// ---------------------------------------------------------------------------
// Parent: children's schedule
// ---------------------------------------------------------------------------
export type ChildEvent = EventItem & { children: { athleteId: string; name: string; rsvp: RsvpStatus | null; note: string | null }[] };

export async function getChildrenSchedule(limit = 40): Promise<Result<{ events: ChildEvent[]; hasTeams: boolean }>> {
  const db = await sportsDb();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return fail("Not signed in");
  const { data: fams } = await db.from("family_members").select("family_id").eq("profile_id", user.id);
  const famIds = uniq((fams ?? []).map((f) => f.family_id));
  if (!famIds.length) return ok({ events: [], hasTeams: false });
  const { data: kids, error } = await db.from("athletes").select("id,first_name,last_name,family_id").in("family_id", famIds);
  if (error) return fail(error.message);
  const kidIds = (kids ?? []).map((k) => k.id);
  if (!kidIds.length) return ok({ events: [], hasTeams: false });
  const { data: mems } = await db.from("team_memberships").select("team_id,athlete_id,status").in("athlete_id", kidIds).neq("status", "inactive");
  const teamIds = uniq((mems ?? []).map((m) => m.team_id));
  if (!teamIds.length) return ok({ events: [], hasTeams: false });
  const up = await listUpcomingEvents({ teamIds, limit });
  if (up.error !== null) return fail(up.error);
  const evIds = up.data.map((e) => e.id);
  const { data: rs } = evIds.length ? await db.from("event_rsvps").select("event_id,athlete_id,status,note").in("event_id", evIds).in("athlete_id", kidIds) : { data: [] as { event_id: string; athlete_id: string; status: RsvpStatus; note: string | null }[] };
  const kidName = new Map((kids ?? []).map((k) => [k.id, k.first_name]));
  const events = up.data.map((e) => ({
    ...e,
    children: (mems ?? []).filter((m) => m.team_id === e.teamId).map((m) => {
      const r = (rs ?? []).find((x) => x.event_id === e.id && x.athlete_id === m.athlete_id);
      return { athleteId: m.athlete_id, name: kidName.get(m.athlete_id) ?? "Child", rsvp: r?.status ?? null, note: r?.note ?? null };
    }),
  }));
  return ok({ events, hasTeams: true });
}

