import "server-only";
import { addDayKey, windowFor } from "@/lib/staff/hours";
import type { OpsClient, AllocationRow } from "./db";
import { computeClosureImpact, locationMatchesVenue, type Allocation, type ClosureImpact, type OneOff, type ScheduledItem } from "./facilities";

/**
 * Server-side reads for the operations module. Every query takes the
 * caller's RLS-scoped client and still filters by org_id explicitly.
 */

export function toAllocation(a: AllocationRow, teamName: Map<string, string>): Allocation {
  return {
    id: a.id, venueId: a.venue_id, spaceId: a.venue_space_id, teamId: a.team_id,
    label: (a.team_id ? teamName.get(a.team_id) : null) ?? a.label ?? "",
    weekday: a.weekday, startTime: a.start_time, endTime: a.end_time, validFrom: a.valid_from, validUntil: a.valid_until, isActive: a.is_active,
  };
}

export async function teamNames(db: OpsClient, orgId: string): Promise<Map<string, string>> {
  const { data } = await db.from("teams").select("id,name").eq("org_id", orgId).limit(1000);
  return new Map((data ?? []).map((t) => [t.id, t.name]));
}

export async function loadAllocations(db: OpsClient, orgId: string, venueId?: string | null): Promise<Allocation[]> {
  let q = db.from("facility_allocations").select("*").eq("org_id", orgId).eq("is_active", true).limit(2000);
  if (venueId) q = q.eq("venue_id", venueId);
  const [{ data }, names] = await Promise.all([q, teamNames(db, orgId)]);
  return (data ?? []).map((a) => toAllocation(a, names));
}

/** Live team events and rentals at a venue in [fromIso, toIso). */
export async function loadOneOffs(db: OpsClient, orgId: string, venueId: string, fromIso: string, toIso: string): Promise<OneOff[]> {
  const [{ data: events }, { data: rentals }, names] = await Promise.all([
    db.from("events").select("id,team_id,title,type,venue_id,venue_space_id,starts_at,ends_at,status")
      .eq("org_id", orgId).eq("venue_id", venueId).in("status", ["scheduled", "postponed"]).lt("starts_at", toIso).gt("ends_at", fromIso).limit(2000),
    db.from("facility_rentals").select("id,venue_id,venue_space_id,renter_name,starts_at,ends_at,status")
      .eq("org_id", orgId).eq("venue_id", venueId).neq("status", "cancelled").lt("starts_at", toIso).gt("ends_at", fromIso).limit(2000),
    teamNames(db, orgId),
  ]);
  return [
    ...(events ?? []).map((e): OneOff => ({
      id: e.id, kind: "event", venueId, spaceId: e.venue_space_id,
      label: [e.team_id ? names.get(e.team_id) : null, e.title].filter(Boolean).join(" · ") || e.type, start: e.starts_at, end: e.ends_at,
    })),
    ...(rentals ?? []).map((r): OneOff => ({ id: r.id, kind: "rental", venueId, spaceId: r.venue_space_id, label: r.renter_name, start: r.starts_at, end: r.ends_at })),
  ];
}

/**
 * Everything at the closure's venue during its days: team events, programme
 * sessions (linked to an event there, or whose location names the venue),
 * camp editions, training bookings, rentals and weekly allocations.
 */
export async function loadClosureImpact(
  db: OpsClient,
  orgId: string,
  closure: { venueId: string; spaceId: string | null; startsOn: string; endsOn: string },
  timeZone: string,
): Promise<ClosureImpact & { labels: Map<string, string> }> {
  const win = windowFor(addDayKey(closure.startsOn, -1), addDayKey(closure.endsOn, 1), timeZone);
  const fromIso = win.from.toISOString();
  const toIso = win.to.toISOString();
  const { data: venue } = await db.from("venues").select("id,name").eq("id", closure.venueId).eq("org_id", orgId).maybeSingle();
  const venueName = venue?.name ?? "";
  const [events, sessions, camps, bookings, rentals, allocations, names, programs] = await Promise.all([
    db.from("events").select("id,team_id,program_session_id,title,type,venue_id,venue_space_id,starts_at,ends_at,status")
      .eq("org_id", orgId).eq("venue_id", closure.venueId).lt("starts_at", toIso).gt("ends_at", fromIso).limit(2000).then((r) => r.data ?? []),
    db.from("program_sessions").select("id,program_id,coach_id,starts_at,ends_at,location")
      .eq("org_id", orgId).gte("starts_at", new Date(win.from.getTime() - 864e5).toISOString()).lt("starts_at", toIso).limit(2000).then((r) => r.data ?? []),
    db.from("camp_editions").select("id,program_id,name,starts_on,ends_on,venue_id,status,archived_at")
      .eq("org_id", orgId).eq("venue_id", closure.venueId).lte("starts_on", closure.endsOn).gte("ends_on", closure.startsOn).is("archived_at", null).limit(500).then((r) => r.data ?? []),
    db.from("training_bookings").select("id,athlete_id,coach_id,service_id,slot_start,slot_end,status,venue_id")
      .eq("org_id", orgId).eq("venue_id", closure.venueId).gte("slot_start", fromIso).lt("slot_start", toIso).limit(2000).then((r) => r.data ?? []),
    db.from("facility_rentals").select("id,venue_id,venue_space_id,renter_name,starts_at,ends_at,status")
      .eq("org_id", orgId).eq("venue_id", closure.venueId).lt("starts_at", toIso).gt("ends_at", fromIso).limit(2000).then((r) => r.data ?? []),
    loadAllocations(db, orgId, closure.venueId),
    teamNames(db, orgId),
    db.from("programs").select("id,name").eq("org_id", orgId).limit(1000).then((r) => new Map((r.data ?? []).map((p) => [p.id, p.name]))),
  ]);
  const { data: teamCoaches } = await db.from("team_coaches").select("team_id,coach_id").eq("org_id", orgId).limit(2000);
  const coachesOf = new Map<string, string[]>();
  for (const tc of teamCoaches ?? []) coachesOf.set(tc.team_id, [...(coachesOf.get(tc.team_id) ?? []), tc.coach_id]);
  const linkedSessions = new Set(events.map((e) => e.program_session_id).filter(Boolean));
  const labels = new Map<string, string>();
  const items: ScheduledItem[] = [];
  for (const e of events) {
    const label = [e.team_id ? names.get(e.team_id) : null, e.title].filter(Boolean).join(" · ") || e.type;
    labels.set(`event:${e.id}`, label);
    items.push({
      kind: "event", id: e.id, venueId: e.venue_id, spaceId: e.venue_space_id, label, start: e.starts_at, end: e.ends_at, allDay: false,
      status: e.status, teamId: e.team_id, coachIds: e.team_id ? coachesOf.get(e.team_id) ?? [] : [],
    });
  }
  for (const s of sessions) {
    if (!linkedSessions.has(s.id) && !locationMatchesVenue(s.location, venueName)) continue;
    const label = programs.get(s.program_id) ?? "";
    labels.set(`session:${s.id}`, label);
    items.push({
      kind: "session", id: s.id, venueId: closure.venueId, spaceId: null, label, start: s.starts_at,
      end: s.ends_at ?? new Date(Date.parse(s.starts_at) + 90 * 60000).toISOString(), allDay: false, status: null,
      programId: s.program_id, coachIds: s.coach_id ? [s.coach_id] : [],
    });
  }
  for (const c of camps) {
    const label = [programs.get(c.program_id), c.name].filter(Boolean).join(" · ");
    labels.set(`camp:${c.id}`, label);
    items.push({
      kind: "camp", id: c.id, venueId: c.venue_id, spaceId: null, label, start: c.starts_on, end: c.ends_on, allDay: true,
      status: c.status === "draft" ? null : c.status, programId: c.program_id, campEditionId: c.id,
    });
  }
  for (const b of bookings) {
    labels.set(`booking:${b.id}`, "");
    items.push({
      kind: "booking", id: b.id, venueId: b.venue_id, spaceId: null, label: "", start: b.slot_start,
      end: b.slot_end ?? new Date(Date.parse(b.slot_start) + 60 * 60000).toISOString(), allDay: false, status: b.status,
      athleteId: b.athlete_id, coachIds: [b.coach_id],
    });
  }
  for (const r of rentals) {
    labels.set(`rental:${r.id}`, r.renter_name);
    items.push({ kind: "rental", id: r.id, venueId: r.venue_id, spaceId: r.venue_space_id, label: r.renter_name, start: r.starts_at, end: r.ends_at, allDay: false, status: r.status });
  }
  return { ...computeClosureImpact(closure, items, allocations, timeZone), labels };
}

export type Lookups = {
  venues: { id: string; name: string }[];
  spaces: { id: string; venue_id: string; name: string }[];
  teams: { id: string; name: string; season_id: string | null }[];
  coaches: { id: string; display_name: string }[];
};

/** Select options shared by the operations pages (active rows of the org). */
export async function loadLookups(db: OpsClient, orgId: string): Promise<Lookups> {
  const [venues, spaces, teams, coaches] = await Promise.all([
    db.from("venues").select("id,name").eq("org_id", orgId).eq("is_active", true).order("name").limit(500).then((r) => r.data ?? []),
    db.from("venue_spaces").select("id,venue_id,name").eq("org_id", orgId).eq("is_active", true).order("name").limit(1000).then((r) => r.data ?? []),
    db.from("teams").select("id,name,season_id").eq("org_id", orgId).eq("is_active", true).order("name").limit(500).then((r) => r.data ?? []),
    db.from("coaches").select("id,display_name").eq("org_id", orgId).order("display_name").limit(500).then((r) => r.data ?? []),
  ]);
  return { venues, spaces, teams, coaches };
}

/** "Venue · Space" options (space ids) for the court selects. */
export function spaceOptions(l: Lookups): { value: string; label: string }[] {
  const venueName = new Map(l.venues.map((v) => [v.id, v.name]));
  return l.spaces.filter((s) => venueName.has(s.venue_id)).map((s) => ({ value: s.id, label: `${venueName.get(s.venue_id)} · ${s.name}` }));
}
