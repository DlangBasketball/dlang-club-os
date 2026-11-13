import { describe, expect, it } from "vitest";
import {
  activityForProgramKind, escapeHtml, extractMergeFields, pickTemplate, renderMerge, toHtmlParagraphs, unknownMergeFields,
} from "@/lib/contracts/merge";

describe("contract merge fields", () => {
  const data = {
    "athlete.first_name": "Léa",
    "guardian.full_name": "Anna Example",
    "programme.name": "U12 <Elite>",
    price: "CHF 450.00",
    "club.name": "Example Club",
  };

  it("fills known fields, tolerating whitespace in placeholders", () => {
    const r = renderMerge("Dear {{ guardian.full_name }}, {{athlete.first_name}} joins {{programme.name}} for {{price}}.", data);
    expect(r.output).toBe("Dear Anna Example, Léa joins U12 <Elite> for CHF 450.00.");
    expect(r.missing).toEqual([]);
    expect(r.unknown).toEqual([]);
  });

  it("reports missing and unknown fields and renders them empty", () => {
    const r = renderMerge("{{dates}} / {{athlete.shoe_size}} / {{club.name}}", data);
    expect(r.output).toBe(" /  / Example Club");
    expect(r.missing).toEqual(["dates"]);
    expect(r.unknown).toEqual(["athlete.shoe_size"]);
    expect(unknownMergeFields("{{price}} {{nope}} {{nope}}")).toEqual(["nope"]);
    expect(extractMergeFields("{{a.b}} {{price}} {{a.b}}")).toEqual(["a.b", "price"]);
  });

  it("escapes values AND template text in HTML mode", () => {
    const r = renderMerge("<b>{{programme.name}}</b> & co", { "programme.name": `"><script>alert(1)</script>` }, "html");
    expect(r.output).toBe("&lt;b&gt;&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;/b&gt; &amp; co");
    expect(r.output).not.toContain("<script>");
    expect(escapeHtml(`'`)).toBe("&#39;");
    expect(toHtmlParagraphs("a\nb\n\nc")).toBe("<p>a<br>b</p><p>c</p>");
  });

  it("is single-pass: a value containing a placeholder is never expanded", () => {
    const r = renderMerge("{{guardian.full_name}}", { "guardian.full_name": "{{price}}", price: "999" });
    expect(r.output).toBe("{{price}}");
  });

  it("strips control characters from values", () => {
    expect(renderMerge("{{price}}", { price: "1\u0000 2\u0007" }).output).toBe("1 2");
  });

  it("maps programme kinds and picks the most specific published auto-issue template", () => {
    expect(activityForProgramKind("camp")).toBe("camp");
    expect(activityForProgramKind("recurring_team")).toBe("team_season");
    expect(activityForProgramKind("clinic")).toBe("other");
    const base = { status: "published", autoIssue: true, updatedAt: "2026-01-01" };
    const tpls = [
      { id: "generic", activityType: "camp", programId: null, ...base },
      { id: "specific", activityType: "camp", programId: "p1", ...base },
      { id: "draft", activityType: "camp", programId: "p1", ...base, status: "draft", updatedAt: "2026-06-01" },
      { id: "manual", activityType: "team_season", programId: null, ...base, autoIssue: false },
    ];
    expect(pickTemplate(tpls, "camp", "p1")?.id).toBe("specific");
    expect(pickTemplate(tpls, "camp", "p2")?.id).toBe("generic");
    expect(pickTemplate(tpls, "team_season", null)).toBeNull();
  });
});
