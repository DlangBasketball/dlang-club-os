import { describe, expect, it } from "vitest";
import {
  bookedEventIds, changeLabel, flattenAttendance, flattenChanges, flattenInvoices, flattenUpcoming, invoiceByBooking,
  mergeAttendanceHistory, mergeCoachTrainings, placesTaken, toBookedSessionInfo,
} from "@/lib/booking/portal";
import { filterHistory, historyOptions, isBookedSession, summarize } from "@/lib/attendance/family";
import type { CoachAgendaSession, PortalBookings } from "@/lib/booking/types";

// SYNTHETIC DATA ONLY.
const card = (event_id: string, starts_at: string, team_name: string | null = "U14") => ({ event_id, starts_at, team_name });
const session = (over: Partial<CoachAgendaSession> = {}): CoachAgendaSession => ({
  session_id: "s1", event_id: "e-s1", service_id: "svc", service_name: "Private training", kind: "private",
  starts_at: "2026-12-05T09:00:00Z", ends_at: "2026-12-05T10:00:00Z", status: "scheduled", rescheduled_from: null,
  location: "Hall A", venue_space: null, capacity: 1, participants_count: 1, sheet_status: null,
  participants: [{ athlete_id: "a1", first_name: "Nova", last_name: "Synth", booking_status: "booked" }], ...over,
});

describe("coach list: team trainings + booked sessions", () => {
  it("enriches the session's own card and keeps the chronological order", () => {
    const merged = mergeCoachTrainings(
      [card("e-team", "2026-12-05T08:00:00Z"), card("e-s1", "2026-12-05T09:00:00Z", "Private training"), card("e-late", "2026-12-05T18:00:00Z")],
      [session()],
    );
    expect(merged.map((m) => m.type)).toEqual(["card", "card", "card"]);
    const s = merged[1];
    expect(s.type === "card" && s.session?.serviceName).toBe("Private training");
    expect(s.type === "card" && s.session?.participants).toEqual([{ athleteId: "a1", name: "Nova Synth", status: "booked" }]);
    expect(merged[0].type === "card" && merged[0].session).toBeNull();
  });

  it("adds sessions without a card once, sorted between the trainings", () => {
    const merged = mergeCoachTrainings(
      [card("e-team", "2026-12-05T08:00:00Z"), card("e-eve", "2026-12-05T19:00:00Z")],
      [session({ session_id: "s2", event_id: null, starts_at: "2026-12-05T12:00:00Z" }), session({ session_id: "s2", event_id: null, starts_at: "2026-12-05T12:00:00Z" })],
    );
    expect(merged.map((m) => (m.type === "card" ? m.card.event_id : m.session.sessionId))).toEqual(["e-team", "s2", "e-eve"]);
  });

  it("never lists a session twice when its event has a card", () => {
    const merged = mergeCoachTrainings([card("e-s1", "2026-12-05T09:00:00Z")], [session(), session()]);
    expect(merged).toHaveLength(1);
  });

  it("names only: the session info carries no money, payer or invoice", () => {
    const info = toBookedSessionInfo(session({ kind: "group", capacity: 4, participants_count: 4 }));
    expect(JSON.stringify(info)).not.toMatch(/price|payer|invoice/i);
    expect(placesTaken(info)).toEqual({ taken: 4, capacity: 4, full: true });
    expect(placesTaken({ participantsCount: 0, capacity: 0 })).toEqual({ taken: 0, capacity: 1, full: false });
  });
});

const child = (id: string, first: string) => ({ id, first_name: first, last_name: "Synth" });
const overview = (id: string, first: string, over: Partial<PortalBookings> = {}): PortalBookings => ({
  athlete: child(id, first), upcoming: [], changes: [], attendance: [], invoices: [], ...over,
});
const up = (booking_id: string, starts_at: string) => ({
  booking_id, service_name: "Private training", coach_name: "Coach Synth", starts_at, ends_at: null, status: "booked" as const,
  rescheduled_from: null, rescheduled_at: null, location: null,
});

describe("parent / player lists", () => {
  it("upcoming bookings of all children, soonest first, tagged with the child", () => {
    const rows = flattenUpcoming([
      overview("a1", "Ana", { upcoming: [up("b2", "2026-12-07T09:00:00Z")] }),
      overview("a2", "Ben", { upcoming: [up("b1", "2026-12-05T09:00:00Z")] }),
    ]);
    expect(rows.map((r) => [r.booking_id, r.athlete.first_name])).toEqual([["b1", "Ben"], ["b2", "Ana"]]);
  });

  it("changes newest first, labels with reason / previous time", () => {
    const rows = flattenChanges([overview("a1", "Ana", {
      changes: [
        { booking_id: "b1", service_name: "S", starts_at: "2026-12-05T09:00:00Z", change: "cancelled", at: "2026-11-20T10:00:00Z", reason: " Coach ill " } as never,
        { booking_id: "b2", service_name: "S", starts_at: "2026-12-06T09:00:00Z", change: "rescheduled", at: "2026-11-22T10:00:00Z", previous_starts_at: "2026-12-04T09:00:00Z" } as never,
      ],
    })]);
    expect(rows.map((r) => r.booking_id)).toEqual(["b2", "b1"]);
    expect(changeLabel(rows[0])).toEqual({ key: "movedFrom", previous: "2026-12-04T09:00:00Z" });
    expect(changeLabel(rows[1])).toEqual({ key: "cancelledReason", reason: "Coach ill" });
    expect(changeLabel({ change: "cancelled", reason: "  " })).toEqual({ key: "cancelled" });
    expect(changeLabel({ change: "rescheduled" })).toEqual({ key: "moved" });
  });

  it("invoices: one row per invoice, mapped to their booking", () => {
    const inv = { invoice_id: "i1", number: "DL PT-2026-0001", status: "sent", due_date: null, currency: "CHF", total: 90, balance: 90, booking_id: "b1", service_name: "S" };
    const list = [overview("a1", "Ana", { invoices: [inv] }), overview("a2", "Ben", { invoices: [inv] })];
    expect(flattenInvoices(list)).toHaveLength(1);
    expect(invoiceByBooking(list).get("b1")?.number).toBe("DL PT-2026-0001");
    expect(flattenInvoices([overview("p", "Player")])).toEqual([]);
  });

  it("attendance of booked sessions, newest first", () => {
    const rows = flattenAttendance([overview("a1", "Ana", {
      attendance: [
        { event_id: "e1", service_name: "S", starts_at: "2026-11-01T09:00:00Z", status: "present" },
        { event_id: "e2", service_name: "S", starts_at: "2026-11-08T09:00:00Z", status: "late" },
      ],
    })]);
    expect(rows.map((r) => r.event_id)).toEqual(["e2", "e1"]);
  });
});

describe("attendance history: team trainings + booked sessions", () => {
  type H = { event_id: string; team_id: string | null; team_name: string; type: string; starts_at: string; status: string; is_guest: boolean; booked?: boolean; training_session_id?: string | null };
  const team: H = { event_id: "t1", team_id: "team-1", team_name: "U14", type: "training", starts_at: "2026-11-03T17:00:00Z", status: "present", is_guest: false };
  const sessionRow: H = { event_id: "e1", team_id: null, team_name: "Private training", type: "training", starts_at: "2026-11-01T09:00:00Z", status: "present", is_guest: false, training_session_id: "s1" };
  const toRow = (a: PortalBookings["attendance"][number]): H => ({
    event_id: a.event_id, team_id: null, team_name: a.service_name, type: "training", starts_at: a.starts_at, status: a.status, is_guest: false, booked: true,
  });

  it("adds booked sessions missing from the overview, one row per event, newest first", () => {
    const merged = mergeAttendanceHistory([team, sessionRow], [
      { event_id: "e1", service_name: "Private training", starts_at: "2026-11-01T09:00:00Z", status: "late" },
      { event_id: "e9", service_name: "Group training", starts_at: "2026-11-05T09:00:00Z", status: "unexcused" },
    ], toRow);
    expect(merged.map((r) => r.event_id)).toEqual(["e9", "t1", "e1"]);
    expect(merged.find((r) => r.event_id === "e1")?.status).toBe("present");
    expect(summarize(merged)).toMatchObject({ sessions: 3, present: 2, unexcused: 1 });
  });

  it("booked sessions are no team filter option and drop out when a team is selected", () => {
    const merged = mergeAttendanceHistory([team, sessionRow], [], toRow);
    expect(historyOptions(merged).teams).toEqual([{ id: "team-1", name: "U14" }]);
    expect(filterHistory(merged, { teamId: "team-1" }).map((r) => r.event_id)).toEqual(["t1"]);
    expect(merged.filter(isBookedSession).map((r) => r.event_id)).toEqual(["e1"]);
    expect([...bookedEventIds(merged, [{ event_id: "e9" }])].sort()).toEqual(["e1", "e9"]);
  });
});
