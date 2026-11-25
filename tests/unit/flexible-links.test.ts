import { describe, expect, it } from "vitest";
import {
  childLinkPermissionsSchema, childLinkToRpc, DEFAULT_CHILD_LINK, initialMode, needsGuardianConsent, normaliseChildLink,
  participantErrorCode, participantMode, pickerModes, type ParticipantOption, type SelfState,
} from "@/lib/participants/validation";
import { canSeeFlag, decidedInPanel, flagGroup, flagHref, isInformationalFlag } from "@/lib/attendance/review-flags";
import { CONSENT_ERROR_CODES } from "@/lib/public-entry/shared";

// Flexible link access, manual registrations (migration 20250420106300). Synthetic data only.
const self: SelfState = { athleteId: null, dob: "1985-01-01", firstName: "Synthetic", lastName: "Adult" };

describe("per-child link permissions", () => {
  it("defaults for 'This child only': book + pay + e-mails, no medical, no profile edits", () => {
    expect(DEFAULT_CHILD_LINK).toEqual({
      relation: "other_carer", canRegister: true, canPay: true, canSeeMedical: false, receivesEmails: true, canEditProfile: false,
    });
    expect(childLinkPermissionsSchema.parse({})).toEqual(DEFAULT_CHILD_LINK);
  });
  it("booking requires payment (the linker is invoiced, never the family)", () => {
    expect(childLinkPermissionsSchema.safeParse({ ...DEFAULT_CHILD_LINK, canPay: false }).success).toBe(false);
    expect(childLinkPermissionsSchema.safeParse({ ...DEFAULT_CHILD_LINK, canRegister: false, canPay: false }).success).toBe(true);
    expect(normaliseChildLink({ ...DEFAULT_CHILD_LINK, canRegister: false, canPay: false, }, "canPay")).toMatchObject({ canRegister: false });
    expect(normaliseChildLink({ ...DEFAULT_CHILD_LINK, canPay: false }, "canPay")).toMatchObject({ canRegister: false, canPay: false });
    expect(normaliseChildLink({ ...DEFAULT_CHILD_LINK, canRegister: true, canPay: false }, "canRegister")).toMatchObject({ canRegister: true, canPay: true });
  });
  it("rejects unknown relations and maps to the RPC payload", () => {
    expect(childLinkPermissionsSchema.safeParse({ relation: "mother" }).success).toBe(false);
    expect(childLinkToRpc({ ...DEFAULT_CHILD_LINK, relation: "aunt_uncle", canSeeMedical: true })).toEqual({
      relation: "aunt_uncle", can_register: true, can_pay: true, can_see_medical: true, receives_emails: true, can_edit_profile: false,
    });
  });
  it("knows the new error codes", () => {
    expect(participantErrorCode("ERROR: REGISTER_NEEDS_PAY")).toBe("REGISTER_NEEDS_PAY");
    expect(participantErrorCode("INVALID_SCOPE")).toBe("INVALID_SCOPE");
    expect(participantErrorCode("LINK_NOT_ACTIVE")).toBe("LINK_NOT_ACTIVE");
    expect(CONSENT_ERROR_CODES).toContain("NO_GUARDIAN_CONTACT");
  });
});

describe("picker: 'A child I'm linked to'", () => {
  const linked: ParticipantOption = { id: "l1", name: "Synthetic Linked", dob: "2015-01-01", kind: "linked", relation: "aunt_uncle" };
  it("offers the linked mode only where third-party booking is supported", () => {
    expect(pickerModes({ allowSelf: true, allowOther: true, self, on: "2026-07-01", hasLinked: true })).toEqual(["self", "child", "linked", "other"]);
    expect(pickerModes({ allowSelf: true, allowOther: false, self, on: "2026-07-01", hasLinked: true })).toEqual(["self", "child"]);
    expect(pickerModes({ allowSelf: false, allowOther: true, self, on: "2026-07-01" })).toEqual(["child", "other"]);
  });
  it("starts on the linked mode when a linked child is selected", () => {
    expect(initialMode(["l1"], [linked], ["child", "linked", "other"])).toBe("linked");
    expect(participantMode(linked)).toBe("linked");
    expect(needsGuardianConsent(linked)).toBe(true);
    expect(needsGuardianConsent({ kind: "child" })).toBe(false);
  });
});

describe("NO_GUARDIAN_LOGIN suggestion", () => {
  it("is an informational people flag for admins only, opened on the athlete page", () => {
    expect(isInformationalFlag("NO_GUARDIAN_LOGIN")).toBe(true);
    expect(isInformationalFlag("ATHLETE_WITHOUT_GUARDIAN")).toBe(false);
    expect(flagGroup("NO_GUARDIAN_LOGIN")).toBe("people");
    expect(canSeeFlag("NO_GUARDIAN_LOGIN", { admin: false, finance: true })).toBe(false);
    expect(canSeeFlag("NO_GUARDIAN_LOGIN", { admin: true, finance: false })).toBe(true);
    expect(decidedInPanel("NO_GUARDIAN_LOGIN")).toBe(false);
    expect(flagHref({ entityTable: "athletes", entityId: "00000000-0000-0000-0000-000000000001", reasonCode: "NO_GUARDIAN_LOGIN", details: {} }))
      .toBe("/admin/athletes/00000000-0000-0000-0000-000000000001");
  });
});
