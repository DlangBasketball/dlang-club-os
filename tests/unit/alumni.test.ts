import { describe, expect, it } from "vitest";
import {
  alumniSchema, contactTarget, countAlumni, currentPlacement, filterAlumni, filterOptions, isMinor, parseFilters, sendBlockReason,
  showcaseEligible, showcaseName, whatsappDigits, alumniErrorKey,
  type AlumniListItem, type ContactPerson, type PlacementLite, type ShowcaseCandidate,
} from "@/lib/alumni/rules";
import {
  ALUMNI_CSV_COLUMNS, ALUMNI_TEMPLATE_CSV, alumniToCsv, buildAlumniImportPlan, normaliseAlumniHeader, parseBool,
  parseInstitutionType, parsePlacementStatus, parseScholarship, personKey,
} from "@/lib/alumni/csv";
import { getFeature, featuresForPath } from "@/lib/upgrades/catalog";
import { DEFAULT_SECTIONS, PUBLIC_SECTIONS } from "@/lib/website/settings-shape";
import { LIVE_SOURCES } from "@/lib/site/blocks";

// SYNTHETIC DATA ONLY.
const TODAY = new Date("2026-11-21T10:00:00Z");
const TODAY_ISO = "2026-11-21";

describe("minor rule (birth year / birth date)", () => {
  it("birth year only: possibly a minor until the year they turn 19", () => {
    expect(isMinor({ birthYear: 2010 }, TODAY)).toBe(true);
    expect(isMinor({ birthYear: 2008 }, TODAY)).toBe(true); // 17 or 18: birthday unknown
    expect(isMinor({ birthYear: 2007 }, TODAY)).toBe(false); // 19 at the latest by year end, 18+ now
    expect(isMinor({ birthYear: 1999 }, TODAY)).toBe(false);
  });
  it("a full birth date decides exactly", () => {
    expect(isMinor({ birthYear: 2008, birthDate: "2008-11-21" }, TODAY)).toBe(false); // 18 today
    expect(isMinor({ birthYear: 2008, birthDate: "2008-11-22" }, TODAY)).toBe(true); // 18 tomorrow
    expect(isMinor({ birthDate: "2008-01-05" }, TODAY)).toBe(false);
  });
  it("unknown age is not treated as a minor for contact", () => {
    expect(isMinor({}, TODAY)).toBe(false);
    expect(isMinor({ birthYear: null, birthDate: null }, TODAY)).toBe(false);
  });
});

const person = (o: Partial<ContactPerson> = {}): ContactPerson => ({
  firstName: "Alex", lastName: "Example", birthYear: 2001, birthDate: null, email: "alex@example.test", phone: "+41 79 000 00 01",
  whatsapp: true, guardianName: null, guardianEmail: null, guardianPhone: null, contactConsent: true, status: "active", ...o,
});

describe("who to contact", () => {
  it("adults are contacted directly", () => {
    const t = contactTarget(person(), TODAY);
    expect(t).toMatchObject({ via: "self", email: "alex@example.test", whatsapp: "41790000001", canSendFromClub: true, emailBlocked: null });
  });
  it("minors are contacted through the guardian", () => {
    const t = contactTarget(person({ birthYear: 2011, guardianName: "Sam Guardian", guardianEmail: "g@example.test", guardianPhone: "+33 6 00 00 00 00" }), TODAY);
    expect(t).toMatchObject({ via: "guardian", name: "Sam Guardian", email: "g@example.test", whatsapp: "33600000000" });
  });
  it("a minor without guardian email cannot be emailed", () => {
    expect(sendBlockReason(person({ birthYear: 2011 }), TODAY)).toBe("no_email");
  });
  it("do not contact blocks every action", () => {
    const t = contactTarget(person({ status: "do_not_contact" }), TODAY);
    expect(t.emailBlocked).toBe("do_not_contact");
    expect(t.phoneBlocked).toBe("do_not_contact");
    expect(t.whatsapp).toBeNull();
    expect(t.canSendFromClub).toBe(false);
    expect(sendBlockReason(person({ status: "do_not_contact" }), TODAY)).toBe("do_not_contact");
  });
  it("sending from the club needs recorded contact consent", () => {
    expect(sendBlockReason(person({ contactConsent: false }), TODAY)).toBe("no_consent");
    expect(sendBlockReason(person(), TODAY)).toBeNull();
  });
  it("WhatsApp needs the flag and an international number", () => {
    expect(contactTarget(person({ whatsapp: false }), TODAY).whatsapp).toBeNull();
    expect(whatsappDigits("079 000 00 01")).toBeNull();
    expect(whatsappDigits("0041 79 000 00 01")).toBe("41790000001");
    expect(whatsappDigits("+1 (512) 555-0100")).toBe("15125550100");
  });
});

const showcase = (o: Partial<ShowcaseCandidate> = {}): ShowcaseCandidate => ({
  firstName: "Alex", lastName: "Example", birthYear: 2001, birthDate: null, showcaseConsent: true, showcaseGuardianConsent: false,
  showcaseNameStyle: "initial", status: "active", ...o,
});

describe("public showcase consent filter", () => {
  it("consented adults only", () => {
    expect(showcaseEligible(showcase(), TODAY)).toBe(true);
    expect(showcaseEligible(showcase({ showcaseConsent: false }), TODAY)).toBe(false);
  });
  it("minors need recorded guardian consent", () => {
    expect(showcaseEligible(showcase({ birthYear: 2010 }), TODAY)).toBe(false);
    expect(showcaseEligible(showcase({ birthYear: 2010, showcaseGuardianConsent: true }), TODAY)).toBe(true);
  });
  it("unknown age needs guardian consent too; do not contact is never shown", () => {
    expect(showcaseEligible(showcase({ birthYear: null }), TODAY)).toBe(false);
    expect(showcaseEligible(showcase({ birthYear: null, showcaseGuardianConsent: true }), TODAY)).toBe(true);
    expect(showcaseEligible(showcase({ status: "do_not_contact", showcaseGuardianConsent: true }), TODAY)).toBe(false);
  });
  it("name per consent: first name + last initial, or full name", () => {
    expect(showcaseName(showcase())).toBe("Alex E.");
    expect(showcaseName(showcase({ showcaseNameStyle: "full" }))).toBe("Alex Example");
  });
});

const pl = (o: Partial<PlacementLite> = {}): PlacementLite => ({
  id: Math.random().toString(36).slice(2), institution: "Example U", institution_type: "ncaa_d1", country: "USA", start_date: "2023-08-01",
  end_year: 2027, status: "enrolled", is_current: true, created_at: "2023-01-01T00:00:00Z", ...o,
});
const row = (o: Partial<AlumniListItem> = {}): AlumniListItem => ({
  id: Math.random().toString(36).slice(2), first_name: "Alex", last_name: "Example", email: null, phone: null, status: "active", tags: [],
  birth_year: 2003, placements: [pl()], follow_up_on: null, ...o,
});

describe("list: current placement, filters, counts", () => {
  const rows = [
    row({ first_name: "Ana", placements: [pl({ institution_type: "ncaa_d1" })] }),
    row({ first_name: "Ben", placements: [pl({ institution_type: "ncaa_d1", country: "Canada", end_year: 2026 })] }),
    row({ first_name: "Cleo", placements: [pl({ institution_type: "ncaa_d2", end_year: 2025 })], follow_up_on: "2026-11-01" }),
    row({ first_name: "Dan", placements: [pl({ institution_type: "naia" })], status: "lost_touch" }),
    row({ first_name: "Eve", placements: [pl({ institution_type: "high_school", is_current: false, start_date: "2020-08-01" }), pl({ institution_type: "prep_academy", start_date: "2022-08-01" })] }),
    row({ first_name: "Finn", placements: [pl({ institution_type: "high_school", institution: "Synthetic High" })], tags: ["class-2024"], follow_up_on: "2026-12-24" }),
    row({ first_name: "Gus", placements: [] }),
  ];
  it("current placement: current first, then latest; 'left' only as a last resort", () => {
    const cur = currentPlacement([pl({ id: "a", is_current: false, start_date: "2024-01-01" }), pl({ id: "b", is_current: true, start_date: "2020-01-01" })]);
    expect(cur?.id).toBe("b");
    expect(currentPlacement([pl({ id: "x", status: "left" }), pl({ id: "y", is_current: false, status: "graduated" })])?.id).toBe("y");
    expect(currentPlacement([])).toBeNull();
  });
  it("counts people by their current placement group (one person once)", () => {
    const c = countAlumni(rows, TODAY_ISO);
    expect(c.total).toBe(7);
    expect(Object.fromEntries(c.groups.map((g) => [g.key, g.count]))).toEqual({ ncaa_d1: 2, ncaa_d2: 1, naia: 1, schools: 2 });
    expect(c.followUpsDue).toBe(1);
  });
  it("filters by type, country, graduation year, status, follow-up and text", () => {
    expect(filterAlumni(rows, { type: "ncaa_d1" }, TODAY_ISO).map((r) => r.first_name)).toEqual(["Ana", "Ben"]);
    expect(filterAlumni(rows, { country: "canada" }, TODAY_ISO).map((r) => r.first_name)).toEqual(["Ben"]);
    expect(filterAlumni(rows, { gradYear: 2025 }, TODAY_ISO).map((r) => r.first_name)).toEqual(["Cleo"]);
    expect(filterAlumni(rows, { status: "lost_touch" }, TODAY_ISO).map((r) => r.first_name)).toEqual(["Dan"]);
    expect(filterAlumni(rows, { followUp: true }, TODAY_ISO).map((r) => r.first_name)).toEqual(["Cleo"]);
    expect(filterAlumni(rows, { q: "synthetic high" }, TODAY_ISO).map((r) => r.first_name)).toEqual(["Finn"]);
    expect(filterAlumni(rows, { q: "CLASS-2024" }, TODAY_ISO).map((r) => r.first_name)).toEqual(["Finn"]);
    expect(filterAlumni(rows, { type: "prep_academy" }, TODAY_ISO).map((r) => r.first_name)).toEqual(["Eve"]);
  });
  it("parses URL filters and ignores unknown values", () => {
    expect(parseFilters({ type: "ncaa_d2", year: "2027", status: "active", followUp: "1", q: " ana " }))
      .toEqual({ q: "ana", type: "ncaa_d2", country: null, gradYear: 2027, status: "active", followUp: true });
    expect(parseFilters({ type: "ncaa_d9", year: "abc", status: "x" })).toMatchObject({ type: null, gradYear: null, status: null, followUp: false });
  });
  it("filter options list distinct countries and years", () => {
    const o = filterOptions(rows);
    expect(o.countries).toEqual(["Canada", "USA"]);
    expect(o.years).toEqual([2027, 2026, 2025]);
  });
});

describe("input validation", () => {
  const base = { firstName: "Alex", lastName: "Example" };
  it("requires a guardian contact while possibly a minor", () => {
    const year = new Date().getUTCFullYear();
    expect(alumniSchema.safeParse({ ...base, birthYear: year - 15 }).success).toBe(false);
    expect(alumniSchema.safeParse({ ...base, birthYear: year - 15, guardianName: "G", guardianPhone: "+41 79 000 00 00" }).success).toBe(true);
    expect(alumniSchema.safeParse({ ...base, birthYear: year - 25 }).success).toBe(true);
  });
  it("checks email, phone, links and birth year vs date", () => {
    expect(alumniSchema.safeParse({ ...base, email: "nope" }).success).toBe(false);
    expect(alumniSchema.safeParse({ ...base, phone: "call me" }).success).toBe(false);
    expect(alumniSchema.safeParse({ ...base, highlightUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(alumniSchema.safeParse({ ...base, birthYear: 2001, birthDate: "2002-01-01" }).success).toBe(false);
  });
  it("stamps consent dates when consent is ticked without a date", () => {
    const p = alumniSchema.parse({ ...base, contactConsent: true, showcaseConsent: true });
    expect(p.contactConsentOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.showcaseConsentOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("maps database errors to messages", () => {
    expect(alumniErrorKey("ALUMNI_GUARDIAN_REQUIRED")).toBe("alumni.errors.ALUMNI_GUARDIAN_REQUIRED");
    expect(alumniErrorKey("new row violates row-level security policy")).toBe("alumni.errors.forbidden");
    expect(alumniErrorKey('duplicate key value violates unique constraint "uniq_alumni_athlete"')).toBe("alumni.errors.alreadyAlumni");
  });
});

describe("CSV mapping", () => {
  it("maps NCAA division aliases", () => {
    for (const v of ["NCAA D2", "Division II", "D-II", "d2", "DII", "Div 2", "NCAA Division 2", "ncaa_d2"]) expect(parseInstitutionType(v), v).toBe("ncaa_d2");
    for (const v of ["NCAA D1", "Division I", "D-I", "DI", "D1"]) expect(parseInstitutionType(v), v).toBe("ncaa_d1");
    for (const v of ["NCAA D3", "Division III", "D-III", "D3"]) expect(parseInstitutionType(v), v).toBe("ncaa_d3");
  });
  it("maps the other institution types", () => {
    expect(parseInstitutionType("NAIA")).toBe("naia");
    expect(parseInstitutionType("JUCO")).toBe("junior_college");
    expect(parseInstitutionType("NJCAA Division I")).toBe("junior_college");
    expect(parseInstitutionType("High school")).toBe("high_school");
    expect(parseInstitutionType("Prep school")).toBe("prep_academy");
    expect(parseInstitutionType("Académie")).toBe("prep_academy");
    expect(parseInstitutionType("Professional")).toBe("pro_club");
    expect(parseInstitutionType("U SPORTS")).toBe("u_sports");
    expect(parseInstitutionType("Équipe nationale")).toBe("national_team");
    expect(parseInstitutionType("NCAA")).toBeNull(); // division unknown: ask
    expect(parseInstitutionType("Spaceship")).toBeNull();
  });
  it("maps scholarship, status and yes/no values in en / fr / de", () => {
    expect(parseScholarship("Full ride")).toBe("full");
    expect(parseScholarship("Walk-on")).toBe("walk_on");
    expect(parseScholarship("bourse partielle")).toBe("partial");
    expect(parseScholarship("keine")).toBe("none");
    expect(parsePlacementStatus("Turned pro")).toBe("turned_pro");
    expect(parsePlacementStatus("NLI")).toBe("signed");
    expect([parseBool("oui"), parseBool("Ja"), parseBool("no"), parseBool("maybe")]).toEqual([true, true, false, null]);
  });
  it("matches headers in English, French and German", () => {
    expect(["Prénom", "Nom", "Année de naissance", "Courriel", "Établissement", "Bourse", "Pays"].map(normaliseAlumniHeader))
      .toEqual(["first_name", "last_name", "birth_year", "email", "institution", "scholarship", "country"]);
    expect(["Vorname", "Nachname", "Jahrgang", "Telefon", "Schule", "Abschlussjahr", "Stipendium"].map(normaliseAlumniHeader))
      .toEqual(["first_name", "last_name", "birth_year", "phone", "institution", "graduation_year", "scholarship"]);
    expect(["First Name", "Last name", "Class of", "Division", "Conference", "E-mail"].map(normaliseAlumniHeader))
      .toEqual(["first_name", "last_name", "graduation_year", "institution_type", "league", "email"]);
  });

  it("builds an import plan: groups people, several placements, skips minors without guardian", () => {
    const csv = [
      "Prénom;Nom;Année de naissance;Email;Établissement;Type;Année diplôme;Bourse;Pays",
      "Alex;Example;2002;alex@example.test;Example State;NCAA D2;2026;full;USA",
      "Alex;Example;2002;ALEX@example.test;Example Prep;Prep;2020;none;USA",
      "Kim;Young;2012;;Synthetic High;High school;2030;;Switzerland",
      "Lee;Other;1999;not-an-email;Pro Club;Professional;;;Spain",
      ";Nofirst;2000;;X;;;;",
    ].join("\n");
    const plan = buildAlumniImportPlan(csv, "DMY", 2026);
    expect(plan.people).toBe(2);
    expect(plan.rows).toHaveLength(3);
    expect(plan.rows[0]!.placement).toMatchObject({ institution: "Example State", institution_type: "ncaa_d2", end_year: 2026, scholarship: "full", country: "USA" });
    expect(plan.rows[1]!.placement).toMatchObject({ institution_type: "prep_academy", scholarship: "none" });
    expect(personKey(plan.rows[0]!.person)).toBe(personKey(plan.rows[1]!.person));
    expect(plan.issues.some((i) => i.row === 4 && i.key === "guardianRequired")).toBe(true);
    expect(plan.issues.some((i) => i.row === 5 && i.field === "email" && i.key === "invalid")).toBe(true);
    expect(plan.rows[2]!.person.email).toBeNull();
    expect(plan.issues.some((i) => i.row === 6 && i.key === "required")).toBe(true);
  });
  it("reports missing name columns", () => {
    const plan = buildAlumniImportPlan("email,school\nx@example.test,U");
    expect(plan.issues.map((i) => i.key)).toContain("missingColumn");
    expect(plan.rows).toHaveLength(0);
  });
  it("the template parses with no issues; an export re-imports the same rows", () => {
    const t = buildAlumniImportPlan(ALUMNI_TEMPLATE_CSV, "DMY", 2026);
    expect(t.issues).toEqual([]);
    expect(t.rows[0]!.placement).toMatchObject({ institution_type: "ncaa_d1", end_year: 2028, scholarship: "full" });
    const csv = alumniToCsv([{
      first_name: "Alex", last_name: "Example", birth_year: 2002, email: "alex@example.test", status: "active", tags: ["a", "b"],
      contact_consent: true, contact_consent_on: "2026-01-01", whatsapp: false,
      placements: [{ institution: "Example State", institution_type: "ncaa_d2", end_year: 2026, scholarship: "partial", status: "enrolled", is_current: true, region: "Texas" }],
    }]);
    expect(csv.split("\n")[0]).toBe(ALUMNI_CSV_COLUMNS.join(","));
    const back = buildAlumniImportPlan(csv, "DMY", 2026);
    expect(back.issues).toEqual([]);
    expect(back.rows[0]!.person).toMatchObject({ first_name: "Alex", email: "alex@example.test", tags: ["a", "b"], contact_consent: true });
    expect(back.rows[0]!.placement).toMatchObject({ institution_type: "ncaa_d2", scholarship: "partial", region: "Texas", end_year: 2026 });
  });
  it("neutralises spreadsheet formulas in exports", () => {
    const csv = alumniToCsv([{ first_name: "=HYPERLINK(1)", last_name: "X", phone: "+41 79 000 00 00", placements: [] }]);
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain("+41 79 000 00 00");
  });
});

describe("module wiring", () => {
  it("alumni_network is an Academy feature gating the admin and coach pages", () => {
    expect(getFeature("alumni_network")).toMatchObject({ tier: "academy" });
    expect(featuresForPath("admin", "/admin/alumni/123")).toEqual(["alumni_network"]);
    expect(featuresForPath("coach", "/coach/alumni")).toEqual(["alumni_network"]);
  });
  it("the website placements section is opt-in and has a live block", () => {
    expect(PUBLIC_SECTIONS).toContain("placements");
    expect(DEFAULT_SECTIONS.placements).toBe(false);
    expect(LIVE_SOURCES).toContain("placements");
  });
});
