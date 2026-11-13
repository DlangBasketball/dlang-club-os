import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { cellText, looksLikeXlsx, parseXlsx } from "@/lib/import/xlsx";
import { applyMapping, checkMapping, suggestMapping } from "@/lib/import/mapping";
import { buildImportPlanFromTable, TEMPLATE_COLUMNS } from "@/lib/import/families";
import { buildRegistrationPlan, programmeIndex, REGISTRATION_ALIASES, REGISTRATION_COLUMNS } from "@/lib/import/registrations";
import { DEFAULT_BUILTIN, isDefaultConfig, normaliseConfig, registrationConfigSchema, resolveConfig, validateRegistrationExtras } from "@/lib/registration-form/config";

async function workbook(rows: unknown[][], sheetName = "Roster"): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Empty");
  const ws = wb.addWorksheet(sheetName);
  for (const r of rows) ws.addRow(r);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("xlsx parsing", () => {
  it("reads the first sheet with data: dates, numbers, formulas, rich text", async () => {
    const bytes = await workbook([
      ["Athlete first name", "Athlete last name", "DOB", "Jersey", "Note"],
      ["Léa", "Muster", new Date(Date.UTC(2013, 2, 14)), 12, { richText: [{ text: "rich " }, { text: "text" }] }],
      [],
      ["Noah", "Muster", "02.09.2015", { formula: "1+1", result: 2 }, null],
    ]);
    expect(looksLikeXlsx(bytes)).toBe(true);
    const table = await parseXlsx(bytes);
    expect(table).toEqual([
      ["Athlete first name", "Athlete last name", "DOB", "Jersey", "Note"],
      ["Léa", "Muster", "2013-03-14", "12", "rich text"],
      ["Noah", "Muster", "02.09.2015", "2", ""],
    ]);
  });

  it("converts odd cell values safely", () => {
    expect(cellText(null)).toBe("");
    expect(cellText(1.23456789)).toBe("1.234568");
    expect(cellText(true)).toBe("true");
    expect(cellText({ error: "#N/A" } as unknown as ExcelJS.CellValue)).toBe("");
    expect(cellText({ text: "link", hyperlink: "https://example.com" } as unknown as ExcelJS.CellValue)).toBe("link");
  });

  it("rejects non-xlsx bytes", async () => {
    expect(looksLikeXlsx(new TextEncoder().encode("a,b,c"))).toBe(false);
    await expect(parseXlsx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).rejects.toBeTruthy();
  });

  it("feeds the families planner end to end after column mapping", async () => {
    const bytes = await workbook([
      ["Vorname", "Nachname", "Geburtsdatum", "Email Eltern", "Haushalt"],
      ["Léa", "Muster", new Date(Date.UTC(2013, 2, 14)), "anna@example.com", "Muster"],
    ]);
    const table = await parseXlsx(bytes);
    const suggested = suggestMapping(table[0], TEMPLATE_COLUMNS);
    expect(suggested).toEqual(["", "", "", "", ""]); // German headers: nothing auto-mapped
    const mapping = ["athlete_first_name", "athlete_last_name", "athlete_dob", "guardian1_email", "family_name"];
    const check = checkMapping(mapping, 5, TEMPLATE_COLUMNS);
    expect(check.ok).toBe(true);
    const plan = buildImportPlanFromTable(applyMapping(table, mapping), "DMY");
    expect(plan.errors).toEqual([]);
    expect(plan.totals).toMatchObject({ athletes: 1, familiesNew: 1, invitations: 1 });
    expect(plan.families[0].athletes[0].dob).toBe("2013-03-14");
  });
});

describe("column mapping", () => {
  it("suggests known headers and aliases once", () => {
    expect(suggestMapping(["First name", "DOB", "dob", "Shoe"], TEMPLATE_COLUMNS)).toEqual(["athlete_first_name", "athlete_dob", "", ""]);
    expect(suggestMapping(["Program", "Status"], REGISTRATION_COLUMNS, REGISTRATION_ALIASES)).toEqual(["programme", "status"]);
  });
  it("rejects tampered mappings", () => {
    expect(checkMapping(["athlete_dob"], 2, TEMPLATE_COLUMNS)).toMatchObject({ ok: false, key: "mappingInvalid" });
    expect(checkMapping(["athlete_dob", "evil_column"], 2, TEMPLATE_COLUMNS)).toMatchObject({ ok: false, key: "mappingInvalid" });
    expect(checkMapping(["athlete_dob", "athlete_dob"], 2, TEMPLATE_COLUMNS)).toMatchObject({ ok: false, key: "mappingDuplicate" });
  });
  it("drops ignored columns", () => {
    expect(applyMapping([["a", "b", "c"], ["1", "2", "3"]], ["x", "", "z"])).toEqual([["x", "z"], ["1", "3"]]);
  });
});

describe("registrations import", () => {
  const existing = {
    athletes: new Map([["léa|muster|2013-03-14", "ath-1"]]),
    programmes: programmeIndex([
      { id: "p1", slug: "u12", name: "U12 Team" },
      { id: "p2", slug: "camp-a", name: "Camp" },
      { id: "p3", slug: "camp-b", name: "Camp" },
    ]),
    registrations: new Set(["ath-1|p2"]),
  };
  it("matches athletes and programmes, maps statuses and reports problems", () => {
    const plan = buildRegistrationPlan([
      ["first_name", "last_name", "dob", "program", "status", "registered_on"],
      ["Léa", "Muster", "14.03.2013", "u12", "bestätigt", "01.09.2025"],
      ["Léa", "Muster", "14.03.2013", "U12 TEAM", "", ""],
      ["Léa", "Muster", "14.03.2013", "camp-a", "", ""],
      ["Léa", "Muster", "14.03.2013", "Camp", "", ""],
      ["Ghost", "Kid", "2014-01-01", "u12", "", ""],
      ["Léa", "Muster", "14.03.2013", "nope", "weird", "2999-01-01"],
    ], "DMY", existing);
    expect(plan.rows).toEqual([{ row: 2, athleteId: "ath-1", programId: "p1", status: "confirmed", registeredOn: "2025-09-01", notes: null }]);
    expect(plan.errors.map((e) => e.key)).toEqual(["duplicateRegistration", "programmeAmbiguous", "athleteUnknown", "programmeUnknown"]);
    expect(plan.warnings.map((w) => w.key)).toEqual(["registrationExists", "statusUnknown", "registeredOnIgnored"]);
    expect(plan.totals).toEqual({ rows: 6, registrations: 1, skipped: 1 });
  });
  it("requires the key columns", () => {
    expect(buildRegistrationPlan([["first_name"], ["x"]], "DMY", existing).errors[0].key).toBe("missingColumns");
  });
});

describe("registration form config", () => {
  it("defaults reproduce the original form", () => {
    const c = resolveConfig(null);
    expect(c.builtin).toEqual(DEFAULT_BUILTIN);
    expect(isDefaultConfig(c)).toBe(true);
    // original form: nothing beyond name / dob / parent block is required
    const r = validateRegistrationExtras(c, {}, {}, "all");
    expect(r.ok).toBe(true);
  });
  it("a hidden field is never required; unknown built-ins are rejected", () => {
    const p = registrationConfigSchema.parse({ builtin: { school: { shown: false, required: true } } });
    expect(normaliseConfig(p).builtin.school).toEqual({ shown: false, required: false });
    expect(registrationConfigSchema.safeParse({ builtin: { shoeSize: { shown: true, required: true } } }).success).toBe(false);
    expect(registrationConfigSchema.safeParse({ questions: [{ id: "f1", type: "signature", label: "Sign" }] }).success).toBe(false);
  });
  it("validates required built-ins and custom questions per child", () => {
    const c = resolveConfig({
      builtin: { jerseySize: { shown: true, required: true }, address: { shown: true, required: true } },
      questions: [
        { id: "swim", type: "yes_no", label: "Can swim?", required: true },
        { id: "level", type: "single_choice", label: "Level", required: true, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], showIf: { field: "swim", equals: "yes" } },
      ],
    });
    const child = validateRegistrationExtras(c, { jerseySize: "" }, { swim: "no", level: "zzz" }, "child");
    expect(child.errors).toEqual({ jerseySize: "forms.errors.required" });
    expect(child.answers).toEqual({ swim: "no" });
    expect(validateRegistrationExtras(c, { address: "" }, {}, "parent").errors).toEqual({ address: "forms.errors.required" });
    const ok = validateRegistrationExtras(c, { jerseySize: "YM", school: "ignored (hidden)" }, { swim: "yes", level: "b" }, "child");
    expect(ok.ok).toBe(true);
    expect(ok.extras).toEqual({ jerseySize: "YM" });
  });
});
