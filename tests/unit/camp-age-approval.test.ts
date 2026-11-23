import { describe, expect, it } from "vitest";
import {
  approvalBand, bandMessage, campAgeBand, campAgeOnStart, campEditionCounters, campRegistrationState, campStateTone,
  classifyCamper, validateApprovalBand, type CampAgeRules,
} from "@/lib/camps/age-approval";

// Same cases as tests/db/camp_age_approval.sql (section 1).
const START = "2027-07-05";
const RULES: CampAgeRules = { minAge: 8, maxAge: 14, approvalAgeMin: 6, approvalAgeMax: 7 };

describe("campAgeOnStart (mirror of public.camp_age_on_start)", () => {
  it("counts whole years on the first camp day", () => {
    expect(campAgeOnStart("2021-05-05", START)).toBe(6);
    expect(campAgeOnStart("2020-02-05", START)).toBe(7);
    expect(campAgeOnStart("2022-04-05", START)).toBe(5);
  });
  it("8th birthday exactly on day 1 -> 8; the day after day 1 -> 7", () => {
    expect(campAgeOnStart("2019-07-05", START)).toBe(8);
    expect(campAgeOnStart("2019-07-06", START)).toBe(7);
  });
  it("29 February birthday counts from 1 March", () => {
    expect(campAgeOnStart("2020-02-29", "2027-02-28")).toBe(6);
    expect(campAgeOnStart("2020-02-29", "2027-03-01")).toBe(7);
  });
  it("unknown date of birth or start -> null", () => {
    expect(campAgeOnStart(null, START)).toBeNull();
    expect(campAgeOnStart("2019-07-05", null)).toBeNull();
    expect(campAgeOnStart("bad", START)).toBeNull();
  });
});

describe("campAgeBand (mirror of public.camp_age_band)", () => {
  it("classifies standard / approval / too_young / too_old", () => {
    expect(campAgeBand(8, RULES)).toBe("standard");
    expect(campAgeBand(14, RULES)).toBe("standard");
    expect(campAgeBand(7, RULES)).toBe("approval");
    expect(campAgeBand(6, RULES)).toBe("approval");
    expect(campAgeBand(5, RULES)).toBe("too_young");
    expect(campAgeBand(15, RULES)).toBe("too_old");
    expect(campAgeBand(null, RULES)).toBe("standard");
  });
  it("without a band, younger children are too young; without a minimum, everyone is standard", () => {
    expect(campAgeBand(7, { ...RULES, approvalAgeMin: null, approvalAgeMax: null })).toBe("too_young");
    expect(campAgeBand(7, { minAge: null, maxAge: null, approvalAgeMin: 6, approvalAgeMax: 7 })).toBe("standard");
  });
  it("classifyCamper: age on the first day, then the band", () => {
    expect(classifyCamper("2019-07-05", START, RULES)).toEqual({ age: 8, band: "standard" });
    expect(classifyCamper("2020-02-05", START, RULES)).toEqual({ age: 7, band: "approval" });
    expect(classifyCamper("2022-04-05", START, RULES)).toEqual({ age: 5, band: "too_young" });
  });
});

describe("band settings and parent copy", () => {
  it("approvalBand is off unless both ages are set", () => {
    expect(approvalBand(RULES)).toEqual({ min: 6, max: 7 });
    expect(approvalBand({ approvalAgeMin: null, approvalAgeMax: 7 })).toBeNull();
  });
  it("validates the admin input", () => {
    expect(validateApprovalBand(null, null, 8)).toBeNull();
    expect(validateApprovalBand(6, 7, 8)).toBeNull();
    expect(validateApprovalBand(6, null, 8)).toBe("camps.approval.errors.bothRequired");
    expect(validateApprovalBand(7, 6, 8)).toBe("camps.approval.errors.order");
    expect(validateApprovalBand(6, 8, 8)).toBe("camps.approval.errors.belowMinAge");
    expect(validateApprovalBand(6, 7, null)).toBe("camps.approval.errors.needsMinAge");
    expect(validateApprovalBand(-1, 7, 8)).toBe("camps.approval.errors.range");
  });
  it("message ages come from the band", () => {
    expect(bandMessage({ min: 6, max: 7 })).toEqual({ key: "camps.approval.parent.intro", values: { min: 6, max: 7 } });
    expect(bandMessage({ min: 7, max: 7 })).toEqual({ key: "camps.approval.parent.introOne", values: { min: 7 } });
    expect(bandMessage({ min: 5, max: 7 })).toEqual({ key: "camps.approval.parent.introRange", values: { min: 5, max: 7 } });
  });
});

describe("registration state + counters", () => {
  it("maps the workflow states", () => {
    expect(campRegistrationState({ status: "pending_approval", approvalStatus: "pending" })).toBe("pending_approval");
    expect(campRegistrationState({ status: "pending", approvalStatus: "approved" })).toBe("approved_awaiting_payment");
    expect(campRegistrationState({ status: "confirmed", approvalStatus: "approved" })).toBe("confirmed");
    expect(campRegistrationState({ status: "cancelled", approvalStatus: "declined" })).toBe("declined");
    expect(campRegistrationState({ status: "cancelled", approvalStatus: "withdrawn" })).toBe("withdrawn");
    expect(campRegistrationState({ status: "pending", approvalStatus: null })).toBe("pending");
    expect(campStateTone("pending_approval")).toBe("info");
    expect(campStateTone("approved_awaiting_payment")).toBe("warning");
    expect(campStateTone("declined")).toBe("danger");
  });
  it("counts requests and payment holds apart from confirmed places", () => {
    const c = campEditionCounters([
      { status: "confirmed", approvalStatus: null },
      { status: "confirmed", approvalStatus: "approved" },
      { status: "pending", approvalStatus: null },
      { status: "pending", approvalStatus: "approved" },
      { status: "pending_approval", approvalStatus: "pending" },
      { status: "pending_approval", approvalStatus: "pending" },
      { status: "cancelled", approvalStatus: "declined" },
    ]);
    expect(c).toEqual({ confirmed: 2, awaitingPayment: 1, approvedAwaitingPayment: 1, pendingApproval: 2, holdingPlaces: 4 });
  });
});
