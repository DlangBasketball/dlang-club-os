import { describe, expect, it } from "vitest";
import {
  attendanceCorrectionSchema, availabilitySchema, bookingEditSchema, dbErrorKey, programRow, programSchema,
  requiredReasonSchema, scheduleSummaryOf, serviceSchema, shiftOccurrences, zodErrorKey, zonedParts,
} from "@/lib/club-ops/validation";
import { eventPlace, eventPlaceLine, mapsUrl } from "@/lib/sportsops/location";
import en from "@/messages/en.json";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

function lookup(key: string): unknown {
  return key.split(".").reduce<unknown>((n, k) => (n && typeof n === "object" ? (n as Record<string, unknown>)[k] : undefined), en);
}

describe("programSchema", () => {
  const base = { name: "Summer Camp", kind: "camp" as const, price: 290 };

  it("accepts a minimal programme and fills defaults", () => {
    const r = programSchema.parse(base);
    expect(r.status).toBe("published");
    expect(r.currency).toBe("");
    expect(r.isPublic).toBe(false);
  });

  it("maps to columns without any org_id and with null for blanks", () => {
    const row = programRow(programSchema.parse({ ...base, scheduleSummary: "Mon 17:00", currency: "EUR", minAge: 8, maxAge: 12 }));
    expect(row).not.toHaveProperty("org_id");
    expect(row.schedule).toEqual({ summary: "Mon 17:00" });
    expect(row.currency).toBe("EUR");
    expect(row.capacity).toBeNull();
    expect(row.min_age).toBe(8);
    expect(row.registration_opens_at).toBeNull();
    expect(scheduleSummaryOf(row.schedule)).toBe("Mon 17:00");
    expect(scheduleSummaryOf(null)).toBe("");
  });

  it.each([
    [{ name: "x" }, "editOps.errors.nameRequired"],
    [{ price: -1 }, "editOps.errors.price"],
    [{ startsOn: "2027-07-10", endsOn: "2027-07-01" }, "editOps.errors.endBeforeStart"],
    [{ minAge: 14, maxAge: 10 }, "editOps.errors.ageRange"],
    [{ minAge: 120 }, "editOps.errors.ageRange"],
    [{ registrationOpensAt: "2027-03-02T08:00:00Z", registrationClosesAt: "2027-03-01T08:00:00Z" }, "editOps.errors.windowOrder"],
    [{ capacity: 0 }, "editOps.errors.capacity"],
  ])("rejects %j with %s", (patch, key) => {
    const r = programSchema.safeParse({ ...base, ...patch });
    expect(r.success).toBe(false);
    if (!r.success) expect(zodErrorKey(r.error)).toBe(key);
  });

  it("rejects an unknown status or currency", () => {
    expect(programSchema.safeParse({ ...base, status: "deleted" }).success).toBe(false);
    expect(programSchema.safeParse({ ...base, currency: "GBX" }).success).toBe(false);
  });
});

describe("shiftOccurrences", () => {
  it("moves later occurrences by the same offset and applies the new length", () => {
    const out = shiftOccurrences(
      { oldStart: "2026-11-02T16:00:00.000Z", newStart: "2026-11-02T17:00:00.000Z", newEnd: "2026-11-02T19:00:00.000Z" },
      [{ id: "b", startsAt: "2026-11-09T16:00:00.000Z" }, { id: "c", startsAt: "2026-11-16T16:00:00.000Z" }],
    );
    expect(out).toEqual([
      { id: "b", startsAt: "2026-11-09T17:00:00.000Z", endsAt: "2026-11-09T19:00:00.000Z" },
      { id: "c", startsAt: "2026-11-16T17:00:00.000Z", endsAt: "2026-11-16T19:00:00.000Z" },
    ]);
  });
});

describe("attendanceCorrectionSchema", () => {
  it("accepts status changes, removals (null) and notes", () => {
    const r = attendanceCorrectionSchema.parse({ sessionId: U1, marks: [{ athleteId: U2, status: "late" }, { athleteId: U1, status: null }], reason: "late bus" });
    expect(r.marks[0]).toEqual({ athleteId: U2, status: "late", notes: "", injuryFlag: false });
    expect(r.marks[1].status).toBeNull();
  });
  it("rejects empty batches, bad ids, bad status and long reasons", () => {
    expect(attendanceCorrectionSchema.safeParse({ sessionId: U1, marks: [] }).success).toBe(false);
    expect(attendanceCorrectionSchema.safeParse({ sessionId: "nope", marks: [{ athleteId: U2, status: "late" }] }).success).toBe(false);
    expect(attendanceCorrectionSchema.safeParse({ sessionId: U1, marks: [{ athleteId: U2, status: "maybe" }] }).success).toBe(false);
    const long = attendanceCorrectionSchema.safeParse({ sessionId: U1, marks: [{ athleteId: U2, status: "late" }], reason: "x".repeat(501) });
    expect(long.success).toBe(false);
    if (!long.success) expect(zodErrorKey(long.error)).toBe("editOps.errors.reasonTooLong");
  });
});

describe("bookings, services, availability", () => {
  it("validates an admin booking edit", () => {
    expect(bookingEditSchema.safeParse({ serviceId: U1, coachId: U2, startsAt: "2026-12-01T16:00:00Z", status: "completed" }).success).toBe(true);
    expect(bookingEditSchema.safeParse({ serviceId: U1, coachId: U2, startsAt: "2026-12-01T16:00:00Z", status: "cancelled" }).success).toBe(false);
    const back = bookingEditSchema.safeParse({ serviceId: U1, coachId: U2, startsAt: "2026-12-01T16:00:00Z", endsAt: "2026-12-01T15:00:00Z", status: "booked" });
    expect(back.success).toBe(false);
    if (!back.success) expect(zodErrorKey(back.error)).toBe("editOps.errors.endBeforeStart");
  });
  it("requires a cancel reason", () => {
    expect(requiredReasonSchema.safeParse("   ").success).toBe(false);
    expect(requiredReasonSchema.parse("  coach ill ")).toBe("coach ill");
  });
  it("validates services", () => {
    expect(serviceSchema.safeParse({ name: "PT", durationMin: 60, priceChf: 80, creditCategory: "personal", creditsRequired: 1 }).success).toBe(true);
    expect(serviceSchema.safeParse({ name: "PT", durationMin: 5, priceChf: 80, creditCategory: "personal", creditsRequired: 1 }).success).toBe(false);
  });
  it("validates availability slots", () => {
    expect(availabilitySchema.safeParse({ startsAt: "2026-12-01T16:00:00Z", endsAt: "2026-12-01T17:00:00Z" }).success).toBe(true);
    expect(availabilitySchema.safeParse({ startsAt: "2026-12-01T16:00:00Z", endsAt: "2026-12-02T16:00:00Z" }).success).toBe(false);
  });
});

describe("errors and i18n keys", () => {
  it("maps database errors to keys that exist in the catalog", () => {
    const cases = ["PROGRAM_HAS_REGISTRATIONS", "SESSION_LOCKED", "COACH_BUSY", "new row violates row-level security policy", "boom"];
    for (const c of cases) expect(typeof lookup(dbErrorKey(c))).toBe("string");
    expect(dbErrorKey("SESSION_LOCKED")).toBe("editOps.errors.sessionLocked");
    expect(dbErrorKey("boom")).toBe("editOps.errors.generic");
  });
  it("every validation message key exists in en.json", () => {
    const keys = ["nameRequired", "price", "endBeforeStart", "ageRange", "windowOrder", "capacity", "reasonTooLong", "reasonRequired", "tooLong",
      "invalidDate", "invalidRequest", "nothingToSave", "duration", "credits", "tooLongDuration"];
    for (const k of keys) expect(typeof lookup(`editOps.errors.${k}`)).toBe("string");
  });
});

describe("zonedParts", () => {
  it("returns wall-clock parts in the club time zone", () => {
    expect(zonedParts("2026-07-01T15:30:00Z", "Europe/Zurich")).toEqual({ date: "2026-07-01", time: "17:30" });
    expect(zonedParts("2026-12-01T15:30:00Z", "Europe/Zurich")).toEqual({ date: "2026-12-01", time: "16:30" });
    expect(zonedParts(null, "Europe/Zurich")).toEqual({ date: "", time: "" });
  });
});

describe("event location", () => {
  it("shows a club venue with its court and address", () => {
    const p = eventPlace({ venueName: "Gym A", spaceName: "Court 1", venueAddress: "Rue 1, Lausanne" });
    expect(p).toEqual({ label: "Gym A · Court 1", address: "Rue 1, Lausanne", isVenue: true });
    expect(eventPlaceLine(p)).toBe("Gym A · Court 1, Rue 1, Lausanne");
  });
  it("shows an away / other location by name and address, or TBC", () => {
    const p = eventPlace({ venueName: null, locationName: "Away gym", locationText: "Main St 5, Bern" });
    expect(p.isVenue).toBe(false);
    expect(eventPlaceLine(p)).toBe("Away gym, Main St 5, Bern");
    expect(eventPlaceLine(eventPlace({ venueName: null, locationText: "Main St 5" }))).toBe("Main St 5");
    expect(eventPlace({ venueName: null }).label).toBeNull();
  });
  it("builds an encoded maps link", () => {
    expect(mapsUrl("Main St 5, Bern")).toBe("https://www.google.com/maps/search/?api=1&query=Main%20St%205%2C%20Bern");
    expect(mapsUrl("  ")).toBeNull();
  });
});
