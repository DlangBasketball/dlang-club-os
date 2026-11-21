import { describe, expect, it } from "vitest";
import { familySchema, licenceSchema, parseAmount } from "@/lib/people/validation";
import { formatPostalAddress, hasLicence, licenceFromRow, parseLicenceFilter } from "@/lib/people/licence";
import { buildImportPlanFromTable, normaliseHeader, parseCsv, TEMPLATE_COLUMNS, TEMPLATE_CSV } from "@/lib/import/families";
import { suggestMapping } from "@/lib/import/mapping";

// SYNTHETIC DATA ONLY.

describe("parseAmount", () => {
  it.each([
    ["45", 45],
    ["45.50", 45.5],
    ["45,50", 45.5],
    ["1'200.00", 1200],
    ["1 200,50", 1200.5],
    ["1,200", 1200],
    ["1.200", 1200],
    ["CHF 45.-", 45],
    ["45.- CHF", 45],
    ["$1,200.50", 1200.5],
    ["€ 12", 12],
    ["0", 0],
  ])("reads %s", (raw, n) => expect(parseAmount(raw)).toBe(n));

  it.each(["", "-5", "abc", "1,2345", "4 5x", "12.5.6"])("refuses %s", (raw) => expect(parseAmount(raw)).toBeNull());
});

describe("licenceSchema", () => {
  it("normalises empty values to null", () => {
    expect(licenceSchema.parse({ number: " ", category: "", federation: undefined, issuedOn: "", fee: "" })).toEqual({
      number: null, category: null, federation: null, issuedOn: null, fee: null,
    });
  });

  it("accepts a full licence and rounds the fee", () => {
    const d = licenceSchema.parse({ number: " SYN-1 ", category: "U16", federation: "Example Federation", issuedOn: "2025-01-15", fee: "45.50" });
    expect(d).toEqual({ number: "SYN-1", category: "U16", federation: "Example Federation", issuedOn: "2025-01-15", fee: 45.5 });
    expect(licenceSchema.parse({ fee: 12.345 }).fee).toBe(12.35);
  });

  it("enforces the database limits", () => {
    expect(licenceSchema.safeParse({ number: "9".repeat(41) }).error?.issues[0].message).toBe("editPeople.errors.tooLong");
    expect(licenceSchema.safeParse({ category: "c".repeat(41) }).success).toBe(false);
    expect(licenceSchema.safeParse({ federation: "f".repeat(81) }).success).toBe(false);
    expect(licenceSchema.safeParse({ number: "9".repeat(40), category: "c".repeat(40), federation: "f".repeat(80) }).success).toBe(true);
  });

  it("refuses bad fees and dates", () => {
    expect(licenceSchema.safeParse({ fee: "-1" }).error?.issues[0].message).toBe("editPeople.errors.invalidAmount");
    expect(licenceSchema.safeParse({ fee: -1 }).success).toBe(false);
    expect(licenceSchema.safeParse({ fee: "abc" }).success).toBe(false);
    expect(licenceSchema.safeParse({ fee: "100000000" }).success).toBe(false);
    expect(licenceSchema.safeParse({ issuedOn: "15.01.2026" }).error?.issues[0].message).toBe("editPeople.errors.invalidDate");
    expect(licenceSchema.safeParse({ issuedOn: "2999-01-01" }).error?.issues[0].message).toBe("editPeople.errors.futureDate");
  });
});

describe("family postal address", () => {
  it("validates postal code and city", () => {
    const d = familySchema.parse({ name: "Synthetic family", address: "Example street 1", postalCode: " 1000 ", city: "Exampletown" });
    expect(d).toMatchObject({ address: "Example street 1", postalCode: "1000", city: "Exampletown" });
    expect(familySchema.parse({ name: "Synthetic family", postalCode: "" }).postalCode).toBeNull();
    expect(familySchema.safeParse({ name: "Synthetic family", postalCode: "1".repeat(13) }).success).toBe(false);
    expect(familySchema.safeParse({ name: "Synthetic family", city: "x".repeat(81) }).success).toBe(false);
  });

  it("formats street, postal code and city on one line", () => {
    expect(formatPostalAddress({ address: "Example street 1", postalCode: "1000", city: "Exampletown" })).toBe("Example street 1, 1000 Exampletown");
    expect(formatPostalAddress({ address: "Example street 1", postalCode: null, city: "Exampletown" })).toBe("Example street 1, Exampletown");
    expect(formatPostalAddress({ address: null, postalCode: "1000", city: null })).toBe("1000");
    expect(formatPostalAddress({ address: " ", postalCode: null, city: null })).toBeNull();
  });
});

describe("licence helpers", () => {
  it("maps a database row", () => {
    expect(licenceFromRow({ licence_number: "SYN-1", licence_category: null, licence_federation: null, licence_issued_on: "2026-01-01", licence_fee: "45.50" as unknown as number })).toEqual({
      number: "SYN-1", category: null, federation: null, issuedOn: "2026-01-01", fee: 45.5,
    });
    expect(hasLicence({ number: "SYN-1" })).toBe(true);
    expect(hasLicence({ number: null })).toBe(false);
  });

  it("parses the players list filter", () => {
    expect(parseLicenceFilter("has")).toBe("has");
    expect(parseLicenceFilter("missing")).toBe("missing");
    expect(parseLicenceFilter(["missing", "has"])).toBe("missing");
    expect(parseLicenceFilter("evil")).toBeNull();
    expect(parseLicenceFilter(undefined)).toBeNull();
  });
});

describe("import: header aliases (en / fr / de / it)", () => {
  it.each([
    ["License number", "athlete_licence_number"],
    ["Licence number", "athlete_licence_number"],
    ["N° licence", "athlete_licence_number"],
    ["N° de licence", "athlete_licence_number"],
    ["Numéro de licence", "athlete_licence_number"],
    ["Lizenznummer", "athlete_licence_number"],
    ["Lizenz-Nr.", "athlete_licence_number"],
    ["Numero di licenza", "athlete_licence_number"],
    ["Cat.", "athlete_licence_category"],
    ["Catégorie", "athlete_licence_category"],
    ["Kategorie", "athlete_licence_category"],
    ["License category", "athlete_licence_category"],
    ["Licence issued on", "athlete_licence_issued_on"],
    ["Date de licence", "athlete_licence_issued_on"],
    ["Lizenzdatum", "athlete_licence_issued_on"],
    ["License fee", "athlete_licence_fee"],
    ["Frais de licence", "athlete_licence_fee"],
    ["Lizenzgebühr", "athlete_licence_fee"],
    ["Federation", "athlete_licence_federation"],
    ["Verband", "athlete_licence_federation"],
    ["NPA", "family_postal_code"],
    ["PLZ", "family_postal_code"],
    ["Postal number", "family_postal_code"],
    ["Postal code", "family_postal_code"],
    ["ZIP", "family_postal_code"],
    ["CAP", "family_postal_code"],
    ["Localité", "family_city"],
    ["Ort", "family_city"],
    ["Location", "family_city"],
    ["City", "family_city"],
    ["Località", "family_city"],
  ])("%s -> %s", (header, target) => {
    expect(normaliseHeader(header)).toBe(target);
    expect((TEMPLATE_COLUMNS as readonly string[]).includes(target)).toBe(true);
  });

  it("suggests the mapping for a federation export", () => {
    const headers = ["Vorname", "Name", "Geburtsdatum", "Lizenznummer", "Kat.", "PLZ", "Ort"];
    expect(suggestMapping(headers, TEMPLATE_COLUMNS)).toEqual([
      "", "", "", "athlete_licence_number", "athlete_licence_category", "family_postal_code", "family_city",
    ]);
  });

  it("keeps the downloadable template consistent with the columns", () => {
    const table = parseCsv(TEMPLATE_CSV);
    expect(table[0]).toEqual([...TEMPLATE_COLUMNS]);
    for (const row of table.slice(1)) expect(row).toHaveLength(TEMPLATE_COLUMNS.length);
    const plan = buildImportPlanFromTable(table, "DMY");
    expect(plan.errors).toEqual([]);
    expect(plan.families[0]).toMatchObject({ address: "Avenue de Cour 12", postal_code: "1007", city: "Lausanne" });
    expect(plan.families[0].athletes[0]).toMatchObject({ licence_number: "SYN-0001", licence_category: "U14", licence_fee: 45 });
    expect(plan.families[0].athletes[1].licence_number).toBeNull();
  });
});

describe("import: licence and address validation", () => {
  const header = ["First name", "Last name", "DOB", "Guardian email", "License number", "Cat.", "Licence issued on", "License fee", "NPA", "Localité"];
  const row = (first: string, licence: string, extra: Partial<Record<"date" | "fee" | "npa" | "city" | "cat", string>> = {}) => [
    first, "Synthetic", "01.02.2014", "parent@example.com", licence, extra.cat ?? "U12", extra.date ?? "01.09.2025", extra.fee ?? "CHF 45.-", extra.npa ?? "1000", extra.city ?? "Exampletown",
  ];

  it("plans licence and postal fields", () => {
    const plan = buildImportPlanFromTable([header, row("Alpha", "SYN-1"), row("Beta", "")], "DMY");
    expect(plan.errors).toEqual([]);
    expect(plan.families).toHaveLength(1);
    expect(plan.families[0]).toMatchObject({ postal_code: "1000", city: "Exampletown" });
    expect(plan.families[0].athletes[0]).toMatchObject({
      licence_number: "SYN-1", licence_category: "U12", licence_issued_on: "2025-09-01", licence_fee: 45,
    });
    expect(plan.families[0].athletes[1].licence_number).toBeNull();
  });

  it("reports bad dates, fees and lengths per row", () => {
    const plan = buildImportPlanFromTable([
      header,
      row("Alpha", "SYN-1", { date: "soon" }),
      row("Beta", "SYN-2", { date: "01.01.2999" }),
      row("Gamma", "SYN-3", { fee: "free" }),
      row("Delta", "SYN-4", { npa: "1".repeat(13) }),
      row("Eps", "9".repeat(41)),
    ], "DMY");
    expect(plan.errors.map((e) => [e.row, e.key])).toEqual([
      [2, "licenceDateUnreadable"],
      [3, "licenceDateFuture"],
      [4, "licenceFeeInvalid"],
      [5, "valueTooLong"],
      [6, "valueTooLong"],
    ]);
    expect(plan.totals.athletes).toBe(0);
  });

  it("refuses the same licence twice in a file", () => {
    const plan = buildImportPlanFromTable([header, row("Alpha", "SYN-1"), row("Beta", "SYN-1")], "DMY");
    expect(plan.errors).toEqual([{ row: 3, field: "athlete_licence_number", key: "licenceDuplicate", values: { value: "SYN-1", line: 2 } }]);
  });

  it("refuses a licence that another player of the club holds", () => {
    const existing = {
      familiesByName: new Map<string, string[]>(),
      athleteKeys: new Set<string>(["alpha|synthetic|2014-02-01"]),
      knownEmails: new Set<string>(),
      licenceOwners: new Map([["SYN-1", "alpha|synthetic|2014-02-01"], ["SYN-9", "other|player|2013-01-01"]]),
    };
    const plan = buildImportPlanFromTable([header, row("Alpha", "SYN-1"), row("Beta", "SYN-9")], "DMY", existing);
    expect(plan.errors).toEqual([{ row: 3, field: "athlete_licence_number", key: "licenceTaken", values: { value: "SYN-9" } }]);
    // the existing holder of SYN-1 is the same player: skipped, not an error
    expect(plan.warnings.some((w) => w.key === "athleteExists")).toBe(true);
  });
});
