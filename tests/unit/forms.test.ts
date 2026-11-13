import { describe, expect, it } from "vitest";
import { formDefinitionSchema, parseDefinition, type FieldDef, type FormDefinition } from "@/lib/forms/schema";
import {
  completionStatus, displayAnswer, hasUnpublishedChanges, isFieldVisible, nextVersion, summarise, validUntilFor, validateAnswers,
  versionForSubmission, visibleFieldIds,
} from "@/lib/forms/logic";
import { decodePngDataUrl, firstForwardedIp, formFilePath, hashIp, isFormFilePathFor } from "@/lib/forms/paths";
import { formsErrorKey } from "@/lib/forms/errors";

const f = (p: Partial<FieldDef> & Pick<FieldDef, "id" | "type">): FieldDef => ({
  label: p.id, help: "", required: false, options: [], showIf: null, safety: false, min: null, max: null, ...p,
});

const physical: FormDefinition = {
  sections: [
    {
      id: "s1", title: "Health", description: "",
      fields: [
        f({ id: "has_allergy", type: "yes_no", required: true }),
        f({ id: "allergy_details", type: "long_text", required: true, showIf: { field: "has_allergy", equals: "yes" }, safety: true }),
        f({ id: "epipen", type: "yes_no", required: true, showIf: { field: "allergy_details", equals: "peanuts" } }),
        f({ id: "sport", type: "single_choice", options: [{ value: "bb", label: "Basketball" }, { value: "fb", label: "Football" }] }),
        f({ id: "position", type: "text", showIf: { field: "sport", equals: "bb" } }),
        f({ id: "days", type: "multi_choice", options: [{ value: "mon", label: "Monday" }, { value: "wed", label: "Wednesday" }] }),
        f({ id: "weight", type: "number", min: 10, max: 150 }),
        f({ id: "checkup", type: "date" }),
        f({ id: "intro", type: "info" }),
      ],
    },
    {
      id: "s2", title: "Consent", description: "",
      fields: [
        f({ id: "agree", type: "consent", required: true }),
        f({ id: "sign", type: "signature", required: true }),
        f({ id: "doc", type: "file" }),
      ],
    },
  ],
};

describe("form definitions", () => {
  it("accepts a valid definition and rejects bad ones", () => {
    expect(formDefinitionSchema.safeParse(physical).success).toBe(true);
    const dupIds = { sections: [{ id: "s1", title: "", description: "", fields: [f({ id: "a", type: "text" }), f({ id: "a", type: "text" })] }] };
    expect(formDefinitionSchema.safeParse(dupIds).error?.issues[0].message).toBe("forms.errors.duplicateFieldId");
    const oneOption = { sections: [{ id: "s1", fields: [f({ id: "a", type: "single_choice", options: [{ value: "x", label: "X" }] })] }] };
    expect(formDefinitionSchema.safeParse(oneOption).error?.issues[0].message).toBe("forms.errors.optionsRequired");
  });

  it("only allows conditions on EARLIER answer fields (no cycles, no forward references)", () => {
    const forward = { sections: [{ id: "s1", fields: [f({ id: "a", type: "text", showIf: { field: "b", equals: "x" } }), f({ id: "b", type: "text" })] }] };
    expect(formDefinitionSchema.safeParse(forward).error?.issues[0].message).toBe("forms.errors.conditionTarget");
    const self = { sections: [{ id: "s1", fields: [f({ id: "a", type: "text", showIf: { field: "a", equals: "x" } })] }] };
    expect(formDefinitionSchema.safeParse(self).success).toBe(false);
    const badValue = { sections: [{ id: "s1", fields: [f({ id: "a", type: "yes_no" }), f({ id: "b", type: "text", showIf: { field: "a", equals: "maybe" } })] }] };
    expect(formDefinitionSchema.safeParse(badValue).error?.issues[0].message).toBe("forms.errors.conditionValue");
    // across sections: a later section may depend on an earlier one
    const cross = { sections: [{ id: "s1", fields: [f({ id: "a", type: "yes_no" })] }, { id: "s2", fields: [f({ id: "b", type: "text", showIf: { field: "a", equals: "yes" } })] }] };
    expect(formDefinitionSchema.safeParse(cross).success).toBe(true);
  });

  it("parses an unreadable stored definition to an empty form", () => {
    expect(parseDefinition(null)).toEqual({ sections: [] });
    expect(parseDefinition({ sections: "x" })).toEqual({ sections: [] });
  });
});

describe("conditional visibility", () => {
  const fields = physical.sections.flatMap((s) => s.fields);
  const byId = new Map(fields.map((x) => [x.id, x]));

  it("shows a dependent field only when the answer matches", () => {
    expect(isFieldVisible(byId.get("allergy_details")!, { has_allergy: "no" }, byId)).toBe(false);
    expect(isFieldVisible(byId.get("allergy_details")!, { has_allergy: "yes" }, byId)).toBe(true);
    expect(isFieldVisible(byId.get("position")!, { sport: "fb" }, byId)).toBe(false);
    expect(isFieldVisible(byId.get("position")!, { sport: "bb" }, byId)).toBe(true);
  });

  it("hides a chain when an ancestor is hidden, even if the stale answer matches", () => {
    const v = visibleFieldIds(fields, { has_allergy: "no", allergy_details: "peanuts" });
    expect(v.has("allergy_details")).toBe(false);
    expect(v.has("epipen")).toBe(false);
    expect(visibleFieldIds(fields, { has_allergy: "yes", allergy_details: "Peanuts " }).has("epipen")).toBe(true);
  });

  it("matches multi-choice and boolean answers", () => {
    const m = [f({ id: "d", type: "multi_choice", options: [{ value: "mon", label: "M" }, { value: "wed", label: "W" }] }), f({ id: "x", type: "text", showIf: { field: "d", equals: "wed" } })];
    expect(visibleFieldIds(m, { d: ["mon", "wed"] }).has("x")).toBe(true);
    expect(visibleFieldIds(m, { d: ["mon"] }).has("x")).toBe(false);
    const b = [f({ id: "y", type: "yes_no" }), f({ id: "z", type: "text", showIf: { field: "y", equals: "yes" } })];
    expect(visibleFieldIds(b, { y: true }).has("z")).toBe(true);
  });

  it("terminates on a malformed (cyclic) stored definition", () => {
    const a = f({ id: "a", type: "text", showIf: { field: "b", equals: "1" } });
    const b = f({ id: "b", type: "text", showIf: { field: "a", equals: "1" } });
    expect(visibleFieldIds([a, b], { a: "1", b: "1" }).size).toBe(0);
  });
});

describe("answer validation", () => {
  const sig = { name: "Anna Example", path: "p" };
  it("requires visible required fields only and drops hidden answers", () => {
    const r = validateAnswers(physical, { has_allergy: "no", allergy_details: "secret", agree: true, sign: sig });
    expect(r.ok).toBe(true);
    expect(r.values).not.toHaveProperty("allergy_details");
    expect(r.values).not.toHaveProperty("intro");
    const r2 = validateAnswers(physical, { has_allergy: "yes", agree: true, sign: sig });
    expect(r2.errors).toEqual({ allergy_details: "forms.errors.required" });
  });

  it("validates types", () => {
    const r = validateAnswers(physical, {
      has_allergy: "maybe", sport: "tennis", days: ["mon", "sun"], weight: "abc", checkup: "2026-02-30", agree: false, sign: { name: "A", path: null },
    });
    expect(r.errors).toMatchObject({
      has_allergy: "forms.errors.choice", sport: "forms.errors.choice", days: "forms.errors.choice", weight: "forms.errors.number",
      checkup: "forms.errors.date", agree: "forms.errors.consentRequired", sign: "forms.errors.signerName",
    });
    expect(validateAnswers(physical, { has_allergy: "no", agree: true, sign: sig, weight: "200" }).errors.weight).toBe("forms.errors.numberRange");
    expect(validateAnswers(physical, { has_allergy: "no", agree: true, sign: sig, weight: "42,5" }).values.weight).toBe(42.5);
  });

  it("requires both a typed name and a drawn signature, and checks storage keys", () => {
    expect(validateAnswers(physical, { has_allergy: "no", agree: true, sign: { name: "Anna", path: null } }).errors.sign).toBe("forms.errors.signatureDrawn");
    expect(validateAnswers(physical, { has_allergy: "no", agree: true }).errors.sign).toBe("forms.errors.signatureRequired");
    const bad = validateAnswers(physical, { has_allergy: "no", agree: true, sign: sig, doc: { path: "other/x.pdf", name: "x.pdf", mime: "application/pdf" } }, { pathOk: (p) => p === "p" });
    expect(bad.errors.doc).toBe("forms.errors.invalidFile");
  });

  it("renders answers for display", () => {
    const sport = physical.sections[0].fields.find((x) => x.id === "sport")!;
    expect(displayAnswer(sport, "bb", { yes: "Yes", no: "No", accepted: "OK" })).toBe("Basketball");
    expect(displayAnswer(f({ id: "c", type: "consent" }), true, { yes: "Yes", no: "No", accepted: "OK" })).toBe("OK");
  });
});

describe("renewal, completion and versioning", () => {
  it("computes valid_until like the database (end-of-month clamping)", () => {
    expect(validUntilFor("yearly", null, "2026-03-15")).toBe("2027-03-15");
    expect(validUntilFor("yearly", null, "2028-02-29")).toBe("2029-02-28");
    expect(validUntilFor("months", 6, "2026-08-31")).toBe("2027-02-28");
    expect(validUntilFor("none", null, "2026-01-01")).toBeNull();
  });

  it("classifies completion", () => {
    const today = "2026-11-13";
    expect(completionStatus(null, null, today)).toBe("missing");
    expect(completionStatus(null, "2026-11-01", today)).toBe("overdue");
    expect(completionStatus({ validUntil: null }, null, today)).toBe("complete");
    expect(completionStatus({ validUntil: "2026-11-12" }, null, today)).toBe("expired");
    expect(completionStatus({ validUntil: "2026-12-01" }, null, today)).toBe("expiring");
    expect(completionStatus({ validUntil: "2027-06-01" }, null, today)).toBe("complete");
    expect(summarise(["complete", "expiring", "missing", "expired"])).toMatchObject({ total: 4, pct: 50 });
    expect(summarise([]).pct).toBe(100);
  });

  it("publishing appends versions; submissions stay tied to their own version", () => {
    expect(nextVersion([])).toBe(1);
    expect(nextVersion([1, 3, 2])).toBe(4);
    const versions = [{ id: "v1", version: 1 }, { id: "v2", version: 2 }];
    expect(versionForSubmission({ formVersionId: "v1" }, versions)?.version).toBe(1);
    expect(versionForSubmission({ formVersionId: "gone" }, versions)).toBeNull();
    expect(hasUnpublishedChanges({ sections: [{ id: "s1", fields: [] }] }, { sections: [{ fields: [], id: "s1" }] })).toBe(false);
    expect(hasUnpublishedChanges({ sections: [] }, null)).toBe(true);
    expect(hasUnpublishedChanges({ sections: [{ id: "s1" }] }, { sections: [{ id: "s2" }] })).toBe(true);
  });
});

describe("storage keys and evidence", () => {
  const org = "00000000-0000-4000-8000-000000000001";
  const fam = "00000000-0000-4000-8000-000000000061";
  it("builds and checks family-scoped keys", () => {
    const p = formFilePath(org, fam, "png");
    expect(isFormFilePathFor(p, org, fam)).toBe(true);
    expect(isFormFilePathFor(p, org, "00000000-0000-4000-8000-000000000062")).toBe(false);
    expect(isFormFilePathFor(`${org}/${fam}/../x.png`, org, fam)).toBe(false);
  });
  it("hashes IPs with a key and never returns the address", () => {
    const h = hashIp("203.0.113.7", org, "pepper")!;
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("203");
    expect(hashIp("203.0.113.7", org, "other")).not.toBe(h);
    expect(hashIp(null, org, "pepper")).toBeNull();
    expect(firstForwardedIp("203.0.113.7, 10.0.0.1")).toBe("203.0.113.7");
  });
  it("accepts only real PNG data URLs", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64");
    expect(decodePngDataUrl(`data:image/png;base64,${png}`)).not.toBeNull();
    expect(decodePngDataUrl(`data:image/svg+xml;base64,${png}`)).toBeNull();
    expect(decodePngDataUrl(`data:image/png;base64,${Buffer.from("<svg/>").toString("base64")}`)).toBeNull();
  });
  it("maps database errors to i18n keys", () => {
    expect(formsErrorKey("FORM_VERSION_NOT_CURRENT")).toBe("forms.errors.versionChanged");
    expect(formsErrorKey("CONTRACT_IMMUTABLE")).toBe("forms.errors.contractImmutable");
    expect(formsErrorKey("new row violates row-level security policy")).toBe("forms.errors.notPermitted");
    expect(formsErrorKey("boom")).toBe("forms.errors.generic");
  });
});
