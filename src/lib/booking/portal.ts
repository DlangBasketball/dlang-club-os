import type { CoachAgendaSession, PortalBookings } from "./types";

/*
 * Booking portals — list logic without I/O (client + server safe, unit-tested
 * in tests/unit/booking-portal.test.ts). The coach list merges the team
 * training cards (coach_training_cards) with the booked sessions of the coach
 * agenda (coach_booking_agenda: names only, never money); the parent / player
 * lists flatten the per-child overviews (guardian_booking_overview,
 * player_booking_overview) and merge the finalized session attendance into
 * the team attendance history.
 */

// ---------------------------------------------------------------------------
// Coach
// ---------------------------------------------------------------------------

/** What a coach card shows about a booked session: service, kind, roster names, places. */
export type BookedSessionInfo = {
  sessionId: string;
  eventId: string | null;
  serviceName: string;
  kind: CoachAgendaSession["kind"];
  status: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  venueSpace: string | null;
  capacity: number;
  participantsCount: number;
  rescheduledFrom: string | null;
  /** Only requests so far: the slot is held until the coach confirms. */
  pending: boolean;
  /** Requests on the roster (awaiting the coach). */
  requestsCount: number;
  /** Live bookings incl. requests (status "requested"), last name order (as the RPC returns them). */
  participants: { athleteId: string; name: string; status: string }[];
};

export function toBookedSessionInfo(s: CoachAgendaSession): BookedSessionInfo {
  return {
    sessionId: s.session_id,
    eventId: s.event_id,
    serviceName: s.service_name,
    kind: s.kind,
    status: s.status,
    startsAt: s.starts_at,
    endsAt: s.ends_at,
    location: s.location,
    venueSpace: s.venue_space,
    capacity: s.capacity,
    participantsCount: s.participants_count,
    rescheduledFrom: s.rescheduled_from,
    pending: Boolean(s.pending),
    requestsCount: s.requests_count ?? (s.participants ?? []).filter((p) => p.booking_status === "requested").length,
    participants: (s.participants ?? []).map((p) => ({
      athleteId: p.athlete_id,
      name: `${p.first_name} ${p.last_name}`.trim(),
      status: p.booking_status,
    })),
  };
}

export type CoachListEntry<C> =
  | { type: "card"; startsAt: string; card: C; session: BookedSessionInfo | null }
  | { type: "session"; startsAt: string; session: BookedSessionInfo };

/**
 * One chronological list for "Today's trainings" / the coach schedule: every
 * training card, enriched with its booked session when the card is the
 * session's event, plus agenda sessions without a card (no event yet, or
 * outside what the card RPC returned). A session is never listed twice.
 */
export function mergeCoachTrainings<C extends { event_id: string; starts_at: string }>(
  cards: C[],
  agenda: CoachAgendaSession[],
): CoachListEntry<C>[] {
  const byEvent = new Map<string, BookedSessionInfo>();
  const seenSessions = new Set<string>();
  for (const s of agenda) {
    if (seenSessions.has(s.session_id)) continue;
    seenSessions.add(s.session_id);
    if (s.event_id) byEvent.set(s.event_id, toBookedSessionInfo(s));
  }
  const cardEvents = new Set(cards.map((c) => c.event_id));
  const out: CoachListEntry<C>[] = cards.map((card) => ({
    type: "card", startsAt: card.starts_at, card, session: byEvent.get(card.event_id) ?? null,
  }));
  const added = new Set<string>();
  for (const s of agenda) {
    if (added.has(s.session_id)) continue;
    if (s.event_id && cardEvents.has(s.event_id)) continue;
    added.add(s.session_id);
    out.push({ type: "session", startsAt: s.starts_at, session: toBookedSessionInfo(s) });
  }
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.startsAt === b.e.startsAt ? a.i - b.i : a.e.startsAt < b.e.startsAt ? -1 : 1))
    .map((x) => x.e);
}

/** Requests of the coach, soonest session first; stale ones (unanswered past the follow-up hours) flagged by the RPC. */
export function sortRequests<R extends { starts_at: string; requested_at: string | null }>(rows: R[]): R[] {
  return [...rows].sort((a, b) => (a.starts_at === b.starts_at ? (a.requested_at ?? "").localeCompare(b.requested_at ?? "") : a.starts_at < b.starts_at ? -1 : 1));
}

/** Upcoming row label key: requests wait for the coach; a confirmed booking is confirmed. */
export function upcomingStateKey(u: { status: string; awaiting_confirmation?: boolean }): "requested" | "confirmed" {
  return u.awaiting_confirmation || u.status === "requested" ? "requested" : "confirmed";
}

/** Places label input: participants / capacity (capacity 1 = private, no "of" shown). */
export function placesTaken(s: Pick<BookedSessionInfo, "participantsCount" | "capacity">): { taken: number; capacity: number; full: boolean } {
  const capacity = Math.max(1, s.capacity || 1);
  return { taken: s.participantsCount, capacity, full: s.participantsCount >= capacity };
}

// ---------------------------------------------------------------------------
// Parent / player
// ---------------------------------------------------------------------------

type Child = PortalBookings["athlete"];
export type PortalUpcoming = PortalBookings["upcoming"][number] & {
  athlete: Child; kind?: string | null; event_id?: string | null;
};
export type PortalChange = PortalBookings["changes"][number] & {
  athlete: Child; reason?: string | null; previous_starts_at?: string | null; coach_name?: string | null; ends_at?: string | null;
};
export type PortalAttendance = PortalBookings["attendance"][number] & { athlete: Child; coach_name?: string | null };
export type PortalInvoice = PortalBookings["invoices"][number] & { athlete: Child; starts_at?: string | null };

const byStart = <T extends { starts_at: string }>(a: T, b: T) => (a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : 0);

/** Upcoming bookings of all children, soonest first, each tagged with its child. */
export function flattenUpcoming(overviews: PortalBookings[]): PortalUpcoming[] {
  return overviews.flatMap((o) => (o.upcoming ?? []).map((u) => ({ ...u, athlete: o.athlete }))).sort(byStart);
}

/** Schedule changes (moved / cancelled, last 30 days) of all children, newest change first. */
export function flattenChanges(overviews: PortalBookings[]): PortalChange[] {
  return overviews
    .flatMap((o) => (o.changes ?? []).map((c) => ({ ...c, athlete: o.athlete })))
    .sort((a, b) => ((a.at ?? "") < (b.at ?? "") ? 1 : (a.at ?? "") > (b.at ?? "") ? -1 : 0));
}

/** Finalized attendance of booked sessions, newest first. */
export function flattenAttendance(overviews: PortalBookings[]): PortalAttendance[] {
  return overviews.flatMap((o) => (o.attendance ?? []).map((a) => ({ ...a, athlete: o.athlete }))).sort(byStart).reverse();
}

/** Invoices of bookings the viewer may see as the payer (players: always none). */
export function flattenInvoices(overviews: PortalBookings[]): PortalInvoice[] {
  const seen = new Set<string>();
  const out: PortalInvoice[] = [];
  for (const o of overviews) {
    for (const i of o.invoices ?? []) {
      if (seen.has(i.invoice_id)) continue;
      seen.add(i.invoice_id);
      out.push({ ...i, athlete: o.athlete });
    }
  }
  return out;
}

/**
 * booking id -> visible invoice (number / status) for the booking rows. An
 * order invoice bills several bookings (one row per booking); a package
 * invoice of an order has no booking (booking_id null) and is listed only.
 */
export function invoiceByBooking(overviews: PortalBookings[]): Map<string, PortalInvoice> {
  const out = new Map<string, PortalInvoice>();
  for (const o of overviews) {
    for (const i of o.invoices ?? []) if (i.booking_id && !out.has(i.booking_id)) out.set(i.booking_id, { ...i, athlete: o.athlete });
  }
  return out;
}

/** Kind of change for the label: cancelled, moved (with the previous time) or moved (previous time unknown). */
export function changeLabel(c: Pick<PortalChange, "change" | "reason" | "previous_starts_at">):
  { key: "cancelledReason" | "cancelled" | "movedFrom" | "moved" | "declined" | "declinedReason" | "withdrawn"; reason?: string; previous?: string } {
  if (c.change === "declined") return c.reason?.trim() ? { key: "declinedReason", reason: c.reason.trim() } : { key: "declined" };
  if (c.change === "withdrawn") return { key: "withdrawn" };
  if (c.change === "cancelled") return c.reason?.trim() ? { key: "cancelledReason", reason: c.reason.trim() } : { key: "cancelled" };
  return c.previous_starts_at ? { key: "movedFrom", previous: c.previous_starts_at } : { key: "moved" };
}

/**
 * Attendance history of the portals: the team history rows from the
 * attendance overview plus the finalized booked sessions (bk_portal_rows),
 * one row per event (the overview row wins), newest first. `toRow` maps a
 * booked-session row to the history row shape.
 */
export function mergeAttendanceHistory<H extends { event_id: string; starts_at: string }>(
  history: H[],
  booked: PortalBookings["attendance"],
  toRow: (a: PortalBookings["attendance"][number]) => H,
): H[] {
  const seen = new Set(history.map((h) => h.event_id));
  const extra: H[] = [];
  for (const a of booked ?? []) {
    if (seen.has(a.event_id)) continue;
    seen.add(a.event_id);
    extra.push(toRow(a));
  }
  return [...history, ...extra].sort(byStart).reverse();
}

/** Event ids that belong to booked sessions (labels "Booked session", no team, no absence report). */
export function bookedEventIds(rows: { event_id?: string | null; training_session_id?: string | null }[], booked: { event_id: string }[] = []): Set<string> {
  const ids = new Set<string>();
  for (const r of rows) if (r.training_session_id && r.event_id) ids.add(r.event_id);
  for (const b of booked) ids.add(b.event_id);
  return ids;
}
