import { describe, expect, it } from "vitest";
import products from "./fixtures/website/woo-products.json";
import { mapWooProduct, type MappedProduct } from "@/lib/website/importers/mappers";
import { isMerchandiseByDefault, isNonMerchCategory } from "@/lib/website/importers/product-filter";
import {
  brandWords, editDistance, gameTitle, noiseWords, normalizeName, suggestAppTeam, teamScore, type AppTeamOption,
} from "@/lib/website/importers/team-match";
import { isValidTeamSlug, slugifyText } from "@/lib/teams/slug";

// Synthetic names only (they mirror the shape of a real club site; nothing is hard-coded in the matcher).
const website = [
  "U18 Unity – National",
  "U14 Unity – AVB",
  "U16 Unity – CSJC",
  "U20 Unity - Elite",
  "Rival Lions U18",
  "Harbour Hawks",
];
const club = website.slice(0, 4);
const app: AppTeamOption[] = [
  { id: "t-u18n", name: "U18 National" },
  { id: "t-u14a", name: "U14 AVB" },
  { id: "t-u16c", name: "U16 CJSC" },
  { id: "t-u16a", name: "U16 AVB" },
  { id: "t-u12", name: "U12 Minis" },
];
const noise = noiseWords(website, club, app, "Synthetic Basketball Club");
const pick = (name: string, teams = app, n = noise) => suggestAppTeam(name, teams, n);

describe("team matcher", () => {
  it("normalises accents, dashes and age tokens", () => {
    expect(normalizeName("U-18 Équipe – Fémin.")).toBe("u18 equipe femin");
    expect(normalizeName("18U Elite")).toBe("u18 elite");
    expect(normalizeName("u 14 AVB")).toBe("u14 avb");
  });

  it("finds brand words shared by most of the club's team names", () => {
    expect([...brandWords(club)]).toEqual(["unity"]);
    expect(brandWords(["U18 Unity"]).size).toBe(0); // one name: no frequency signal
    expect(noise.has("unity")).toBe(true);
    expect(noise.has("national")).toBe(false);
  });

  it("suggests the existing app team for the examples", () => {
    expect(pick("U18 Unity – National")).toBe("t-u18n");
    expect(pick("U14 Unity – AVB")).toBe("t-u14a");
    expect(pick("U16 Unity – CSJC")).toBe("t-u16c"); // CSJC ~ CJSC: one transposition
  });

  it("works with a single ticked team too (shared prefix unknown to the app)", () => {
    const n = noiseWords(website, ["U18 Unity – National"], app, null);
    expect(pick("U18 Unity – National", app, n)).toBe("t-u18n");
  });

  it("never matches a different age group", () => {
    expect(teamScore("U18 Unity – National", "U16 National", noise)).toBe(-1);
    expect(pick("U20 Unity - Elite")).toBeNull();
  });

  it("leaves the choice empty without a confident match", () => {
    expect(pick("U14 Unity – CSJC")).toBeNull(); // U14 exists only as AVB
    expect(pick("Harbour Hawks")).toBeNull();
    expect(pick("U16 Unity")).toBeNull(); // two U16 teams: ambiguous
    expect(pick("U18 Unity – National", [])).toBeNull();
  });

  it("does not treat short or numeric words as typos", () => {
    expect(editDistance("csjc", "cjsc")).toBe(1);
    expect(editDistance("avb", "avc")).toBe(1);
    expect(pick("U14 AVC", app, new Set())).toBeNull(); // 3 letters: exact only
    expect(teamScore("U12 Team 1", "U12 Team 2", new Set())).toBeLessThan(1);
  });

  it("refuses ties between equally good app teams", () => {
    const dup: AppTeamOption[] = [{ id: "a", name: "U18 National" }, { id: "b", name: "U18 – National" }];
    expect(pick("U18 Unity – National", dup)).toBeNull();
  });

  it("titles games with the app team name", () => {
    expect(gameTitle("U18 National", "Rival Lions U18")).toBe("U18 National – Rival Lions U18");
    expect(gameTitle("U18 National", null)).toBe("U18 National");
  });
});

describe("merchandise rule", () => {
  it("flags camp / programme / service / course categories in any language", () => {
    for (const c of ["Camps", "Summer camp 2026", "Programmes", "Program", "Services", "Training", "Classes", "Courses",
      "Cours de basket", "Trainingslager", "Sommercamp", "Lager", "Stage d'été", "Kurse"]) {
      expect(isNonMerchCategory(c), c).toBe(true);
    }
    for (const c of ["Merch", "Apparel & Merch", "Vêtements", "Bekleidung", "Accessories", "Balls", "Fan shop"]) {
      expect(isNonMerchCategory(c), c).toBe(false);
    }
  });

  it("pre-selects only priced merchandise", () => {
    expect(isMerchandiseByDefault({ price: 55, categories: ["Apparel"] })).toBe(true);
    expect(isMerchandiseByDefault({ price: 55, categories: [] })).toBe(true);
    expect(isMerchandiseByDefault({ price: 0, categories: ["Apparel"] })).toBe(false);
    expect(isMerchandiseByDefault({ price: 390, categories: ["Merch", "Camps"] })).toBe(false);
  });

  it("maps every WooCommerce category", () => {
    const p = products.map(mapWooProduct).filter((x): x is MappedProduct => !!x);
    expect(p[0]!.categories).toEqual(["Apparel & Merch"]);
    expect(p[0]!.category).toBe("Apparel & Merch");
    expect(p[1]!.categories).toEqual([]);
  });
});

describe("team slugs", () => {
  it("slugifies like the database function", () => {
    expect(slugifyText("U18 Unity – National")).toBe("u18-unity-national");
    expect(slugifyText("U16/U18 Mädchen")).toBe("u16-u18-madchen");
    expect(slugifyText("  Équipe Fémin. ÆØ Straße ")).toBe("equipe-femin-aeo-strasse");
    expect(slugifyText("///")).toBe("");
    const long = slugifyText("ab-".repeat(40));
    expect(long.length).toBeLessThanOrEqual(64);
    expect(isValidTeamSlug(long)).toBe(true);
  });

  it("validates manual slugs", () => {
    expect(isValidTeamSlug("u18-national")).toBe(true);
    expect(isValidTeamSlug("-u18")).toBe(false);
    expect(isValidTeamSlug("U18")).toBe(false);
    expect(isValidTeamSlug("u18_national")).toBe(false);
    expect(isValidTeamSlug("a".repeat(65))).toBe(false);
  });
});
