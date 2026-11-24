import { describe, expect, it } from "vitest";
import {
  ageOn, initialMode, isAdultOn, linkRequestSchema, mergeParticipants, participantCreateSchema, participantErrorCode,
  participantUpdateSchema, pickerModes, selectParticipant, selfProfileSchema, sportsSchema, sportsToRpc, thirdPartySchema,
  type ParticipantOption, type SelfState,
} from "@/lib/participants/validation";
import { canSeeFlag, decidedInPanel, flagGroup, flagHref } from "@/lib/attendance/review-flags";

const kid = (id: string, kind: ParticipantOption["kind"] = "child", dob: string | null = "2015-01-01"): ParticipantOption => ({ id, name: id, dob, kind });

describe("ages", () => {
  it("counts whole years like Postgres age()", () => {
    expect(ageOn("2008-06-15", "2026-06-14")).toBe(17);
    expect(ageOn("2008-06-15", "2026-06-15")).toBe(18);
    expect(ageOn("2008-02-29", "2026-02-28")).toBe(17);
    expect(ageOn("2008-02-29", "2026-03-01")).toBe(18);
    expect(ageOn(null, "2026-01-01")).toBeNull();
    expect(ageOn("2026-13-01", "2026-01-01")).toBeNull();
  });
  it("Myself requires 18+ on the activity date", () => {
    expect(isAdultOn("2008-06-15", "2026-06-15")).toBe(true);
    expect(isAdultOn("2008-06-15", "2026-06-14")).toBe(false);
    expect(isAdultOn(null, "2026-06-14")).toBe(false);
  });
});

describe("participantCreateSchema", () => {
  const base = { firstName: " Ana ", lastName: "Silva", dob: "2016-04-02", sex: "female" as const };
  it("accepts a child with optional sports fields", () => {
    const r = participantCreateSchema.parse({ ...base, heightCm: "128,5", preferredJerseyNumber: "7", positionPref: "" });
    expect(r.firstName).toBe("Ana");
    expect(r.heightCm).toBe(128.5);
    expect(r.preferredJerseyNumber).toBe(7);
    expect(r.positionPref).toBeNull();
    expect(r.weightKg).toBeNull();
  });
  it("requires a DOB and male / female", () => {
    expect(participantCreateSchema.safeParse({ ...base, dob: "" }).error?.issues[0].message).toBe("participants.errors.DOB_REQUIRED");
    expect(participantCreateSchema.safeParse({ ...base, sex: "other" }).success).toBe(false);
  });
  it("refuses a future DOB and out-of-range numbers", () => {
    expect(participantCreateSchema.safeParse({ ...base, dob: "2999-01-01" }).success).toBe(false);
    expect(participantCreateSchema.safeParse({ ...base, heightCm: "20" }).error?.issues[0].message).toBe("participants.errors.INVALID_HEIGHT");
    expect(participantCreateSchema.safeParse({ ...base, weightKg: "abc" }).error?.issues[0].message).toBe("participants.errors.INVALID_WEIGHT");
    expect(participantCreateSchema.safeParse({ ...base, preferredJerseyNumber: "7.5" }).success).toBe(false);
    expect(participantCreateSchema.safeParse({ ...base, preferredJerseyNumber: "1000" }).success).toBe(false);
  });
  it("only accepts the 'different' decision", () => {
    expect(participantCreateSchema.safeParse({ ...base, decision: "different" }).success).toBe(true);
    expect(participantCreateSchema.safeParse({ ...base, decision: "merge" }).success).toBe(false);
  });
});

describe("update / self / link schemas", () => {
  it("keeps a stored legacy sex value readable (lower-cased)", () => {
    const r = participantUpdateSchema.parse({ firstName: "A", lastName: "B", dob: "2015-01-01", sex: "Other" });
    expect(r.sex).toBe("other");
  });
  it("self profile: sex optional, activity date validated", () => {
    expect(selfProfileSchema.parse({ firstName: "A", lastName: "B", dob: "1980-01-01" }).sex).toBeNull();
    expect(selfProfileSchema.safeParse({ firstName: "A", lastName: "B", dob: "1980-01-01", at: "2026-02-30" }).success).toBe(false);
  });
  it("link relation defaults to guardian", () => {
    expect(linkRequestSchema.parse({ firstName: "A", lastName: "B", dob: "2015-01-01" }).relation).toBe("guardian");
    expect(linkRequestSchema.safeParse({ firstName: "A", lastName: "B", dob: "2015-01-01", relation: "uncle" }).success).toBe(false);
  });
});

describe("thirdPartySchema (Someone else)", () => {
  const base = { firstName: "Léo", lastName: "Martin", dob: "2014-09-09", sex: "male" as const, guardianName: "Claire Martin", relation: "nephew_niece" as const };
  it("needs an e-mail or a phone for the participant's guardian", () => {
    expect(thirdPartySchema.safeParse(base).error?.issues[0].message).toBe("participants.errors.contactRequired");
    expect(thirdPartySchema.safeParse({ ...base, guardianPhone: "+41 79 000 00 00" }).success).toBe(true);
    expect(thirdPartySchema.safeParse({ ...base, guardianEmail: "claire@example.test" }).success).toBe(true);
    expect(thirdPartySchema.safeParse({ ...base, guardianEmail: "nope" }).success).toBe(false);
  });
});

describe("sports payload", () => {
  it("maps only the given keys to snake_case", () => {
    expect(sportsToRpc({ heightCm: 150 })).toEqual({ height_cm: 150 });
    const all = sportsSchema.parse({ heightCm: "", weightKg: "41.25", positionPref: "point_guard", jerseySize: "YL", preferredJerseyNumber: "0" });
    expect(sportsToRpc(all)).toEqual({ height_cm: null, weight_kg: 41.3, position_pref: "point_guard", jersey_size: "YL", preferred_jersey_number: 0 });
  });
});

describe("picker logic", () => {
  const self: SelfState = { athleteId: "s", dob: "1985-01-01", firstName: "A", lastName: "B" };
  it("offers Myself only to adults on the activity date", () => {
    expect(pickerModes({ allowSelf: true, allowOther: true, self, on: "2026-07-01" })).toEqual(["self", "child", "other"]);
    expect(pickerModes({ allowSelf: true, allowOther: false, self: { ...self, dob: "2010-01-01" }, on: "2026-07-01" })).toEqual(["child"]);
    // No self profile yet: offered (created on first use, DOB checked there).
    expect(pickerModes({ allowSelf: true, allowOther: true, self: { ...self, athleteId: null, dob: null }, on: "2026-07-01" })).toEqual(["self", "child", "other"]);
    expect(pickerModes({ allowSelf: false, allowOther: true, self, on: "2026-07-01" })).toEqual(["child", "other"]);
  });
  it("starts in the mode of the current selection", () => {
    const list = [kid("s", "self"), kid("a")];
    expect(initialMode(["s"], list, ["self", "child"])).toBe("self");
    expect(initialMode(["a"], list, ["self", "child"])).toBe("child");
    expect(initialMode([], list, ["self", "child"])).toBe("child");
  });
  it("merges created participants without duplicates and keeps order", () => {
    const merged = mergeParticipants([kid("a"), kid("b")], [kid("b"), kid("c"), kid("c")]);
    expect(merged.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
  it("selects one or toggles several", () => {
    expect(selectParticipant(["a"], "b", false)).toEqual(["b"]);
    expect(selectParticipant(["a"], "b", true)).toEqual(["a", "b"]);
    expect(selectParticipant(["a", "b"], "a", true)).toEqual(["b"]);
  });
});

describe("error codes", () => {
  it("finds the RPC code in a database message", () => {
    expect(participantErrorCode("REVIEW_REQUIRED")).toBe("REVIEW_REQUIRED");
    expect(participantErrorCode("ERROR: FAMILY_NOT_FOUND")).toBe("FAMILY_NOT_FOUND");
    expect(participantErrorCode("something else")).toBeNull();
  });
});

describe("data review flags (people group)", () => {
  it("groups participant codes as people, admin only, decided in the panel", () => {
    expect(flagGroup("ATHLETE_ELIGIBILITY_CHANGE")).toBe("people");
    expect(canSeeFlag("ATHLETE_LINK_REQUEST", { admin: false, finance: true })).toBe(false);
    expect(canSeeFlag("ATHLETE_LINK_REQUEST", { admin: true, finance: false })).toBe(true);
    expect(decidedInPanel("ATHLETE_LINK_REQUEST")).toBe(true);
    expect(decidedInPanel("POSSIBLE_DUPLICATE")).toBe(false);
  });
  it("links a request to the athlete page", () => {
    const athleteId = "00000000-0000-0000-0000-000000000071";
    expect(flagHref({ entityTable: "athlete_change_requests", entityId: "00000000-0000-0000-0000-0000000000aa", reasonCode: "ATHLETE_ELIGIBILITY_CHANGE", details: { athlete_id: athleteId } }))
      .toBe(`/admin/athletes/${athleteId}`);
    expect(flagHref({ entityTable: "athletes", entityId: athleteId, reasonCode: "POSSIBLE_DUPLICATE", details: {} })).toBe(`/admin/athletes/${athleteId}`);
  });
});
