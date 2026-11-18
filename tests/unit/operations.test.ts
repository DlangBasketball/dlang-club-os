import { describe, expect, it } from "vitest";
import {
  allocationClashes,
  allocationsClash,
  computeClosureImpact,
  expandAllocations,
  findCourtConflicts,
  isAffected,
  locationMatchesVenue,
  shiftByDays,
  type Allocation,
  type OneOff,
  type ScheduledItem,
} from "@/lib/operations/facilities";
import { findJerseyConflicts, isJerseyNumberFree, kitStatusCounts, sizesEditable, suggestFreeNumbers, type KitNumberRow } from "@/lib/operations/kit";
import { campaignOpen, campaignProgress, donorYearTotals, type DonationLike } from "@/lib/operations/fundraising";
import { availableQuantity, isOverdue, overdueCheckouts, reminderDue, sponsorRenewalDue } from "@/lib/operations/equipment";
import {
  allocationSchema,
  closureApplySchema,
  donationSchema,
  equipmentItemSchema,
  kitAssignmentSchema,
  meetingSchema,
  publicDonationSchema,
} from "@/lib/operations/validation";

const TZ = "Europe/Zurich";
const VENUE = "11111111-1111-4111-8111-111111111111";
const OTHER_VENUE = "22222222-2222-4222-8222-222222222222";
const COURT_A = "33333333-3333-4333-8333-333333333333";
const COURT_B = "44444444-4444-4444-8444-444444444444";

const alloc = (over: Partial<Allocation> = {}): Allocation => ({
  id: "a1", venueId: VENUE, spaceId: COURT_A, teamId: "t1", label: "U14", weekday: 2, startTime: "17:00", endTime: "18:30",
  validFrom: "2026-08-15", validUntil: null, isActive: true, ...over,
});

describe("court conflict detection — recurring vs recurring", () => {
  it("flags the same court, weekday and overlapping time", () => {
    expect(allocationsClash(alloc(), alloc({ id: "a2", startTime: "18:00", endTime: "19:00" }))).toBe(true);
  });
  it("back-to-back slots do not clash", () => {
    expect(allocationsClash(alloc(), alloc({ id: "a2", startTime: "18:30", endTime: "20:00" }))).toBe(false);
  });
  it("different courts of the same venue do not clash, but the whole venue blocks every court", () => {
    expect(allocationsClash(alloc(), alloc({ id: "a2", spaceId: COURT_B }))).toBe(false);
    expect(allocationsClash(alloc(), alloc({ id: "a2", spaceId: null }))).toBe(true);
  });
  it("different weekdays, venues, inactive rows and disjoint validity never clash", () => {
    expect(allocationsClash(alloc(), alloc({ id: "a2", weekday: 3 }))).toBe(false);
    expect(allocationsClash(alloc(), alloc({ id: "a2", venueId: OTHER_VENUE }))).toBe(false);
    expect(allocationsClash(alloc(), alloc({ id: "a2", isActive: false }))).toBe(false);
    expect(allocationsClash(alloc({ validUntil: "2026-12-31" }), alloc({ id: "a2", validFrom: "2027-01-01" }))).toBe(false);
    expect(allocationsClash(alloc({ validFrom: "2027-01-01" }), alloc({ id: "a2", validFrom: "2026-01-01", validUntil: null }))).toBe(true);
  });
  it("lists clashes pairwise for the weekly grid", () => {
    const m = allocationClashes([alloc(), alloc({ id: "a2", startTime: "18:00", endTime: "19:00" }), alloc({ id: "a3", weekday: 5 })]);
    expect(m.get("a1")).toEqual(["a2"]);
    expect(m.get("a2")).toEqual(["a1"]);
    expect(m.has("a3")).toBe(false);
  });
});

describe("court conflict detection — recurring vs one-off", () => {
  // 2026-09-01 is a Tuesday (ISO 2); 17:00 Zurich = 15:00 UTC in summer time.
  const game: OneOff = { id: "e1", kind: "event", venueId: VENUE, spaceId: COURT_A, label: "Game", start: "2026-09-01T15:30:00Z", end: "2026-09-01T17:00:00Z" };

  it("a new weekly allocation clashes with an existing game on one of its days", () => {
    const c = findCourtConflicts({ allocation: alloc() }, { allocations: [], oneOffs: [game] }, TZ);
    expect(c).toEqual([{ kind: "event", id: "e1", label: "Game", start: game.start, end: game.end }]);
  });
  it("a one-off rental clashes with the weekly allocation of that weekday", () => {
    const rental: OneOff = { ...game, id: "r1", kind: "rental", label: "Rental" };
    const c = findCourtConflicts({ oneOff: rental }, { allocations: [alloc()], oneOffs: [] }, TZ);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: "allocation", id: "a1", start: "2026-09-01T15:00:00.000Z", end: "2026-09-01T16:30:00.000Z" });
  });
  it("is DST-correct: the same wall-clock slot in winter is 16:00 UTC", () => {
    const winter: OneOff = { ...game, id: "r2", kind: "rental", start: "2026-12-01T16:15:00Z", end: "2026-12-01T16:45:00Z" };
    expect(findCourtConflicts({ oneOff: winter }, { allocations: [alloc()], oneOffs: [] }, TZ)).toHaveLength(1);
    const summerOffsetGuess: OneOff = { ...winter, id: "r3", start: "2026-12-01T15:00:00Z", end: "2026-12-01T15:45:00Z" };
    expect(findCourtConflicts({ oneOff: summerOffsetGuess }, { allocations: [alloc()], oneOffs: [] }, TZ)).toHaveLength(0);
  });
  it("ignores one-offs before the allocation starts or on another court", () => {
    const early: OneOff = { ...game, start: "2026-08-11T15:30:00Z", end: "2026-08-11T16:00:00Z" };
    const otherCourt: OneOff = { ...game, id: "e2", spaceId: COURT_B };
    expect(findCourtConflicts({ allocation: alloc() }, { allocations: [], oneOffs: [early, otherCourt] }, TZ)).toEqual([]);
  });
  it("one-off vs one-off: overlap on the same court, half-open ranges", () => {
    const a: OneOff = { ...game, id: "x" };
    const touching: OneOff = { ...game, id: "y", start: game.end, end: "2026-09-01T18:00:00Z" };
    const overlapping: OneOff = { ...game, id: "z", start: "2026-09-01T16:59:00Z", end: "2026-09-01T18:00:00Z" };
    const c = findCourtConflicts({ oneOff: a }, { allocations: [], oneOffs: [touching, overlapping] }, TZ);
    expect(c.map((x) => x.id)).toEqual(["z"]);
  });
  it("expands allocations over a range on the right weekdays", () => {
    const slots = expandAllocations([alloc()], "2026-08-31", "2026-09-13", TZ);
    expect(slots.map((s) => s.start)).toEqual(["2026-09-01T15:00:00.000Z", "2026-09-08T15:00:00.000Z"]);
  });
});

describe("venue closure impact", () => {
  const closure = { venueId: VENUE, spaceId: null, startsOn: "2026-12-21", endsOn: "2027-01-04" };
  const item = (over: Partial<ScheduledItem>): ScheduledItem => ({
    kind: "event", id: "i", venueId: VENUE, spaceId: null, label: "x", start: "2026-12-22T17:00:00Z", end: "2026-12-22T18:00:00Z",
    allDay: false, status: "scheduled", ...over,
  });

  it("includes live items at the venue overlapping the closed days (club-local)", () => {
    // 2026-12-20 23:30 UTC is already 21 Dec 00:30 in Zurich.
    expect(isAffected(closure, item({ start: "2026-12-20T23:30:00Z", end: "2026-12-21T00:30:00Z" }), TZ)).toBe(true);
    // 2027-01-04 22:59 UTC is still 4 Jan 23:59 in Zurich.
    expect(isAffected(closure, item({ start: "2027-01-04T22:00:00Z", end: "2027-01-04T22:59:00Z" }), TZ)).toBe(true);
    expect(isAffected(closure, item({ start: "2027-01-04T23:00:00Z", end: "2027-01-05T00:00:00Z" }), TZ)).toBe(false);
  });
  it("excludes cancelled items, other venues and other courts when only one court closes", () => {
    expect(isAffected(closure, item({ status: "cancelled" }), TZ)).toBe(false);
    expect(isAffected(closure, item({ venueId: OTHER_VENUE }), TZ)).toBe(false);
    const courtClosure = { ...closure, spaceId: COURT_A };
    expect(isAffected(courtClosure, item({ spaceId: COURT_B }), TZ)).toBe(false);
    expect(isAffected(courtClosure, item({ spaceId: COURT_A }), TZ)).toBe(true);
    expect(isAffected(courtClosure, item({ spaceId: null }), TZ)).toBe(true);
  });
  it("matches all-day camps by date range", () => {
    expect(isAffected(closure, item({ kind: "camp", allDay: true, start: "2027-01-04", end: "2027-01-08", status: "published" }), TZ)).toBe(true);
    expect(isAffected(closure, item({ kind: "camp", allDay: true, start: "2027-01-05", end: "2027-01-08", status: "published" }), TZ)).toBe(false);
  });
  it("aggregates counts, audiences and expanded weekly slots", () => {
    const impact = computeClosureImpact(
      closure,
      [
        item({ id: "e1", teamId: "t1", coachIds: ["c1"] }),
        item({ id: "s1", kind: "session", programId: "p1", coachIds: ["c2"] }),
        item({ id: "b1", kind: "booking", athleteId: "ath1", coachIds: ["c1"] }),
        item({ id: "c1", kind: "camp", allDay: true, start: "2026-12-28", end: "2027-01-01", campEditionId: "ce1", programId: "p2", status: "published" }),
        item({ id: "r1", kind: "rental" }),
        item({ id: "gone", status: "cancelled" }),
      ],
      [alloc({ spaceId: null })],
      TZ,
    );
    // Tuesdays 22 Dec, 29 Dec (the closure ends Monday 4 Jan).
    expect(impact.counts).toEqual({ event: 1, session: 1, camp: 1, booking: 1, rental: 1, allocation: 2 });
    expect(impact.teamIds).toEqual(["t1"]);
    expect(impact.programIds).toEqual(["p1", "p2"]);
    expect(impact.campEditionIds).toEqual(["ce1"]);
    expect(impact.coachIds).toEqual(["c1", "c2"]);
    expect(impact.athleteIds).toEqual(["ath1"]);
  });
  it("moves items by whole local days, keeping the wall-clock time across DST", () => {
    // 24 Oct 2026 17:00 Zurich (CEST, UTC+2) + 7 days = 31 Oct 17:00 (CET, UTC+1).
    expect(shiftByDays("2026-10-24T15:00:00.000Z", 7, TZ)).toBe("2026-10-31T16:00:00.000Z");
    expect(shiftByDays("2026-12-28", 14, TZ)).toBe("2027-01-11");
  });
  it("matches free-text session locations to the venue name", () => {
    expect(locationMatchesVenue("Lancy Sports Centre", "lancy  sports centre")).toBe(true);
    expect(locationMatchesVenue("Salle Genève, court 2", "Salle Geneve")).toBe(true);
    expect(locationMatchesVenue("Lancy Sports Centre Annex", "Lancy Sports Centre")).toBe(false);
    expect(locationMatchesVenue(null, "Lancy")).toBe(false);
  });
});

describe("kit jersey numbers", () => {
  const rows: KitNumberRow[] = [
    { id: "k1", teamId: "t1", athleteId: "a1", jerseyNumber: 7, status: "handed_out" },
    { id: "k2", teamId: "t1", athleteId: "a2", jerseyNumber: 7, status: "returned" },
    { id: "k3", teamId: "t2", athleteId: "a3", jerseyNumber: 7, status: "ordered" },
    { id: "k4", teamId: "t1", athleteId: "a4", jerseyNumber: 0, status: "sizes_requested" },
    { id: "k5", teamId: "t1", athleteId: "a5", jerseyNumber: null, status: "sizes_requested" },
  ];
  it("a number is unique per team; returned kit frees it; other teams are independent", () => {
    expect(isJerseyNumberFree(rows, "t1", 7)).toBe(false);
    expect(isJerseyNumberFree(rows, "t1", 7, "k1")).toBe(true);
    expect(isJerseyNumberFree(rows, "t2", 4)).toBe(true);
    expect(isJerseyNumberFree(rows, "t3", 7)).toBe(true);
    expect(findJerseyConflicts(rows).size).toBe(0);
  });
  it("reports duplicates", () => {
    const dup = findJerseyConflicts([...rows, { id: "k6", teamId: "t1", athleteId: "a6", jerseyNumber: 7, status: "ordered" }]);
    expect(dup.get("t1:7")).toEqual(["k1", "k6"]);
  });
  it("suggests the lowest free numbers and counts statuses", () => {
    expect(suggestFreeNumbers(rows, "t1", 3)).toEqual([1, 2, 3]);
    expect(kitStatusCounts(rows)).toEqual({ sizes_requested: 2, sizes_submitted: 0, ordered: 1, handed_out: 1, returned: 1 });
    expect(sizesEditable("sizes_submitted")).toBe(true);
    expect(sizesEditable("handed_out")).toBe(false);
  });
});

describe("campaign progress math", () => {
  const d = (amount: number, over: Partial<DonationLike> = {}): DonationLike => ({ amount, currency: "CHF", status: "received", donorId: null, donatedOn: "2026-05-01", ...over });
  it("sums in minor units without float drift", () => {
    const p = campaignProgress(0.3, "CHF", [d(0.1), d(0.2)]);
    expect(p.raised).toBe(0.3);
    expect(p.percent).toBe(100);
    expect(p.reached).toBe(true);
    expect(p.remaining).toBe(0);
  });
  it("ignores refunds and other currencies; caps the bar at 100", () => {
    const p = campaignProgress(1000, "chf", [d(600, { donorId: "x" }), d(600, { donorId: "x" }), d(500, { status: "refunded" }), d(900, { currency: "EUR" })]);
    expect(p.raised).toBe(1200);
    expect(p.percent).toBe(120);
    expect(p.barPercent).toBe(100);
    expect(p.donationCount).toBe(2);
    expect(p.donorCount).toBe(1);
  });
  it("partial progress, one decimal, unknown donors counted individually", () => {
    const p = campaignProgress(8000, "CHF", [d(250), d(125.5), d(40, { donorId: "a" })]);
    expect(p.raised).toBe(415.5);
    expect(p.percent).toBe(5.2);
    expect(p.remaining).toBe(7584.5);
    expect(p.donorCount).toBe(3);
    expect(p.reached).toBe(false);
  });
  it("zero goal is never reached and shows 0 %", () => {
    expect(campaignProgress(0, "CHF", [d(10)])).toMatchObject({ percent: 0, reached: false });
  });
  it("annual donor totals per currency for receipts", () => {
    const totals = donorYearTotals(
      [d(100, { donorId: "a", donatedOn: "2026-02-01" }), d(50.25, { donorId: "a", donatedOn: "2026-11-01" }), d(10, { donorId: "a", donatedOn: "2025-12-31" }),
       d(20, { donorId: "a", currency: "EUR", donatedOn: "2026-03-01" }), d(30, { donorId: "a", status: "refunded", donatedOn: "2026-03-01" }), d(5, { donatedOn: "2026-01-01" })],
      2026,
    );
    expect(totals).toEqual([
      { donorId: "a", currency: "CHF", total: 150.25, count: 2, dates: ["2026-02-01", "2026-11-01"] },
      { donorId: "a", currency: "EUR", total: 20, count: 1, dates: ["2026-03-01"] },
    ]);
  });
  it("campaign open window", () => {
    expect(campaignOpen({ status: "active", startsOn: "2026-01-01", endsOn: "2026-12-31" }, "2026-06-01")).toBe(true);
    expect(campaignOpen({ status: "active", startsOn: "2026-01-01", endsOn: "2026-12-31" }, "2027-01-01")).toBe(false);
    expect(campaignOpen({ status: "draft", startsOn: null, endsOn: null }, "2026-06-01")).toBe(false);
  });
});

describe("equipment stock and reminders", () => {
  const co = [
    { id: "1", itemId: "i", quantity: 3, dueOn: "2026-11-10", returnedAt: null },
    { id: "2", itemId: "i", quantity: 2, dueOn: null, returnedAt: "2026-11-01T10:00:00Z" },
    { id: "3", itemId: "i", quantity: 4, dueOn: "2026-11-18", returnedAt: null },
  ];
  it("available stock never goes below zero", () => {
    expect(availableQuantity(10, co, "i")).toBe(3);
    expect(availableQuantity(5, co, "i")).toBe(0);
  });
  it("overdue = open and due before today", () => {
    expect(overdueCheckouts(co, "2026-11-18").map((c) => c.id)).toEqual(["1"]);
    expect(isOverdue(co[2], "2026-11-19")).toBe(true);
  });
  it("reminder cadence and sponsor renewal window", () => {
    const now = new Date("2026-11-18T08:00:00Z");
    expect(reminderDue(null, now)).toBe(true);
    expect(reminderDue("2026-11-17T08:00:00Z", now)).toBe(false);
    expect(reminderDue("2026-11-15T08:00:00Z", now)).toBe(true);
    expect(sponsorRenewalDue({ status: "active", contractEnd: "2027-01-10", reminderDays: 60 }, "2026-11-18")).toBe(true);
    expect(sponsorRenewalDue({ status: "active", contractEnd: "2027-03-10", reminderDays: 60 }, "2026-11-18")).toBe(false);
    expect(sponsorRenewalDue({ status: "active", contractEnd: "2026-11-17", reminderDays: 60 }, "2026-11-18")).toBe(false);
    expect(sponsorRenewalDue({ status: "cancelled", contractEnd: "2026-12-01", reminderDays: 60 }, "2026-11-18")).toBe(false);
  });
});

describe("operations validation", () => {
  it("equipment items: quantity, condition and currency", () => {
    expect(equipmentItemSchema.safeParse({ name: "Cones", category: "cones", quantity: "20", condition: "good" }).success).toBe(true);
    expect(equipmentItemSchema.safeParse({ name: "Cones", category: "cones", quantity: "-1", condition: "good" }).success).toBe(false);
    expect(equipmentItemSchema.safeParse({ name: "Cones", category: "cones", quantity: "1", condition: "great" }).success).toBe(false);
    expect(equipmentItemSchema.safeParse({ name: "", category: "cones", quantity: "1", condition: "good" }).success).toBe(false);
  });
  it("allocations need end after start", () => {
    const base = { venueId: VENUE, teamId: COURT_A, weekday: "2", startTime: "17:00", endTime: "18:30", validFrom: "2026-08-15" };
    expect(allocationSchema.safeParse(base).success).toBe(true);
    expect(allocationSchema.safeParse({ ...base, endTime: "16:00" }).success).toBe(false);
    expect(allocationSchema.safeParse({ ...base, validUntil: "2026-08-01" }).success).toBe(false);
    expect(allocationSchema.safeParse({ ...base, teamId: "", label: "" }).success).toBe(false);
  });
  it("kit numbers are 0-999 and sizes short", () => {
    const base = { teamId: VENUE, athleteId: COURT_A };
    expect(kitAssignmentSchema.safeParse({ ...base, jerseyNumber: "23" }).success).toBe(true);
    expect(kitAssignmentSchema.safeParse({ ...base, jerseyNumber: "1000" }).success).toBe(false);
    expect(kitAssignmentSchema.safeParse({ ...base, jerseyNumber: "", jerseySize: "XXXXXXXXXXXXXXXXX" }).success).toBe(false);
  });
  it("closure actions: shift needs days, relocate needs a venue", () => {
    const base = { closureId: VENUE, items: [{ kind: "event", id: COURT_A }], notify: true };
    expect(closureApplySchema.safeParse({ ...base, op: "cancel" }).success).toBe(true);
    expect(closureApplySchema.safeParse({ ...base, op: "shift", shiftDays: "0" }).success).toBe(false);
    expect(closureApplySchema.safeParse({ ...base, op: "shift", shiftDays: "7" }).success).toBe(true);
    expect(closureApplySchema.safeParse({ ...base, op: "relocate" }).success).toBe(false);
    expect(closureApplySchema.safeParse({ ...base, op: "relocate", targetVenueId: OTHER_VENUE }).success).toBe(true);
  });
  it("meetings: agenda lines become items; donations positive", () => {
    const m = meetingSchema.parse({ committeeId: VENUE, title: "Board", kind: "meeting", startsAt: "2027-01-12T19:00", agenda: "Welcome\n\n Budget \n" });
    expect(m.agenda).toEqual([{ title: "Welcome" }, { title: "Budget" }]);
    expect(donationSchema.safeParse({ amount: "0", currency: "CHF", donatedOn: "2026-11-01", method: "cash" }).success).toBe(false);
    expect(publicDonationSchema.safeParse({ campaignId: VENUE, amount: "5", name: "A", email: "a@example.test", anonymous: false }).success).toBe(true);
    expect(publicDonationSchema.safeParse({ campaignId: VENUE, amount: "0.5", name: "A", email: "a@example.test", anonymous: false }).success).toBe(false);
  });
});
