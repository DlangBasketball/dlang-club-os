import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BOOKER_STATUS_KEYS, completePath, consentErrorCode, consentState, intentDestination, joinHref, parseIntent, safeNext, safeSlug,
  whitelistBookerRow, CONSENT_HOLD_HOURS, MEMBERSHIP_REQUEST_PATH,
} from "@/lib/public-entry/shared";
import { hashConsentToken, isConsentToken, newConsentToken } from "@/lib/public-entry/token";
import { nextStep } from "@/lib/status/next-step";

describe("safeNext (return to the selected activity)", () => {
  it("keeps same-origin app paths with a query", () => {
    expect(safeNext("/parent/camps/0b0e4c5e-1111-4a4a-9a9a-000000000001")).toBe("/parent/camps/0b0e4c5e-1111-4a4a-9a9a-000000000001");
    expect(safeNext("/register/summer-camp?x=1")).toBe("/register/summer-camp?x=1");
  });
  it.each(["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/ space", "", "evil", "/x\u0000y", "/" + "a".repeat(600)])(
    "refuses %j", (v) => {
      expect(safeNext(v)).toBeNull();
    });
  it("refuses null / undefined", () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
  });
});

describe("entry intents and links", () => {
  it("parses intents with a safe default", () => {
    expect(parseIntent("join")).toBe("join");
    expect(parseIntent("training")).toBe("training");
    expect(parseIntent("admin")).toBe("camp");
    expect(parseIntent(null)).toBe("camp");
  });
  it("sends Join the club to the membership request (Workstream C)", () => {
    expect(intentDestination("join")).toBe(MEMBERSHIP_REQUEST_PATH);
    expect(intentDestination("training")).toBe("/parent/bookings/request");
    expect(intentDestination("camp")).toBe("/parent/camps");
  });
  it("builds /join and /join/complete links that keep only a safe next and slug", () => {
    expect(joinHref("camp", "/parent/camps/abc")).toBe("/join?intent=camp&next=%2Fparent%2Fcamps%2Fabc");
    expect(joinHref("join", "//evil.example")).toBe("/join?intent=join");
    expect(completePath("training", "/parent/bookings/request", "dlang")).toBe("/join/complete?intent=training&next=%2Fparent%2Fbookings%2Frequest&club=dlang");
    expect(completePath("camp", null, "../../x")).toBe("/join/complete?intent=camp");
  });
  it("accepts only slug-shaped club hints", () => {
    expect(safeSlug("fc-seeblick")).toBe("fc-seeblick");
    expect(safeSlug("FC")).toBeNull();
    expect(safeSlug("a b")).toBeNull();
  });
});

describe("consent token", () => {
  it("is 32 random bytes in base64url; only the sha-256 hex digest is stored", () => {
    const a = newConsentToken();
    const b = newConsentToken();
    expect(a.token).not.toBe(b.token);
    expect(isConsentToken(a.token)).toBe(true);
    expect(Buffer.from(a.token, "base64url")).toHaveLength(32);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashConsentToken(a.token));
    expect(a.hash).not.toContain(a.token);
  });
  it("rejects malformed tokens before hashing", () => {
    expect(isConsentToken("short")).toBe(false);
    expect(isConsentToken("a".repeat(43) + "/")).toBe(false);
  });
  it("matches the database hash (sha256 of the UTF-8 token, hex)", () => {
    expect(hashConsentToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("holds the place 72 hours", () => {
    expect(CONSENT_HOLD_HOURS).toBe(72);
  });
});

describe("booker view", () => {
  it("maps item consent to the next-step consent state", () => {
    expect(consentState("awaiting")).toBe("pending");
    expect(consentState("accepted")).toBe("granted");
    expect(consentState("declined")).toBe("declined");
    expect(consentState("expired")).toBe("expired");
    expect(consentState("revoked")).toBeNull();
  });
  it("shows the C next-step labels in precedence order", () => {
    expect(nextStep({ status: "pending", consent: consentState("awaiting") })).toBe("awaiting_guardian_consent");
    expect(nextStep({ status: "pending_approval", campApproval: "pending", consent: consentState("accepted") })).toBe("pending_camp_approval");
    expect(nextStep({ status: "pending", consent: consentState("accepted"), balance: 300 })).toBe("awaiting_payment");
    expect(nextStep({ status: "confirmed", consent: consentState("accepted"), balance: 0 })).toBe("confirmed");
    expect(nextStep({ status: "requested", consent: consentState("accepted") })).toBe("awaiting_confirmation");
    expect(nextStep({ status: "cancelled", consent: consentState("declined") })).toBe("declined");
    expect(nextStep({ status: "cancelled", consent: consentState("expired") })).toBe("cancelled");
  });
  it("whitelists the status row (no DOB, medical, family, athlete id)", () => {
    const row = whitelistBookerRow({
      consent_request_id: "r", kind: "camp", item_id: "i", participant_name: "Synthetic Kid", activity: "Camp", status: "pending",
      dob: "2015-01-01", athlete_id: "a", family_id: "f", medical: "x",
    });
    expect(Object.keys(row).sort()).toEqual([...BOOKER_STATUS_KEYS].filter((k) => k !== "sort").sort());
    expect(row).not.toHaveProperty("dob");
    expect(row).not.toHaveProperty("athlete_id");
  });
  it("reads consent error codes from database messages", () => {
    expect(consentErrorCode("EMAIL_MISMATCH")).toBe("EMAIL_MISMATCH");
    expect(consentErrorCode('new row violates ... "CONSENT_PENDING"')).toBe("CONSENT_PENDING");
    expect(consentErrorCode("something else")).toBeNull();
  });
});
