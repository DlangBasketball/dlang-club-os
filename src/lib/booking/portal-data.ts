import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BookingRow } from "./types";

/*
 * Booking portals — extra server reads (signed-in user, RLS applies).
 * Admin athlete profile: attendance marks of the athlete's booked sessions
 * (team_attendance_marks is readable by admins and the session coach only).
 */

export type BookedSessionMark = {
  bookingId: string;
  eventId: string;
  serviceName: string;
  coachName: string | null;
  startsAt: string;
  /** Finalized value once the sheet was finalized, else the draft value. */
  status: string;
  final: boolean;
};

/** Marks of the athlete on the session events of these bookings (admin view; others get no rows). */
export async function getBookedSessionMarks(athleteId: string, bookings: BookingRow[]): Promise<BookedSessionMark[]> {
  const withEvent = bookings.filter((b) => b.session?.event_id);
  if (!withEvent.length) return [];
  const db = await createClient();
  const eventIds = Array.from(new Set(withEvent.map((b) => b.session!.event_id as string)));
  const { data } = await db.from("team_attendance_marks").select("event_id,status,finalized_status")
    .eq("athlete_id", athleteId).in("event_id", eventIds).limit(500);
  const marks = new Map((data ?? []).map((m) => [m.event_id, m]));
  const out: BookedSessionMark[] = [];
  for (const b of withEvent) {
    const m = marks.get(b.session!.event_id as string);
    if (!m) continue;
    const final = m.finalized_status !== null;
    if (!final && m.status === "unmarked") continue;
    out.push({
      bookingId: b.booking_id, eventId: b.session!.event_id as string, serviceName: b.service.name, coachName: b.coach?.display_name ?? null,
      startsAt: b.slot_start, status: final ? (m.finalized_status as string) : m.status, final,
    });
  }
  return out.sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1));
}
