import { describe, expect, it } from "vitest";
import {
  addDays, generateSlots, groupByLocalDate, isoWeekday, localParts, mergeAnyCoach, participantsNeeded, withinOpeningHours,
  type GenerateInput,
} from "@/lib/training/slots";
import {
  applyDiscount, expiryFor, isWithinCancellationWindow, packageSavings, pendingSessions, perSessionPrice, pickLot,
  remainingSessions, roundMoney, sortPackages,
} from "@/lib/training/pricing";
import { trainingErrorKey, serviceInputSchema, packageRowSchema, templateSchema } from "@/lib/training/validation";

const TZ = "Europe/Zurich";
const COACH = "c1";
const COACH2 = "c2";
const VENUE = "v1";
const HOURS = { "1": [["10:00", "18:00"]], "2": [["10:00", "18:00"]], "3": [["10:00", "18:00"]], "4": [["10:00", "18:00"]], "5": [["10:00", "18:00"]], "6": [["10:00", "22:00"]], "7": [["10:00", "22:00"]] } as Record<string, [string, string][]>;

function base(over: Partial<GenerateInput> = {}): GenerateInput {
  return {
    timeZone: TZ,
    fromDate: "2026-11-16", // a Monday
    days: 1,
    service: { id: "pt", durationMin: 60, maxParticipants: 1, minParticipants: 1, venueId: VENUE },
    coachIds: [COACH],
    templates: [{ coachId: COACH, venueId: VENUE, serviceId: null, weekday: 1, startTime: "10:00", endTime: "18:00", capacity: 6 }],
    windows: [],
    blackouts: [],
    busy: [],
    venueHours: { [VENUE]: HOURS },
    stepMin: 60,
    now: new Date("2026-11-01T00:00:00Z"),
    ...over,
  };
}

describe("package and credit math", () => {
  it("per-session price and savings for the 1/5/10/16/20 ladder", () => {
    const single = 95;
    expect(perSessionPrice({ sessions: 5, price: 450 }, "CHF")).toBe(90);
    expect(perSessionPrice({ sessions: 10, price: 850 }, "CHF")).toBe(85);
    expect(perSessionPrice({ sessions: 16, price: 1280 }, "CHF")).toBe(80);
    expect(perSessionPrice({ sessions: 20, price: 1500 }, "CHF")).toBe(75);
    expect(packageSavings({ sessions: 20, price: 1500 }, single, "CHF")).toEqual({ amount: 400, percent: 21 });
    expect(packageSavings({ sessions: 1, price: 95 }, single, "CHF")).toEqual({ amount: 0, percent: 0 });
    expect(perSessionPrice({ sessions: 3, price: 100 }, "CHF")).toBe(33.33);
    expect(perSessionPrice({ sessions: 3, price: 1000 }, "JPY")).toBe(333);
    expect(perSessionPrice({ sessions: 0, price: 100 }, "CHF")).toBe(0);
    expect(roundMoney(0.1 + 0.2, "EUR")).toBe(0.3);
  });

  it("sorts active packages by sessions", () => {
    const out = sortPackages([
      { id: "c", sessions: 10, price: 850, validityDays: null },
      { id: "x", sessions: 2, price: 1, validityDays: null, isActive: false },
      { id: "a", sessions: 5, price: 450, validityDays: 180 },
    ]);
    expect(out.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("balances count active, unexpired lots; pending kept apart", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const lots = [
      { sessions: 10, sessionsUsed: 3, status: "active" as const, expiresAt: null },
      { sessions: 5, sessionsUsed: 0, status: "active" as const, expiresAt: "2026-05-31T00:00:00Z" }, // expired
      { sessions: 5, sessionsUsed: 1, status: "pending" as const, expiresAt: null },
      { sessions: 5, sessionsUsed: 0, status: "cancelled" as const, expiresAt: null },
    ];
    expect(remainingSessions(lots, now)).toBe(7);
    expect(pendingSessions(lots)).toBe(4);
  });

  it("consumes the lot that expires first", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const lots = [
      { id: "never", sessions: 5, sessionsUsed: 0, status: "active" as const, expiresAt: null },
      { id: "soon", sessions: 5, sessionsUsed: 0, status: "active" as const, expiresAt: "2026-07-01T00:00:00Z" },
      { id: "full", sessions: 5, sessionsUsed: 5, status: "active" as const, expiresAt: "2026-06-10T00:00:00Z" },
    ];
    expect(pickLot(lots, now)?.id).toBe("soon");
    expect(pickLot([], now)).toBeNull();
  });

  it("validity and cancellation window", () => {
    expect(expiryFor(new Date("2026-01-01T00:00:00Z"), 30)?.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(expiryFor(new Date(), null)).toBeNull();
    const now = new Date("2026-06-01T10:00:00Z");
    expect(isWithinCancellationWindow("2026-06-02T10:00:00Z", 24, now)).toBe(true);
    expect(isWithinCancellationWindow("2026-06-02T09:59:00Z", 24, now)).toBe(false);
  });

  it("discount hook defaults to no discount and clamps", () => {
    expect(applyDiscount(450, "CHF", { serviceId: "s", packageId: "p" })).toEqual({ discountTotal: 0, discountIds: [], amount: 450 });
    expect(applyDiscount(450, "CHF", { serviceId: "s", packageId: null }, () => ({ total: 45.004, ids: ["d1"] }))).toEqual({ discountTotal: 45, discountIds: ["d1"], amount: 405 });
    expect(applyDiscount(40, "CHF", { serviceId: "s", packageId: null }, () => ({ total: 99, ids: [] })).amount).toBe(0);
  });
});

describe("calendar helpers", () => {
  it("weekday, addDays and local parts in the club time zone", () => {
    expect(isoWeekday("2026-11-16")).toBe(1);
    expect(isoWeekday("2026-11-22")).toBe(7);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(localParts(Date.parse("2026-11-16T09:00:00Z"), TZ)).toEqual({ date: "2026-11-16", minutes: 600 });
    expect(localParts(Date.parse("2026-07-01T23:30:00Z"), TZ)).toEqual({ date: "2026-07-02", minutes: 90 });
  });

  it("opening hours", () => {
    expect(withinOpeningHours(HOURS, 1, 600, 1080)).toBe(true);
    expect(withinOpeningHours(HOURS, 1, 1020, 1140)).toBe(false);
    expect(withinOpeningHours(HOURS, 6, 1260, 1320)).toBe(true);
    expect(withinOpeningHours(null, 1, 0, 1440)).toBe(true);
    expect(withinOpeningHours({ "1": [["10:00", "12:00"]] }, 2, 600, 660)).toBe(false);
  });
});

describe("slot generation", () => {
  it("Mon 10-18 template, 60 min, hourly step -> 8 slots in local time (winter, UTC+1)", () => {
    const slots = generateSlots(base());
    expect(slots).toHaveLength(8);
    expect(slots[0].start).toBe("2026-11-16T09:00:00.000Z");
    expect(slots[7].start).toBe("2026-11-16T16:00:00.000Z");
    expect(slots[7].end).toBe("2026-11-16T17:00:00.000Z");
    expect(slots.every((s) => s.capacity === 1 && s.spotsLeft === 1 && s.venueId === VENUE)).toBe(true);
  });

  it("uses the org time zone across DST (summer, UTC+2)", () => {
    const slots = generateSlots(base({ fromDate: "2026-06-15", now: new Date("2026-06-01T00:00:00Z") }));
    expect(slots[0].start).toBe("2026-06-15T08:00:00.000Z");
  });

  it("other zones are wall-clock too", () => {
    const slots = generateSlots(base({ timeZone: "America/New_York" }));
    expect(slots[0].start).toBe("2026-11-16T15:00:00.000Z");
  });

  it("30-minute step, venue hours clip the window, lead time hides early slots", () => {
    const slots = generateSlots(base({
      stepMin: 30,
      templates: [{ coachId: COACH, venueId: VENUE, serviceId: null, weekday: 1, startTime: "09:00", endTime: "19:00", capacity: 1 }],
      now: new Date("2026-11-16T09:10:00Z"), // 10:10 local
      leadMinutes: 60,
    }));
    // earliest 11:10 local -> 11:30 ... last start 17:00 (venue closes 18:00)
    expect(slots[0].start).toBe("2026-11-16T10:30:00.000Z");
    expect(slots[slots.length - 1].start).toBe("2026-11-16T16:00:00.000Z");
  });

  it("validity range and service-specific templates", () => {
    expect(generateSlots(base({ templates: [{ coachId: COACH, venueId: VENUE, serviceId: null, weekday: 1, startTime: "10:00", endTime: "12:00", capacity: 1, validFrom: "2026-12-01" }] }))).toHaveLength(0);
    expect(generateSlots(base({ templates: [{ coachId: COACH, venueId: VENUE, serviceId: "other", weekday: 1, startTime: "10:00", endTime: "12:00", capacity: 1 }] }))).toHaveLength(0);
    expect(generateSlots(base({ coachIds: [COACH2] }))).toHaveLength(0);
  });

  it("blackouts: coach, club-wide and venue", () => {
    const b = { startsAt: "2026-11-16T09:00:00Z", endsAt: "2026-11-16T11:00:00Z" };
    expect(generateSlots(base({ blackouts: [{ coachId: COACH, venueId: null, ...b }] }))).toHaveLength(6);
    expect(generateSlots(base({ blackouts: [{ coachId: null, venueId: null, ...b }] }))).toHaveLength(6);
    expect(generateSlots(base({ blackouts: [{ coachId: null, venueId: VENUE, ...b }] }))).toHaveLength(6);
    expect(generateSlots(base({ blackouts: [{ coachId: null, venueId: "other", ...b }] }))).toHaveLength(8);
    expect(generateSlots(base({ blackouts: [{ coachId: COACH2, venueId: null, ...b }] }))).toHaveLength(8);
  });

  it("an overlapping booking of another session makes the coach busy", () => {
    const slots = generateSlots(base({ busy: [{ coachId: COACH, serviceId: "other", start: "2026-11-16T09:30:00Z", end: "2026-11-16T10:30:00Z", booked: 1 }] }));
    expect(slots.map((s) => s.start)).not.toContain("2026-11-16T09:00:00.000Z");
    expect(slots.map((s) => s.start)).not.toContain("2026-11-16T10:00:00.000Z");
    expect(slots).toHaveLength(6);
  });

  it("group capacity: spots left, full groups hidden, min participants", () => {
    const service = { id: "grp", durationMin: 60, maxParticipants: 6, minParticipants: 2, venueId: VENUE };
    const busy = [
      { coachId: COACH, serviceId: "grp", start: "2026-11-16T09:00:00Z", end: "2026-11-16T10:00:00Z", booked: 1 },
      { coachId: COACH, serviceId: "grp", start: "2026-11-16T10:00:00Z", end: "2026-11-16T11:00:00Z", booked: 6 },
    ];
    const slots = generateSlots(base({ service, busy }));
    const first = slots.find((s) => s.start === "2026-11-16T09:00:00.000Z")!;
    expect(first.capacity).toBe(6);
    expect(first.booked).toBe(1);
    expect(first.spotsLeft).toBe(5);
    expect(participantsNeeded(service.minParticipants, first.booked)).toBe(1);
    expect(participantsNeeded(service.minParticipants, 3)).toBe(0);
    expect(slots.find((s) => s.start === "2026-11-16T10:00:00.000Z")).toBeUndefined();
    // window capacity below the service maximum wins
    const small = generateSlots(base({ service, templates: [{ coachId: COACH, venueId: VENUE, serviceId: null, weekday: 1, startTime: "10:00", endTime: "11:00", capacity: 3 }] }));
    expect(small[0].capacity).toBe(3);
  });

  it("one-off windows are instants, deduplicated with templates", () => {
    const slots = generateSlots(base({
      templates: [],
      windows: [
        { coachId: COACH, venueId: null, serviceId: null, startsAt: "2026-11-16T17:00:00Z", endsAt: "2026-11-16T19:00:00Z", capacity: 1 },
        { coachId: COACH, venueId: null, serviceId: null, startsAt: "2026-11-17T17:00:00Z", endsAt: "2026-11-17T19:00:00Z", capacity: 1 },
      ],
      venueHours: {},
    }));
    // only the first local day is in range; venue falls back to the service default
    expect(slots.map((s) => s.start)).toEqual(["2026-11-16T17:00:00.000Z", "2026-11-16T18:00:00.000Z"]);
    expect(slots[0].venueId).toBe(VENUE);
  });

  it("any coach: one slot per time, filling started groups first", () => {
    const service = { id: "grp", durationMin: 60, maxParticipants: 6, minParticipants: 2, venueId: VENUE };
    const slots = generateSlots(base({
      service,
      coachIds: [COACH, COACH2],
      templates: [
        { coachId: COACH, venueId: VENUE, serviceId: null, weekday: 1, startTime: "10:00", endTime: "11:00", capacity: 6 },
        { coachId: COACH2, venueId: VENUE, serviceId: null, weekday: 1, startTime: "10:00", endTime: "11:00", capacity: 6 },
      ],
      busy: [{ coachId: COACH2, serviceId: "grp", start: "2026-11-16T09:00:00Z", end: "2026-11-16T10:00:00Z", booked: 2 }],
    }));
    expect(slots).toHaveLength(2);
    const merged = mergeAnyCoach(slots);
    expect(merged).toHaveLength(1);
    expect(merged[0].coachId).toBe(COACH2);
    expect(groupByLocalDate(merged, TZ)[0].date).toBe("2026-11-16");
  });
});

describe("validation", () => {
  it("service input", () => {
    const ok = serviceInputSchema.safeParse({ name: "Group", sessionType: "group", maxParticipants: 6, minParticipants: 2, durationMin: 60, price: 40, currency: "", coachIds: [] });
    expect(ok.success).toBe(true);
    expect(serviceInputSchema.safeParse({ name: "G", sessionType: "group", maxParticipants: 2, minParticipants: 3, durationMin: 60, price: 40 }).success).toBe(false);
    expect(serviceInputSchema.safeParse({ name: "P", sessionType: "individual", maxParticipants: 1, minParticipants: 1, durationMin: 60, price: 95, color: "red" }).success).toBe(false);
  });
  it("package rows and templates", () => {
    expect(packageRowSchema.safeParse({ sessions: 5, price: 450, validityDays: "" }).success).toBe(true);
    expect(packageRowSchema.safeParse({ sessions: 0, price: 450 }).success).toBe(false);
    expect(templateSchema.safeParse({ coachId: "00000000-0000-0000-0000-000000000011", weekday: 1, startTime: "18:00", endTime: "10:00" }).success).toBe(false);
  });
  it("maps database errors to training keys", () => {
    expect(trainingErrorKey("SLOT_FULL")).toBe("training.errors.slotFull");
    expect(trainingErrorKey("new row violates row-level security")).toBe("training.errors.notPermitted");
    expect(trainingErrorKey("weird")).toBe("training.errors.generic");
  });
});
