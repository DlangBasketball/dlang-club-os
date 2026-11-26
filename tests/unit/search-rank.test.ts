import { describe, expect, it } from "vitest";
import { areaForRoles, fold, hrefFor, kindsForRoles, pagesFor, rankHits, scoreMatch, type SearchHit, type SearchPage } from "@/lib/search/rank";

const hit = (over: Partial<SearchHit>): SearchHit => ({ kind: "athlete", id: "1", title: "x", subtitle: null, href: "/", score: 100, ...over });

describe("search ranking", () => {
  it("folds accents and case like public.search_fold", () => {
    expect(fold("Élodie Müller-Çağ")).toBe("elodie muller-cag");
    expect(fold("Strasse")).toBe("strasse");
  });

  it("scores prefix > word prefix > contains, shorter first within a tier", () => {
    expect(scoreMatch("mul", "Müller Lucas")).toBeGreaterThan(scoreMatch("mul", "Lucas Müller"));
    expect(scoreMatch("mul", "Lucas Müller")).toBeGreaterThan(scoreMatch("ull", "Lucas Müller"));
    expect(scoreMatch("x", "Xavier")).toBe(0);
    expect(scoreMatch("zz", "Lucas")).toBe(0);
    expect(scoreMatch("luc", "Lucas")).toBeGreaterThan(scoreMatch("luc", "Lucas Alexander"));
  });

  it("sorts, dedupes, filters disallowed kinds and caps", () => {
    const hits = [
      hit({ id: "a", score: 150, title: "B" }), hit({ id: "a", score: 150, title: "B" }),
      hit({ kind: "invoice", id: "i", score: 300 }), hit({ id: "b", score: 250, title: "A" }),
      ...Array.from({ length: 30 }, (_, i) => hit({ id: `z${i}`, score: 101 })),
    ];
    const ranked = rankHits(hits, ["athlete"], 5);
    expect(ranked).toHaveLength(5);
    expect(ranked[0].id).toBe("b");
    expect(ranked.some((h) => h.kind === "invoice")).toBe(false);
    expect(new Set(ranked.map((h) => h.id)).size).toBe(5);
  });
});

describe("search permissions", () => {
  it("parents get their own records, no coaches; coaches get no invoices or families", () => {
    expect(kindsForRoles(["parent"])).toEqual(["athlete", "family", "program", "camp", "team", "invoice", "product", "page"]);
    expect(kindsForRoles(["coach"])).not.toContain("invoice");
    expect(kindsForRoles(["coach"])).not.toContain("family");
    expect(kindsForRoles(["finance"])).toContain("invoice");
    expect(kindsForRoles([])).toEqual(["product", "page"]);
  });

  it("links into the user's own app", () => {
    expect(areaForRoles(["finance"])).toBe("admin");
    expect(areaForRoles(["coach", "parent"])).toBe("coach");
    expect(hrefFor("athlete", "abc", "admin")).toBe("/admin/athletes/abc");
    expect(hrefFor("athlete", "abc", "parent")).toBe("/parent/children/abc");
    expect(hrefFor("invoice", "i/1", "parent")).toBe("/parent/invoices/i%2F1");
    expect(hrefFor("product", "p", "coach")).toBe("/shop");
  });

  it("only offers pages of the user's roles", () => {
    const pages: SearchPage[] = [
      { href: "/admin/shop", labelKey: "nav.shop", keywords: "Shop", roles: ["admin", "finance"] },
      { href: "/shop", labelKey: "nav.shop", keywords: "Shop", roles: ["parent"] },
    ];
    const t = (k: string) => (k === "nav.shop" ? "Boutique" : k);
    expect(pagesFor(pages, ["parent"], "bout", t).map((h) => h.href)).toEqual(["/shop"]);
    expect(pagesFor(pages, ["finance"], "shop", t).map((h) => h.href)).toEqual(["/admin/shop"]);
    expect(pagesFor(pages, ["coach"], "bout", t)).toEqual([]);
  });
});
