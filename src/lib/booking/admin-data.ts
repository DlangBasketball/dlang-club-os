import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { BookingStatus } from "./types";

/*
 * Admin booking screens — small server reads next to the contract reads in
 * ./data.ts: coach / space options for the form and filters, and the
 * bookings behind a session event (schedule page). RLS-scoped (staff), and
 * every query filters by the caller's org explicitly.
 */
const generic = async () => (await createClient()) as unknown as SupabaseClient;

export type SpaceOption = { id: string; name: string; venueId: string; venueName: string };
export type CoachOption = { id: string; name: string };

export async function getCoachOptions(orgId: string): Promise<CoachOption[]> {
  const db = await createClient();
  const { data } = await db.from("coaches").select("id,display_name").eq("org_id", orgId).eq("is_active", true).order("display_name");
  return ((data ?? []) as { id: string; display_name: string }[]).map((c) => ({ id: c.id, name: c.display_name }));
}

/** Active venue spaces (courts, fields) with their venue name, for the Facility / court picker. */
export async function getSpaceOptions(orgId: string): Promise<SpaceOption[]> {
  const db = await generic();
  const [spaces, venues] = await Promise.all([
    db.from("venue_spaces").select("id,name,venue_id").eq("org_id", orgId).eq("is_active", true).order("name").limit(500),
    db.from("venues").select("id,name").eq("org_id", orgId).order("name"),
  ]);
  const vName = new Map(((venues.data ?? []) as { id: string; name: string }[]).map((v) => [v.id, v.name]));
  return ((spaces.data ?? []) as { id: string; name: string; venue_id: string }[])
    .map((s) => ({ id: s.id, name: s.name, venueId: s.venue_id, venueName: vName.get(s.venue_id) ?? "" }))
    .sort((a, b) => a.venueName.localeCompare(b.venueName) || a.name.localeCompare(b.name));
}

export type SessionEventInfo = {
  sessionId: string; serviceId: string; serviceName: string; coachName: string | null; capacity: number; status: string;
  startsAt: string; endsAt: string;
  participants: { bookingId: string; athleteId: string; name: string; status: BookingStatus }[];
};

/** The booking session behind a calendar event (events.training_session_id), or null for any other event. */
export async function getSessionEventInfo(orgId: string, eventId: string): Promise<SessionEventInfo | null> {
  const db = await generic();
  const { data: ev } = await db.from("events").select("id,training_session_id").eq("org_id", orgId).eq("id", eventId).maybeSingle();
  const sessionId = (ev as { training_session_id: string | null } | null)?.training_session_id;
  if (!sessionId) return null;
  const { data: s } = await db.from("training_sessions").select("id,service_id,coach_id,capacity,status,starts_at,ends_at")
    .eq("org_id", orgId).eq("id", sessionId).maybeSingle();
  const sess = s as { id: string; service_id: string; coach_id: string; capacity: number; status: string; starts_at: string; ends_at: string } | null;
  if (!sess) return null;
  const [svc, coach, bookings] = await Promise.all([
    db.from("training_services").select("name").eq("org_id", orgId).eq("id", sess.service_id).maybeSingle(),
    db.from("coaches").select("display_name").eq("org_id", orgId).eq("id", sess.coach_id).maybeSingle(),
    db.from("training_bookings").select("id,athlete_id,status").eq("org_id", orgId).eq("session_id", sess.id).order("created_at"),
  ]);
  const rows = (bookings.data ?? []) as { id: string; athlete_id: string; status: BookingStatus }[];
  const ids = [...new Set(rows.map((r) => r.athlete_id))];
  const { data: ath } = ids.length
    ? await db.from("athletes").select("id,first_name,last_name").eq("org_id", orgId).in("id", ids)
    : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const names = new Map(((ath ?? []) as { id: string; first_name: string; last_name: string }[]).map((a) => [a.id, `${a.first_name} ${a.last_name}`]));
  return {
    sessionId: sess.id, serviceId: sess.service_id, serviceName: (svc.data as { name: string } | null)?.name ?? "",
    coachName: (coach.data as { display_name: string } | null)?.display_name ?? null, capacity: sess.capacity, status: sess.status,
    startsAt: sess.starts_at, endsAt: sess.ends_at,
    participants: rows.map((r) => ({ bookingId: r.id, athleteId: r.athlete_id, name: names.get(r.athlete_id) ?? "", status: r.status })),
  };
}

/** Live participants of a session (what fills a place). */
export const LIVE_BOOKING: readonly BookingStatus[] = ["booked", "completed", "no_show"];
