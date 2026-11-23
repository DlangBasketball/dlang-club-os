import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import {
  BOOKING_ERROR_CODES, BOOKING_WARNING_CODES, BILLING_STATUSES, SETUP_MISSING_CODES, bookingErrorCode, bookingPayloadSchema,
  cancelPayloadSchema, payerSchema, quickCreateSchema, reschedulePayloadSchema, toBookingRpcPayload, toQuickCreateRpcPayload,
} from "@/lib/booking/types";
import {
  ageOn, bookingState, canCancel, canInvoice, formatSlot, isMinor, normName, policyRestoresPackage, quoteSummary, slotEnd,
} from "@/lib/booking/helpers";
import {
  buildMessage, outcomeStatus, portalPathFor, runBookingDispatch, templateFor,
  type BookingNotificationStore, type ClaimedBookingNotification,
} from "@/lib/booking/dispatch-core";
import { render } from "@/lib/notifications/templates";

const A = "00000000-0000-4000-8000-000000000001";
const S = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";

describe("normName (TS twin of SQL bk_norm)", () => {
  it("folds case, accents and punctuation like the database", () => {
    // Same expectations as tests/db (bk_norm): "Müller-José  Ñoño" -> "muller jose nono".
    expect(normName("  Müller-José  Ñoño ")).toBe("muller jose nono");
    expect(normName("O'Brien")).toBe("o brien");
    expect(normName("ÇÉLINE")).toBe("celine");
    expect(normName("Straße")).toBe("strase");
    expect(normName("")).toBeNull();
    expect(normName(null)).toBeNull();
  });
});

describe("minor rule", () => {
  it("counts whole years on the reference day", () => {
    expect(ageOn("2008-11-24", "2026-11-23")).toBe(17);
    expect(ageOn("2008-11-23", "2026-11-23")).toBe(18);
    expect(isMinor("2008-11-24", "2026-11-23")).toBe(true);
    expect(isMinor("2008-11-23", "2026-11-23")).toBe(false);
  });
});

describe("error codes", () => {
  it("finds the code inside a database message without prefix confusion", () => {
    expect(bookingErrorCode("COACH_BUSY")).toBe("COACH_BUSY");
    expect(bookingErrorCode("ERROR: SESSION_FULL")).toBe("SESSION_FULL");
    expect(bookingErrorCode("PRICE_OVERRIDE_REASON_REQUIRED")).toBe("PRICE_OVERRIDE_REASON_REQUIRED");
    expect(bookingErrorCode("COACH_NOT_ELIGIBLE_OVERRIDDEN")).toBeNull();
    expect(bookingErrorCode("something else")).toBeNull();
  });
  it("has en + fr translations for every code, warning, setup reason and billing status", () => {
    const bw = (en as unknown as { bookingWorkflow: Record<string, Record<string, string>> }).bookingWorkflow;
    const bwFr = (fr as unknown as { bookingWorkflow: Record<string, Record<string, string>> }).bookingWorkflow;
    for (const c of BOOKING_ERROR_CODES) { expect(bw.errors[c]).toBeTruthy(); expect(bwFr.errors[c]).toBeTruthy(); }
    for (const c of BOOKING_WARNING_CODES) expect(bw.warnings[c]).toBeTruthy();
    for (const c of SETUP_MISSING_CODES) expect(bw.setup[c]).toBeTruthy();
    for (const c of BILLING_STATUSES) expect(bw.billingStatus[c]).toBeTruthy();
  });
});

describe("payload schemas", () => {
  it("needs a session or a coach + start", () => {
    expect(bookingPayloadSchema.safeParse({ athleteId: A, serviceId: S }).success).toBe(false);
    expect(bookingPayloadSchema.safeParse({ athleteId: A, serviceId: S, sessionId: C }).success).toBe(true);
    expect(bookingPayloadSchema.safeParse({ athleteId: A, serviceId: S, coachId: C, startsAt: "2026-12-05T09:00:00Z" }).success).toBe(true);
    expect(bookingPayloadSchema.safeParse({ athleteId: A, serviceId: S, coachId: C, startsAt: "not a date" }).success).toBe(false);
  });
  it("maps to the RPC payload (UTC instant, no empty keys)", () => {
    const p = bookingPayloadSchema.parse({ athleteId: A, serviceId: S, coachId: C, startsAt: "2026-12-05T10:00:00+01:00", price: 60, priceReason: "x" });
    expect(toBookingRpcPayload(p)).toEqual({
      athlete_id: A, service_id: S, coach_id: C, starts_at: "2026-12-05T09:00:00.000Z", billing: "auto", price: 60, price_reason: "x", notify: true,
    });
  });
  it("reschedule needs a new slot or a session; cancel needs a reason", () => {
    expect(reschedulePayloadSchema.safeParse({ bookingId: A }).success).toBe(false);
    expect(reschedulePayloadSchema.safeParse({ bookingId: A, sessionId: S }).success).toBe(true);
    expect(cancelPayloadSchema.safeParse({ bookingId: A, reason: " " }).success).toBe(false);
    expect(cancelPayloadSchema.parse({ bookingId: A, reason: "Ill" }).refundMode).toBe("none");
  });
  it("payer and quick create", () => {
    expect(payerSchema.safeParse({ kind: "sponsor", name: "Synthetic AG", country: "ch", email: "" }).success).toBe(true);
    expect(payerSchema.parse({ kind: "sponsor", name: "Synthetic AG", country: "ch" }).country).toBe("CH");
    expect(payerSchema.safeParse({ kind: "nobody", name: "x" }).success).toBe(false);
    const q = quickCreateSchema.parse({ firstName: "Nova", lastName: "Synthetica", dob: "2015-02-02", newFamily: { contactName: "Synthetic Parent", contactEmail: "p@example.test" } });
    expect(toQuickCreateRpcPayload(q)).toEqual({
      first_name: "Nova", last_name: "Synthetica", dob: "2015-02-02",
      new_family: { contact_name: "Synthetic Parent", contact_email: "p@example.test" },
    });
    expect(quickCreateSchema.safeParse({ firstName: "Nova", lastName: "S" }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("states and actions", () => {
    expect(bookingState("booked")).toBe("confirmed");
    expect(bookingState("no_show")).toBe("no_show");
    expect(canCancel({ status: "booked" })).toBe(true);
    expect(canCancel({ status: "cancelled" })).toBe(false);
    expect(canInvoice({ billing_status: "to_invoice" })).toBe(true);
    expect(canInvoice({ billing_status: "invoiced" })).toBe(false);
  });
  it("quote summary: overridable errors and invoice blocked by setup", () => {
    const billing = { billing_mode: "invoice", setup_missing: ["NUMBER_SERIES_MISSING"] } as never;
    expect(quoteSummary({ errors: ["COACH_UNAVAILABLE"], warnings: [], billing })).toMatchObject({ canConfirm: false, needsOverride: true, invoiceBlocked: true });
    expect(quoteSummary({ errors: ["COACH_BUSY"], warnings: [], billing })).toMatchObject({ needsOverride: false });
    expect(quoteSummary({ errors: [], warnings: [{ code: "ATHLETE_OVERLAP" }], billing })).toMatchObject({ canConfirm: true, warnings: ["ATHLETE_OVERLAP"] });
  });
  it("package restore policy mirrors booking_cancel", () => {
    expect(policyRestoresPackage("2026-12-05T10:00:00Z", "2026-12-04T09:00:00Z", 24, true)).toBe(true);
    expect(policyRestoresPackage("2026-12-05T10:00:00Z", "2026-12-04T11:00:00Z", 24, true)).toBe(false);
    expect(policyRestoresPackage("2026-12-05T10:00:00Z", "2026-11-01T00:00:00Z", 24, false)).toBe(false);
  });
  it("slot end and label in the club time zone", () => {
    expect(slotEnd("2026-12-05T09:00:00.000Z", 45)).toBe("2026-12-05T09:45:00.000Z");
    const label = formatSlot("2026-12-05T09:00:00Z", "2026-12-05T10:00:00Z", "en-US", "Europe/Zurich");
    expect(label).toContain("10:00");
    expect(label).toContain("11:00");
  });
});

describe("notification dispatch core", () => {
  const row = (over: Partial<ClaimedBookingNotification> = {}): ClaimedBookingNotification => ({
    id: "n1", orgId: "o1", bookingId: "b1", kind: "confirmed", recipientKind: "guardian", recipientProfileId: "p1",
    recipientEmail: "g@example.test", recipientName: "Synthetic Guardian", attempts: 1, serviceName: "Private", coachName: "Coach",
    athleteFirstName: "Nova", startsAt: "2026-12-05T09:00:00Z", endsAt: "2026-12-05T10:00:00Z", previousStartsAt: null,
    locationName: null, timeZone: "Europe/Zurich", ...over,
  });

  it("templates, links and message content", () => {
    expect(templateFor("rescheduled")).toBe("booking_rescheduled");
    expect(portalPathFor("coach", true)).toBe("/coach");
    expect(portalPathFor("family", false)).toBeUndefined();
    const m = buildMessage(row({ kind: "rescheduled", previousStartsAt: "2026-12-04T09:00:00Z" }))!;
    expect(m.template).toBe("booking_rescheduled");
    expect(m.vars).toMatchObject({ athlete_name: "Nova", previous_starts_at: "2026-12-04T09:00:00Z", portal_path: "/parent/bookings", has_account: true });
    expect(JSON.stringify(m)).not.toMatch(/price|payer|invoice/i);
    expect(buildMessage(row({ recipientProfileId: null, recipientEmail: null }))).toBeNull();
    expect(buildMessage(row({ recipientKind: "family", recipientProfileId: null }))!.vars.portal_path).toBeUndefined();
  });

  it("outcome: in-app or accepted e-mail is sent, nothing delivered is failed", () => {
    expect(outcomeStatus({ notificationId: "x", emailLogId: "l", emailAttempted: true, emailOk: false, error: "resend-422" }))
      .toEqual({ status: "sent", error: "resend-422" });
    expect(outcomeStatus({ notificationId: null, emailLogId: "l", emailAttempted: true, emailOk: false, error: "resend-422" }).status).toBe("failed");
    expect(outcomeStatus({ notificationId: null, emailLogId: "l", emailAttempted: true, emailOk: true }).status).toBe("sent");
  });

  it("runs claim -> send -> record per recipient", async () => {
    const recorded: [string, string][] = [];
    const store: BookingNotificationStore = {
      claim: async () => [row({ id: "a" }), row({ id: "b", recipientProfileId: null, recipientEmail: null }), row({ id: "c", recipientProfileId: null })],
      record: async (id, status) => { recorded.push([id, status]); },
    };
    const sum = await runBookingDispatch(store, {
      send: async (msg) => msg.recipientProfileId
        ? { notificationId: "n", emailLogId: "l", emailAttempted: true, emailOk: true }
        : { notificationId: null, emailLogId: "l", emailAttempted: true, emailOk: false, error: "bounce" },
    });
    expect(recorded).toEqual([["a", "sent"], ["b", "no_contact"], ["c", "failed"]]);
    expect(sum).toEqual({ claimed: 3, sent: 1, failed: 1, noContact: 1 });
  });

  it("renders the reschedule notice with both times in the club time zone", () => {
    const r = render("booking_rescheduled", {
      athlete_name: "Nova", service_name: "Private", starts_at: "2026-12-05T09:00:00Z", previous_starts_at: "2026-12-04T09:00:00Z",
      portal_path: "/parent/bookings",
    }, { timeZone: "Europe/Zurich", locale: "en-US" });
    expect(r.subject).toContain("Private");
    expect(r.link).toBe("/parent/bookings");
    expect(r.html).toContain("Nova");
    const noAccount = render("booking_confirmation", { athlete_name: "Nova", service_name: "Private", starts_at: "2026-12-05T09:00:00Z", has_account: false });
    expect(noAccount.html).not.toContain("/parent/bookings");
  });
});
