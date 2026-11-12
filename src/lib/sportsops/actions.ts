"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { sportsDb, type ConflictRow } from "./db";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const ERR: Record<string, string> = {
  NOT_AUTHORIZED: "You don't have permission to do that.",
  NOT_ON_TEAM: "That athlete isn't on this team.",
  EVENT_CLOSED: "This event is finished or cancelled — RSVPs are closed.",
  EVENT_NOT_FOUND: "That event no longer exists.",
  CROSS_ORG_REFERENCE: "That selection belongs to another organization.",
  NOT_A_GAME: "Scores can only be recorded for games and tournaments.",
};
function friendly(message: string): string {
  if (ERR[message]) return ERR[message];
  if (message.includes("events_space_no_overlap")) return "That court/field is already booked at this time.";
  if (message.includes("team_memberships_jersey_uniq")) return "That jersey number is already taken on this team.";
  if (message.includes("team_memberships_team_id_athlete_id_key")) return "That athlete is already on this team.";
  if (message.includes("seasons_one_current")) return "Another season is already marked as current.";
  if (message.includes("teams_name_per_season")) return "A team with that name already exists in this season.";
  if (message.includes("duplicate key")) return "That already exists.";
  if (message.includes("row-level security")) return ERR.NOT_AUTHORIZED;
  return message;
}

async function requireStaff(roles: ("admin" | "coach")[] = ["admin"]) {
  const me = await getSessionUser();
  if (!me || !me.orgId || !me.roles.some((r) => (roles as string[]).includes(r))) return null;
  return me;
}

const optText = z.string().trim().max(200).optional().transform((v) => (v ? v : null));
const uuid = z.string().uuid();
const optUuid = z.union([z.string().uuid(), z.literal(""), z.null()]).optional().transform((v) => (v ? v : null));
const parseErr = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");

function revalidateAll(teamId?: string | null) {
  revalidatePath("/admin/teams");
  if (teamId) revalidatePath(`/admin/teams/${teamId}`);
  revalidatePath("/admin/schedule");
  revalidatePath("/coach/team");
  revalidatePath("/parent/schedule");
}

// ===========================================================================
// Seasons
// ===========================================================================
const SeasonInput = z.object({
  name: z.string().trim().min(1).max(80),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isCurrent: z.boolean().default(false),
}).refine((s) => s.endsOn >= s.startsOn, { message: "End date must be after start date", path: ["endsOn"] });
export type SeasonInput = z.input<typeof SeasonInput>;

export async function createSeason(input: SeasonInput): Promise<ActionResult<{ id: string }>> {
  const me = await requireStaff();
  if (!me) return { ok: false, error: ERR.NOT_AUTHORIZED };
  const p = SeasonInput.safeParse(input);
  if (!p.success) return { ok: false, error: parseErr(p.error) };
  const db = await sportsDb();
  if (p.data.isCurrent) await db.from("seasons").update({ is_current: false }).eq("org_id", me.orgId!).eq("is_current", true);
  const { data, error } = await db.from("seasons")
    .insert({ org_id: me.orgId, name: p.data.name, starts_on: p.data.startsOn, ends_on: p.data.endsOn, is_current: p.data.isCurrent })
    .select("id").single();
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateAll();
  return { ok: true, data: { id: data.id } };
}

// ===========================================================================
// Venues
// ===========================================================================
const VenueInput = z.object({
  name: z.string().trim().min(1).max(120),
  address: optText,
  city: optText,
  capacity: z.number().int().min(0).max(200000).nullable().optional(),
  spaces: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
});
export type VenueInput = z.input<typeof VenueInput>;

export async function createVenue(input: VenueInput): Promise<ActionResult<{ id: string }>> {
  const me = await requireStaff();
  if (!me) return { ok: false, error: ERR.NOT_AUTHORIZED };
  const p = VenueInput.safeParse(input);
  if (!p.success) return { ok: false, error: parseErr(p.error) };
  const db = await sportsDb();
  const { data, error } = await db.from("venues")
    .insert({ org_id: me.orgId, name: p.data.name, address: p.data.address, city: p.data.city, capacity: p.data.capacity ?? null })
    .select("id").single();
  if (error) return { ok: false, error: friendly(error.message) };
  const spaces = Array.from(new Set(p.data.spaces));
  if (spaces.length) {
    const { error: sErr } = await db.from("venue_spaces").insert(spaces.map((name) => ({ org_id: me.orgId, venue_id: data.id, name })));
    if (sErr) return { ok: false, error: friendly(sErr.message) };
  }
  revalidatePath("/admin/schedule/venues");
  return { ok: true, data: { id: data.id } };
}

export async function addVenueSpace(venueId: string, name: string): Promise<ActionResult> {
  const me = await requireStaff();
  if (!me) return { ok: false, error: ERR.NOT_AUTHORIZED };
  const n = z.string().trim().min(1).max(80).safeParse(name);
  if (!uuid.safeParse(venueId).success || !n.success) return { ok: false, error: "Enter a name" };
  const db = await sportsDb();
  const { error } = await db.from("venue_spaces").insert({ org_id: me.orgId, venue_id: venueId, name: n.data });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/admin/schedule/venues");
  return { ok: true };
}

export async function setVenueActive(venueId: string, active: boolean): Promise<ActionResult> {
  const me = await requireStaff();
  if (!me) return { ok: false, error: ERR.NOT_AUTHORIZED };
  const db = await sportsDb();
  const { error } = await db.from("venues").update({ is_active: active }).eq("id", venueId);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/admin/schedule/venues");
  return { ok: true };
}

// ===========================================================================
// Teams
// ===========================================================================
const TeamInput = z.object({
  name: z.string().trim().min(1).max(120),
  seasonId: optUuid,
  programId: optUuid,
  sport: optText,
  ageGroup: optText,
  gender: optText,
  level: optText,
  color: z.union([z.string().regex(/^#[0-9A-Fa-f]{6}$/), z.literal(""), z.null()]).optional().transform((v) => (v ? v : null)),
  notes: z.string().trim().max(2000).optional().transform((v) => (v ? v : null)),
  isActive: z.boolean().default(true),
  coaches: z.array(z.object({ coachId: uuid, role: z.enum(["head", "assistant", "manager", "trainer"]) })).max(20).default([]),
});
export type TeamInput = z.input<typeof TeamInput>;

async function syncCoaches(teamId: string, orgId: string, coaches: { coachId: string; role: string }[]) {
  const db = await sportsDb();
  const { error: dErr } = await db.from("team_coaches").delete().eq("team_id", teamId);
  if (dErr) return dErr.message;
  const unique = Array.from(new Map(coaches.map((c) => [c.coachId, c])).values());
  if (!unique.length) return null;
  const { error } = await db.from("team_coaches").insert(unique.map((c) => ({ team_id: teamId, coach_id: c.coachId, org_id: orgId, role: c.role })));
  return error?.message ?? null;
}

export async function saveTeam(id: string | null, input: TeamInput): Promise<ActionResult<{ id: string }>> {
  const me = await requireStaff();
  if (!me) return { ok: false, error: ERR.NOT_AUTHORIZED };
  const p = TeamInput.safeParse(input);
  if (!p.success) return { ok: false, error: parseErr(p.error) };
  const t = p.data;
  const row = {
    name: t.name, season_id: t.seasonId, program_id: t.programId, sport: t.sport, age_group: t.ageGroup,
    gender: t.gender, level: t.level, color: t.color, notes: t.notes, is_active: t.isActive,
  };
  const db = await sportsDb();
  let teamId = id;
  if (id) {
    const { error } = await db.from("teams").update(row).eq("id", id);
    if (error) return { ok: false, error: friendly(error.message) };
  } else {
    const { data, error } = await db.from("teams").insert({ ...row, org_id: me.orgId }).select("id").single();
    if (error) return { ok: false, error: friendly(error.message) };
    teamId = data.id;
  }
  const cErr = await syncCoaches(teamId!, me.orgId!, t.coaches);
  if (cErr) return { ok: false, error: friendly(cErr) };
  revalidateAll(teamId);
  return { ok: true, data: { id: teamId! } };
}

// ===========================================================================
// Roster (admin, or coach of the team — RLS enforces the coach scope)
// ===========================================================================
const MemberInput = z.object({
  athleteId: uuid,
  jerseyNumber: z.number().int().min(0).max(999).nullable().optional(),
  position: optText,
  status: z.enum(["active", "trial", "injured", "inactive"]).default("active"),
});
export type MemberInput = z.input<typeof MemberInput>;

export async function addTeamMember(teamId: string, input: MemberInput): Promise<ActionResult> {
  const me = await requireStaff(["admin", "coach"]);
  if (!me) return { ok: false, error: ERR.NOT_AUTHORIZED };
  const p = MemberInput.safeParse(input);
  if (!p.success || !uuid.safeParse(teamId).success) return { ok: false, error: p.success ? "Invalid team" : parseErr(p.error) };
  const db = await sportsDb();
  const { error } = await db.from("team_memberships").insert({
    org_id: me.orgId, team_id: teamId, athlete_id: p.data.athleteId,
    jersey_number: p.data.jerseyNumber ?? null, position: p.data.position, status: p.data.status,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateAll(teamId);
  return { ok: true };
}

export async function updateTeamMember(membershipId: string, teamId: string, input: Omit<MemberInput, "athleteId">): Promise<ActionResult> {
  const me = await requireStaff(["admin", "coach"]);
  if (!me) return { ok: false, error: ERR.NOT_AUTHORIZED };
  const p = MemberInput.omit({ athleteId: true }).safeParse(input);
  if (!p.success) return { ok: false, error: parseErr(p.error) };
  const db = await sportsDb();
  const { error } = await db.from("team_memberships").update({
    jersey_number: p.data.jerseyNumber ?? null, position: p.data.position, status: p.data.status,
    left_on: p.data.status === "inactive" ? new Date().toISOString().slice(0, 10) : null,
  }).eq("id", membershipId);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateAll(teamId);
  return { ok: true };
}

export async function removeTeamMember(membershipId: string, teamId: string): Promise<ActionResult> {
  const me = await requireStaff(["admin", "coach"]);
  if (!me) return { ok: false, error: ERR.NOT_AUTHORIZED };
  const db = await sportsDb();
  const { error } = await db.from("team_memberships").delete().eq("id", membershipId);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateAll(teamId);
  return { ok: true };
}

// ===========================================================================
// Events
// ===========================================================================
const EventInput = z.object({
  teamId: optUuid,
  type: z.enum(["training", "game", "tournament", "meeting", "other"]),
  title: optText,
  venueId: optUuid,
  spaceId: optUuid,
  locationText: optText,
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  opponent: optText,
  homeAway: z.union([z.enum(["home", "away", "neutral"]), z.literal(""), z.null()]).optional().transform((v) => (v ? v : null)),
  notes: z.string().trim().max(2000).optional().transform((v) => (v ? v : null)),
  status: z.enum(["scheduled", "postponed", "cancelled", "completed"]).default("scheduled"),
  /** Repeat weekly this many extra times (training blocks). */
  repeatWeeks: z.number().int().min(0).max(52).default(0),
}).refine((e) => Date.parse(e.endsAt) > Date.parse(e.startsAt), { message: "End must be after start", path: ["endsAt"] })
  .refine((e) => Date.parse(e.endsAt) - Date.parse(e.startsAt) <= 14 * 864e5, { message: "Events can last at most 14 days", path: ["endsAt"] })
  .refine((e) => !e.spaceId || e.venueId, { message: "Pick a venue for the court/field", path: ["spaceId"] });
export type EventInput = z.input<typeof EventInput>;

export type ConflictWarning = { eventId: string; label: string; startsAt: string; endsAt: string; sameSpace: boolean; spaceName: string | null };
export type SaveEventResult = ActionResult<{ ids: string[] }> | { ok: false; error: string; conflicts: ConflictWarning[] };

const toWarning = (c: ConflictRow): ConflictWarning => ({
  eventId: c.event_id, label: c.title ?? `${c.team_name ?? "Club"} · ${c.type}`, startsAt: c.starts_at, endsAt: c.ends_at,
  sameSpace: c.same_space, spaceName: c.space_name,
});

/** Pre-flight conflict check (used by the form to warn before saving). */
export async function checkEventConflicts(args: { venueId: string | null; spaceId: string | null; startsAt: string; endsAt: string; excludeEventId?: string | null }): Promise<ConflictWarning[]> {
  if (!args.venueId || !Date.parse(args.startsAt) || !Date.parse(args.endsAt)) return [];
  const db = await sportsDb();
  const { data } = await db.rpc("event_conflicts", { p_venue: args.venueId, p_space: args.spaceId, p_start: args.startsAt, p_end: args.endsAt, p_exclude_event: args.excludeEventId ?? null });
  return (data ?? []).map(toWarning);
}

/**
 * Create (id=null) or update an event. Unless `force` is set, overlapping
 * bookings at the same venue are returned as warnings and nothing is saved.
 * Same-court overlaps are always refused by the database.
 */
export async function saveEvent(id: string | null, input: EventInput, force = false): Promise<SaveEventResult> {
  const me = await requireStaff(["admin", "coach"]);
  if (!me) return { ok: false, error: ERR.NOT_AUTHORIZED };
  const p = EventInput.safeParse(input);
  if (!p.success) return { ok: false, error: parseErr(p.error) };
  const e = p.data;
  const isGame = e.type === "game" || e.type === "tournament";
  const db = await sportsDb();

  let seasonId: string | null = null;
  if (e.teamId) {
    const { data: team } = await db.from("teams").select("season_id").eq("id", e.teamId).maybeSingle();
    seasonId = team?.season_id ?? null;
  }
  const dur = Date.parse(e.endsAt) - Date.parse(e.startsAt);
  const occurrences = (id ? [0] : Array.from({ length: e.repeatWeeks + 1 }, (_, i) => i)).map((w) => {
    const s = new Date(Date.parse(e.startsAt) + w * 7 * 864e5);
    return { startsAt: s.toISOString(), endsAt: new Date(s.getTime() + dur).toISOString() };
  });

  if (!force && e.venueId && e.status !== "cancelled") {
    const all: ConflictWarning[] = [];
    for (const o of occurrences) all.push(...(await checkEventConflicts({ venueId: e.venueId, spaceId: e.spaceId, startsAt: o.startsAt, endsAt: o.endsAt, excludeEventId: id })));
    if (all.length) return { ok: false, error: "Venue conflict", conflicts: all };
  }

  const base = {
    team_id: e.teamId, season_id: seasonId, type: e.type, title: e.title, venue_id: e.venueId, venue_space_id: e.spaceId,
    location_text: e.locationText, opponent: isGame ? e.opponent : null, home_away: isGame ? e.homeAway : null,
    notes: e.notes, status: e.status,
  };
  if (id) {
    const { error } = await db.from("events").update({ ...base, starts_at: occurrences[0].startsAt, ends_at: occurrences[0].endsAt }).eq("id", id);
    if (error) return { ok: false, error: friendly(error.message) };
    revalidateAll(e.teamId);
    revalidatePath(`/admin/schedule/${id}`);
    return { ok: true, data: { ids: [id] } };
  }
  const { data, error } = await db.from("events")
    .insert(occurrences.map((o) => ({ ...base, org_id: me.orgId, created_by: me.id, starts_at: o.startsAt, ends_at: o.endsAt })))
    .select("id");
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateAll(e.teamId);
  return { ok: true, data: { ids: (data ?? []).map((r) => r.id) } };
}

export async function setEventStatus(id: string, status: "scheduled" | "postponed" | "cancelled" | "completed"): Promise<ActionResult> {
  const me = await requireStaff(["admin", "coach"]);
  if (!me) return { ok: false, error: ERR.NOT_AUTHORIZED };
  const db = await sportsDb();
  const { error } = await db.from("events").update({ status }).eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateAll();
  revalidatePath(`/admin/schedule/${id}`);
  return { ok: true };
}

export async function deleteEvent(id: string): Promise<ActionResult> {
  const me = await requireStaff();
  if (!me) return { ok: false, error: ERR.NOT_AUTHORIZED };
  const db = await sportsDb();
  const { error } = await db.from("events").delete().eq("id", id);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateAll();
  return { ok: true };
}

// ===========================================================================
// Results + RSVP
// ===========================================================================
export async function recordResult(eventId: string, scoreFor: number, scoreAgainst: number, notes?: string): Promise<ActionResult> {
  const me = await requireStaff(["admin", "coach"]);
  if (!me) return { ok: false, error: ERR.NOT_AUTHORIZED };
  const s = z.object({ a: z.number().int().min(0).max(100000), b: z.number().int().min(0).max(100000) }).safeParse({ a: scoreFor, b: scoreAgainst });
  if (!s.success) return { ok: false, error: "Scores must be whole numbers ≥ 0" };
  const db = await sportsDb();
  const { error } = await db.rpc("record_game_result", { p_event: eventId, p_score_for: s.data.a, p_score_against: s.data.b, p_notes: notes ?? null });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateAll();
  revalidatePath(`/admin/schedule/${eventId}`);
  revalidatePath(`/coach/team/events/${eventId}`);
  return { ok: true };
}

export async function setRsvp(eventId: string, athleteId: string, status: "going" | "maybe" | "not_going", note?: string): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: "Not signed in" };
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(athleteId).success) return { ok: false, error: "Invalid request" };
  const db = await sportsDb();
  const { error } = await db.rpc("set_event_rsvp", { p_event: eventId, p_athlete: athleteId, p_status: status, p_note: note?.slice(0, 500) ?? null });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/parent/schedule");
  revalidatePath("/coach/team");
  revalidatePath(`/coach/team/events/${eventId}`);
  revalidatePath(`/admin/schedule/${eventId}`);
  return { ok: true };
}
