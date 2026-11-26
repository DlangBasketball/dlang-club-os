import { describe, expect, it } from "vitest";
import { NEXT_STEPS, isConfirmedStep, nextStep, nextStepKey, nextStepTone } from "@/lib/status/next-step";
import en from "@/messages/en.json";

describe("nextStep precedence", () => {
  it("guardian consent comes before every approval and payment", () => {
    expect(nextStep({ consent: "pending", clubApproval: "pending", campApproval: "pending", balance: 100, status: "pending" }))
      .toBe("awaiting_guardian_consent");
  });
  it("club approval comes before camp approval and payment", () => {
    expect(nextStep({ clubApproval: "pending", campApproval: "pending", balance: 100 })).toBe("pending_club_approval");
    expect(nextStep({ clubApproval: "info_requested", balance: 100 })).toBe("information_requested");
    expect(nextStep({ status: "info_requested" })).toBe("information_requested");
  });
  it("camp approval comes before payment", () => {
    expect(nextStep({ campApproval: "pending", balance: 300, status: "pending_approval" })).toBe("pending_camp_approval");
    expect(nextStep({ status: "pending_approval" })).toBe("pending_camp_approval");
  });
  it("an open balance is awaiting payment, then confirmed once paid", () => {
    expect(nextStep({ clubApproval: "approved", status: "pending", balance: 120 })).toBe("awaiting_payment");
    expect(nextStep({ clubApproval: "approved", status: "confirmed", balance: 0 })).toBe("confirmed");
    expect(nextStep({ status: "pending_payment" })).toBe("awaiting_payment");
    expect(nextStep({ status: "active" })).toBe("confirmed");
  });
  it("granted consent and approved steps fall through to the next one", () => {
    expect(nextStep({ consent: "granted", clubApproval: "approved", campApproval: "approved", status: "confirmed" })).toBe("confirmed");
    expect(nextStep({ consent: "granted", status: "pending", balance: 50 })).toBe("awaiting_payment");
  });
  it("declines win over everything, then cancellations", () => {
    expect(nextStep({ clubApproval: "declined", consent: "pending", balance: 10 })).toBe("declined");
    expect(nextStep({ campApproval: "declined" })).toBe("declined");
    expect(nextStep({ consent: "declined", clubApproval: "approved" })).toBe("declined");
    expect(nextStep({ status: "declined" })).toBe("declined");
    expect(nextStep({ clubApproval: "withdrawn" })).toBe("cancelled");
    expect(nextStep({ consent: "expired", balance: 30 })).toBe("cancelled");
    expect(nextStep({ status: "cancelled", balance: 30 })).toBe("cancelled");
  });
  it("booking requests and waitlists", () => {
    expect(nextStep({ status: "requested", balance: 80 })).toBe("awaiting_confirmation");
    expect(nextStep({ status: "booked", balance: 80 })).toBe("awaiting_payment");
    expect(nextStep({ status: "booked" })).toBe("confirmed");
    expect(nextStep({ status: "waitlist" })).toBe("waitlisted");
  });
  it("a pending registration without an invoice waits for the club; with a settled invoice it is confirmed", () => {
    expect(nextStep({ status: "pending" })).toBe("awaiting_confirmation");
    expect(nextStep({ status: "pending", balance: 0 })).toBe("confirmed");
  });
  it("changes as soon as one source step changes (derived, nothing stored)", () => {
    const rec = { clubApproval: "pending" as const, status: null as string | null, balance: null as number | null };
    expect(nextStep(rec)).toBe("pending_club_approval");
    const approved = { ...rec, clubApproval: "approved" as const, status: "pending", balance: 120 };
    expect(nextStep(approved)).toBe("awaiting_payment");
    expect(nextStep({ ...approved, status: "confirmed", balance: 0 })).toBe("confirmed");
  });
});

describe("nextStep helpers", () => {
  it("tones and keys", () => {
    expect(nextStepTone("confirmed")).toBe("success");
    expect(nextStepTone("declined")).toBe("danger");
    expect(nextStepTone("awaiting_payment")).toBe("warning");
    expect(nextStepTone("pending_club_approval")).toBe("info");
    expect(nextStepKey("awaiting_payment")).toBe("nextStep.awaiting_payment");
    expect(isConfirmedStep("confirmed")).toBe(true);
    expect(isConfirmedStep("awaiting_payment")).toBe(false);
  });
  it("every step has an English label", () => {
    const cat = (en as unknown as { nextStep: Record<string, string> }).nextStep;
    for (const s of NEXT_STEPS) expect(typeof cat[s]).toBe("string");
  });
});
