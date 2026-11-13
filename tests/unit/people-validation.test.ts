import { describe, expect, it } from "vitest";
import {
  athleteSchema,
  familySchema,
  guardianLinkSchema,
  registrationEditSchema,
  documentMetaSchema,
  consentRecordSchema,
  consentWithdrawSchema,
  scopeColumns,
  normaliseOption,
  GENDERS,
  photoObjectPath,
  isPhotoPathFor,
  checkPhotoFile,
  sniffImageType,
  fitWithin,
  isAllowedPhotoType,
  firstIssueKey,
  PHOTO_MAX_BYTES,
} from "@/lib/people/validation";

// Synthetic ids only.
const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ATH = "00000000-0000-4000-8000-0000000000a1";
const FAM = "00000000-0000-4000-8000-0000000000f1";

describe("athleteSchema", () => {
  const base = { familyId: FAM, firstName: " Test ", lastName: "Player", dob: "2015-04-01" };

  it("accepts a minimal athlete and normalises blanks to null", () => {
    const r = athleteSchema.parse({ ...base, school: "  ", gender: "", notes: "" });
    expect(r.firstName).toBe("Test");
    expect(r.school).toBeNull();
    expect(r.gender).toBeNull();
    expect(r.notes).toBeNull();
    expect(r.status).toBe("active");
  });

  it("rejects missing names, bad dates and future birthdays with i18n keys", () => {
    const missing = athleteSchema.safeParse({ ...base, firstName: " " });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(firstIssueKey(missing.error)).toBe("editPeople.errors.required");

    const bad = athleteSchema.safeParse({ ...base, dob: "01.04.2015" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(firstIssueKey(bad.error)).toBe("editPeople.errors.invalidDate");

    const future = athleteSchema.safeParse({ ...base, dob: "2999-01-01" });
    expect(future.success).toBe(false);
    if (!future.success) expect(firstIssueKey(future.error)).toBe("editPeople.errors.futureDate");
  });

  it("only allows known option values and statuses", () => {
    expect(athleteSchema.safeParse({ ...base, gender: "robot" }).success).toBe(false);
    expect(athleteSchema.safeParse({ ...base, status: "deleted" }).success).toBe(false);
    expect(athleteSchema.parse({ ...base, status: "inactive", dominantHand: "left" }).dominantHand).toBe("left");
  });

  it("requires a uuid family (the action re-checks it belongs to the org)", () => {
    expect(athleteSchema.safeParse({ ...base, familyId: "1; drop table" }).success).toBe(false);
  });
});

describe("normaliseOption", () => {
  it("maps legacy capitalised values to option keys", () => {
    expect(normaliseOption("Male", GENDERS)).toBe("male");
    expect(normaliseOption(" female ", GENDERS)).toBe("female");
    expect(normaliseOption("unknown", GENDERS)).toBe("");
    expect(normaliseOption(null, GENDERS)).toBe("");
  });
});

describe("familySchema / guardianLinkSchema", () => {
  it("lower-cases the billing email and rejects invalid ones", () => {
    expect(familySchema.parse({ name: "Test family", contactEmail: "Billing@Example.com" }).contactEmail).toBe("billing@example.com");
    const bad = familySchema.safeParse({ name: "Test family", contactEmail: "not-an-email" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(firstIssueKey(bad.error)).toBe("editPeople.errors.invalidEmail");
    expect(familySchema.parse({ name: "Test family", contactEmail: "" }).contactEmail).toBeNull();
  });

  it("validates guardian links", () => {
    expect(guardianLinkSchema.parse({ familyId: FAM, email: "Parent@Example.com" })).toMatchObject({ email: "parent@example.com", relation: "guardian", isPrimary: false });
    expect(guardianLinkSchema.safeParse({ familyId: FAM, email: "x", relation: "mother" }).success).toBe(false);
    expect(guardianLinkSchema.safeParse({ familyId: FAM, email: "a@example.com", relation: "boss" }).success).toBe(false);
  });
});

describe("registrationEditSchema", () => {
  const base = { programId: ATH, status: "confirmed" as const };
  it("needs a reason to cancel", () => {
    const r = registrationEditSchema.safeParse({ ...base, status: "cancelled" });
    expect(r.success).toBe(false);
    if (!r.success) expect(firstIssueKey(r.error)).toBe("editPeople.errors.reasonRequired");
    expect(registrationEditSchema.safeParse({ ...base, status: "cancelled", cancellationReason: "Moved away" }).success).toBe(true);
  });
  it("rejects unknown statuses", () => {
    expect(registrationEditSchema.safeParse({ ...base, status: "deleted" }).success).toBe(false);
  });
});

describe("documentMetaSchema + scopeColumns", () => {
  it("requires a target for scoped documents only", () => {
    expect(documentMetaSchema.safeParse({ kind: "other", scope: "global" }).success).toBe(true);
    expect(documentMetaSchema.safeParse({ kind: "other", scope: "athlete" }).success).toBe(false);
    expect(documentMetaSchema.safeParse({ kind: "other", scope: "athlete", targetId: ATH }).success).toBe(true);
    expect(documentMetaSchema.safeParse({ kind: "secret", scope: "global" }).success).toBe(false);
    expect(documentMetaSchema.safeParse({ kind: "other", scope: "global", expiresAt: "31/12/2027" }).success).toBe(false);
    expect(documentMetaSchema.parse({ kind: "other", scope: "global", expiresAt: "" }).expiresAt).toBeNull();
  });
  it("maps a scope to exactly one target column", () => {
    expect(scopeColumns("athlete", ATH)).toEqual({ athlete_id: ATH, family_id: null, program_id: null });
    expect(scopeColumns("global", ATH)).toEqual({ athlete_id: null, family_id: null, program_id: null });
  });
});

describe("consent schemas", () => {
  const base = { athleteId: ATH, consentFormId: FAM, source: "paper" as const, signedOn: "2026-09-01", signerName: "Test Signer" };
  it("accepts a paper consent and rejects future signing dates", () => {
    expect(consentRecordSchema.parse(base).guardianId).toBeNull();
    expect(consentRecordSchema.safeParse({ ...base, signedOn: "2999-01-01" }).success).toBe(false);
    expect(consentRecordSchema.safeParse({ ...base, source: "online" }).success).toBe(false);
    expect(consentRecordSchema.safeParse({ ...base, signerName: "" }).success).toBe(false);
    expect(consentRecordSchema.safeParse({ ...base, guardianId: "nope" }).success).toBe(false);
  });
  it("requires a withdrawal reason", () => {
    expect(consentWithdrawSchema.safeParse({ acceptanceId: ATH, reason: "  " }).success).toBe(false);
    expect(consentWithdrawSchema.safeParse({ acceptanceId: ATH, reason: "Parent letter" }).success).toBe(true);
  });
});

describe("athlete photo helpers", () => {
  it("builds org/athlete scoped object keys", () => {
    expect(photoObjectPath(ORG, ATH, "image/webp", "abc-123")).toBe(`${ORG}/${ATH}/abc-123.webp`);
    expect(photoObjectPath(ORG, ATH, "image/jpeg", "../../etc")).toBe(`${ORG}/${ATH}/etc.jpg`);
    expect(() => photoObjectPath("not-a-uuid", ATH, "image/png", "x")).toThrow();
  });

  it("recognises only keys of the same org and athlete", () => {
    expect(isPhotoPathFor(`${ORG}/${ATH}/a.jpg`, ORG, ATH)).toBe(true);
    expect(isPhotoPathFor(`${OTHER_ORG}/${ATH}/a.jpg`, ORG, ATH)).toBe(false);
    expect(isPhotoPathFor(`${ORG}/${FAM}/a.jpg`, ORG, ATH)).toBe(false);
    expect(isPhotoPathFor(`${ORG}/${ATH}/x/a.jpg`, ORG, ATH)).toBe(false);
    expect(isPhotoPathFor(null, ORG, ATH)).toBe(false);
  });

  it("checks type and size", () => {
    expect(isAllowedPhotoType("image/webp")).toBe(true);
    expect(isAllowedPhotoType("image/gif")).toBe(false);
    expect(checkPhotoFile(null)).toBe("athletePhoto.errors.noFile");
    expect(checkPhotoFile({ size: 10, type: "image/svg+xml" })).toBe("athletePhoto.errors.type");
    expect(checkPhotoFile({ size: PHOTO_MAX_BYTES + 1, type: "image/jpeg" })).toBe("athletePhoto.errors.size");
    expect(checkPhotoFile({ size: 1000, type: "image/jpeg" })).toBeNull();
  });

  it("sniffs image signatures", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns="))).toBeNull();
  });

  it("fits within the max dimension without upscaling", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1200, 2400)).toEqual({ width: 400, height: 800 });
    expect(fitWithin(500, 300)).toEqual({ width: 500, height: 300 });
    expect(fitWithin(0, 300)).toEqual({ width: 0, height: 0 });
  });
});
