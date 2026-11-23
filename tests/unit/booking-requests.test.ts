import { describe, expect, it } from "vitest";
import {
  availabilityMode, bookingDisplayKey, declineReasonOk, hoursWaiting, isStaleRequest, normalizePromoCode, quoteSummary,
  requestFollowupHours, statusFromAttendance,
} from "@/lib/booking/helpers";
import { buildMessage, portalPathFor, templateFor, type ClaimedBookingNotification } from "@/lib/booking/dispatch-core";
import { changeLabel, sortRequests, toBookedSessionInfo, upcomingStateKey } from "@/lib/booking/portal";
import { declaredTimes, emptyFamilyRequest, familyFormToPayload, packageLeft, withFamilyService } from "@/lib/booking/family-request";
import { emptyBookingForm, formToPayload } from "@/lib/booking/admin-form";
import { bookingErrorCode, familyRequestSchema, toBookingRpcPayload, bookingPayloadSchema, type FamilyCatalogService } from "@/lib/booking/types";
import { render } from "@/lib/notifications/templates";

// SYNTHETIC DATA ONLY.
const TZ = "Europe/Zurich";

describe("booking requests: settings helpers", () => {
  it("availability mode falls back to declared", () => {
    expect(availabilityMode("open_confirm")).toBe("open_confirm");
    expect(availabilityMode("declared")).toBe("declared");
    expect(availabilityMode(undefined)).toBe("declared");
    expect(availabilityMode("anything")).toBe("declared");
  });
  it("follow-up hours are clamped like SQL bk_settings", () => {
    expect(requestFollowupHours(undefined)).toBe(48);
    expect(requestFollowupHours("12")).toBe(12);
    expect(requestFollowupHours(0)).toBe(1);
    expect(requestFollowupHours(10_000)).toBe(720);
    expect(requestFollowupHours("x")).toBe(48);
  });
});

describe("booking requests: waiting time and follow-up", () => {
  const now = "2026-12-05T12:00:00Z";
  it("counts whole hours", () => {
    expect(hoursWaiting("2026-12-05T09:30:00Z", now)).toBe(2);
    expect(hoursWaiting(null, now)).toBe(0);
    expect(hoursWaiting("2026-12-06T09:30:00Z", now)).toBe(0);
  });
  it("flags requests older than the follow-up hours", () => {
    expect(isStaleRequest("2026-12-03T11:00:00Z", now, 48)).toBe(true);
    expect(isStaleRequest("2026-12-03T13:00:00Z", now, 48)).toBe(false);
    expect(isStaleRequest(null, now, 48)).toBe(false);
  });
  it("a decline needs a reason of at most 500 characters", () => {
    expect(declineReasonOk("  ")).toBe(false);
    expect(declineReasonOk("Coach away")).toBe(true);
    expect(declineReasonOk("x".repeat(501))).toBe(false);
  });
});

describe("booking status from attendance (mirror of the SQL trigger)", () => {
  it("maps finalized marks", () => {
    expect(statusFromAttendance("present")).toBe("completed");
    expect(statusFromAttendance("late")).toBe("completed");
    expect(statusFromAttendance("unexcused")).toBe("no_show");
    expect(statusFromAttendance("excused")).toBe("booked");
    expect(statusFromAttendance("unmarked")).toBeNull();
    expect(statusFromAttendance(null)).toBeNull();
  });
  it("labels requests and excused bookings", () => {
    expect(bookingDisplayKey({ status: "requested" })).toBe("requested");
    expect(bookingDisplayKey({ status: "booked", attendance_status: "excused" })).toBe("excused");
    expect(bookingDisplayKey({ status: "booked", attendance_status: null })).toBe("confirmed");
    expect(bookingDisplayKey({ status: "no_show", attendance_status: "unexcused" })).toBe("no_show");
  });
});

describe("quote summary + error codes", () => {
  const base = { warnings: [], billing: { billing_mode: "invoice" as const, setup_missing: [], discount_total: 8 } };
  it("VENUE_CLOSED is overridable by an admin like COACH_UNAVAILABLE", () => {
    const s = quoteSummary({ ...base, errors: ["VENUE_CLOSED"] } as never);
    expect(s.canConfirm).toBe(false);
    expect(s.needsOverride).toBe(true);
  });
  it("reports a request and the discount", () => {
    const s = quoteSummary({ ...base, errors: [], creates: "requested" } as never);
    expect(s.createsRequest).toBe(true);
    expect(s.discount).toBe(8);
  });
  it("finds the new codes in database messages", () => {
    expect(bookingErrorCode("ERROR: VENUE_CLOSED")).toBe("VENUE_CLOSED");
    expect(bookingErrorCode("P0001: PROMO_FAMILY_LIMIT_REACHED")).toBe("PROMO_FAMILY_LIMIT_REACHED");
    expect(bookingErrorCode("PROMO_LIMIT_REACHED")).toBe("PROMO_LIMIT_REACHED");
    expect(bookingErrorCode("NOT_A_REQUEST")).toBe("NOT_A_REQUEST");
  });
});

describe("promo code in the admin form", () => {
  it("normalizes the typed code", () => {
    expect(normalizePromoCode("br-10 off!")).toBe("BR-10OFF");
    expect(normalizePromoCode("x".repeat(60))).toHaveLength(40);
  });
  it("sends the code only at the list price (no price override)", () => {
    const s = emptyBookingForm({ athleteId: "00000000-0000-4000-8000-000000000001", serviceId: "00000000-0000-4000-8000-000000000002",
      coachId: "00000000-0000-4000-8000-000000000003", date: "2026-12-05", time: "10:00", promoCode: "BR10" });
    expect(formToPayload(s, TZ, null)?.promoCode).toBe("BR10");
    expect(formToPayload({ ...s, priceOverride: true, price: "50", priceReason: "x" }, TZ, null)?.promoCode).toBeNull();
    const parsed = bookingPayloadSchema.parse(formToPayload(s, TZ, null));
    expect(toBookingRpcPayload(parsed).promo_code).toBe("BR10");
  });
});

describe("notifications of the request lifecycle", () => {
  it("maps kinds to templates", () => {
    expect(templateFor("requested")).toBe("booking_requested");
    expect(templateFor("request_confirmed")).toBe("booking_confirmation");
    expect(templateFor("request_declined")).toBe("booking_request_declined");
    expect(templateFor("request_withdrawn")).toBe("booking_cancellation");
  });
  it("links coaches to their requests and admins to the booking", () => {
    expect(portalPathFor("coach", true, "b1", "requested")).toBe("/coach/trainings#booking-requests");
    expect(portalPathFor("admin", true, "b1", "requested")).toBe("/admin/bookings/b1");
    expect(portalPathFor("admin", false, "b1", "requested")).toBeUndefined();
  });
  const row: ClaimedBookingNotification = {
    id: "n1", orgId: "o1", bookingId: "b1", kind: "request_declined", recipientKind: "guardian", recipientProfileId: "p1",
    recipientEmail: "guardian@example.test", recipientName: "Synthetic Parent", attempts: 1, serviceName: "Private", coachName: "Coach",
    athleteFirstName: "Nova", startsAt: "2026-12-05T09:00:00Z", endsAt: null, previousStartsAt: null, locationName: null, timeZone: TZ,
    reason: "Coach away",
  };
  it("a decline carries the reason to the family, nothing to staff names", () => {
    const m = buildMessage(row)!;
    expect(m.template).toBe("booking_request_declined");
    expect(m.vars.message).toBe("Coach away");
    expect(m.vars.parent_name).toBe("Synthetic Parent");
    const coach = buildMessage({ ...row, kind: "requested", recipientKind: "coach", recipientName: "Coach Synth" })!;
    expect(coach.vars.parent_name).toBeUndefined();
    expect(coach.vars.message).toBeUndefined();
  });
  it("renders the request and decline templates in English", () => {
    const req = render("booking_requested", { athlete_name: "Nova", service_name: "Private", starts_at: "2026-12-05T09:00:00Z", portal_path: "/coach/trainings" }, { timeZone: TZ });
    expect(req.subject).toContain("Private");
    expect(req.body).toContain("Nova");
    const dec = render("booking_request_declined", { athlete_name: "Nova", service_name: "Private", starts_at: "2026-12-05T09:00:00Z", message: "Coach away" }, { timeZone: TZ });
    expect(dec.body).toContain("Coach away");
    expect(dec.html).toContain("Coach away");
  });
});

describe("portal helpers", () => {
  it("labels requests in the upcoming list", () => {
    expect(upcomingStateKey({ status: "requested" })).toBe("requested");
    expect(upcomingStateKey({ status: "booked", awaiting_confirmation: false })).toBe("confirmed");
  });
  it("labels declined / withdrawn changes", () => {
    expect(changeLabel({ change: "declined", reason: " full ", previous_starts_at: null })).toEqual({ key: "declinedReason", reason: "full" });
    expect(changeLabel({ change: "declined", reason: null, previous_starts_at: null })).toEqual({ key: "declined" });
    expect(changeLabel({ change: "withdrawn", reason: null, previous_starts_at: null })).toEqual({ key: "withdrawn" });
  });
  it("sorts requests by session start, then by request time", () => {
    const rows = sortRequests([
      { starts_at: "2026-12-06T09:00:00Z", requested_at: "2026-12-01T00:00:00Z", id: "c" },
      { starts_at: "2026-12-05T09:00:00Z", requested_at: "2026-12-02T00:00:00Z", id: "b" },
      { starts_at: "2026-12-05T09:00:00Z", requested_at: "2026-12-01T00:00:00Z", id: "a" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("marks pending sessions and counts requests on the coach card", () => {
    const info = toBookedSessionInfo({
      session_id: "s1", event_id: "e1", service_id: "svc", service_name: "Private", kind: "private", starts_at: "2026-12-05T09:00:00Z",
      ends_at: "2026-12-05T10:00:00Z", status: "scheduled", rescheduled_from: null, location: null, venue_space: null, capacity: 1,
      participants_count: 1, sheet_status: null, pending: true,
      participants: [{ athlete_id: "a1", first_name: "Nova", last_name: "Synth", booking_status: "requested" }],
    });
    expect(info.pending).toBe(true);
    expect(info.requestsCount).toBe(1);
  });
});

describe("family request form", () => {
  const svc: FamilyCatalogService = {
    id: "00000000-0000-4000-8000-0000000000c1", name: "Private", kind: "private", duration_min: 60, price: 80, currency: "CHF", max_participants: 1,
    venue_name: null, coaches: [{ id: "00000000-0000-4000-8000-0000000000a1", display_name: "Coach" }], package_remaining: 2, sessions: [],
  };
  it("a service with one coach preselects it; a change resets the session and code", () => {
    const f = withFamilyService(emptyFamilyRequest({ sessionId: "x", promoCode: "BR10" }), svc);
    expect(f.coachId).toBe(svc.coaches[0].id);
    expect(f.sessionId).toBe("");
    expect(f.promoCode).toBe("");
    expect(withFamilyService(f, null).serviceId).toBe("");
  });
  it("builds the payload (wall time in the club zone) and validates it", () => {
    const f = { ...emptyFamilyRequest({ athleteId: "00000000-0000-4000-8000-000000000071", serviceId: svc.id, date: "2026-12-05", time: "10:00" }) };
    const p = familyFormToPayload(f, TZ)!;
    expect(p.startsAt).toBe("2026-12-05T09:00:00.000Z");
    expect(p.coachId).toBeNull();
    expect(familyRequestSchema.safeParse(p).success).toBe(true);
    expect(familyFormToPayload({ ...f, time: "" }, TZ)).toBeNull();
    const join = familyFormToPayload({ ...f, sessionId: "00000000-0000-4000-8000-0000000000e1", time: "" }, TZ)!;
    expect(join.sessionId).toBe("00000000-0000-4000-8000-0000000000e1");
    expect(join.startsAt).toBeUndefined();
  });
  it("the schema never carries a payer, price or override", () => {
    const parsed = familyRequestSchema.parse({ athleteId: "00000000-0000-4000-8000-000000000071", serviceId: svc.id, startsAt: "2026-12-05T09:00:00Z",
      payerId: "00000000-0000-4000-8000-0000000000ff", price: 1, overrideAvailability: true } as never);
    expect(Object.keys(parsed)).not.toContain("payerId");
    expect(Object.keys(parsed)).not.toContain("price");
    expect(Object.keys(parsed)).not.toContain("overrideAvailability");
  });
  it("shows the coach's declared times of the day", () => {
    const times = declaredTimes({
      service: svc, coachId: "", date: "2026-12-05", timeZone: TZ, now: new Date("2026-12-01T00:00:00Z"),
      availability: {
        templates: [], blackouts: [], busy: [], venueHours: {}, stepMin: 60,
        windows: [{ coachId: svc.coaches[0].id, venueId: null, serviceId: null, startsAt: "2026-12-05T08:00:00Z", endsAt: "2026-12-05T11:00:00Z", capacity: 1 }],
      },
    });
    expect(times).toEqual(["09:00", "10:00", "11:00"]);
    expect(declaredTimes({ service: svc, coachId: "", date: "2026-12-05", timeZone: TZ, availability: null })).toEqual([]);
  });
  it("package coverage", () => {
    expect(packageLeft(svc)).toBe(2);
    expect(packageLeft(null)).toBe(0);
  });
});
