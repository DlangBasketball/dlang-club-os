import { describe, expect, it } from "vitest";
import {
  blockSchema, cloneBlocks, imagePathsOf, imagesBelongTo, moveItem, newBlock, pageContentSchema, parsePageContent,
  translatableTexts, applyTexts, videoEmbed, youtubeId, vimeoId, BLOCK_TYPES,
} from "@/lib/site/blocks";
import { safeSiteHref, sanitizeRichText } from "@/lib/site/sanitize";
import {
  canonicalTag, isLanguageTag, nativeLanguageName, parseLanguageList, tagFromSlug, textDir, uiCatalogFor, uiFallbackChain,
} from "@/lib/site/languages";
import {
  isReservedPath, isSafeRedirectTarget, isValidSitePath, localizedPath, normalizeRequestPath, postSlugOf, resolveRedirect, slugify, splitLangPath,
} from "@/lib/site/paths";
import { breadcrumbLd, buildRobots, buildSitemap, hreflangAlternates, jsonLdString, sportsEventLd } from "@/lib/site/seo";
import { siteContrastChecks, siteCssVars, siteIsDark, templateColors } from "@/lib/site/theme";
import { contrastRatio } from "@/lib/tenant/theme";
import { DEFAULT_BRANDING } from "@/lib/tenant/defaults";
import { looksLikeSpam, siteFormSchema } from "@/lib/site/forms";
import { buildStarterSite } from "@/lib/site/starter";
import { buildNav, pageLanguages, type NavPage } from "@/lib/site/nav";

const ORG = "11111111-1111-4111-8111-111111111111";
const IMG = `${ORG}/gallery/photo-1.jpg`;

describe("site block schema", () => {
  it("accepts every block type created by newBlock (with required texts filled)", () => {
    for (const type of BLOCK_TYPES) {
      const b = newBlock(type) as Record<string, unknown>;
      if (type === "video") b.url = "https://youtu.be/dQw4w9WgXcQ";
      const r = blockSchema.safeParse(b);
      expect(r.success, `${type}: ${r.success ? "" : JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });

  it("refuses unknown types, bad ids, foreign image paths and unsafe links", () => {
    expect(blockSchema.safeParse({ id: "x1", type: "script", html: "" }).success).toBe(false);
    expect(blockSchema.safeParse({ id: "../x", type: "spacer" }).success).toBe(false);
    expect(blockSchema.safeParse({ id: "b1", type: "image", image: { path: "https://evil.example/x.jpg" } }).success).toBe(false);
    expect(blockSchema.safeParse({ id: "b1", type: "image", image: { path: `${ORG}/gallery/../../x.jpg` } }).success).toBe(false);
    const cta = { id: "b2", type: "cta", heading: "Join", ctas: [{ label: "Go", href: "javascript:alert(1)" }] };
    expect(blockSchema.safeParse(cta).success).toBe(false);
    expect(blockSchema.safeParse({ ...cta, ctas: [{ label: "Go", href: "//evil.example" }] }).success).toBe(false);
    expect(blockSchema.safeParse({ ...cta, ctas: [{ label: "Go", href: "/register/camps" }] }).success).toBe(true);
    expect(blockSchema.safeParse({ id: "v", type: "video", url: "https://evil.example/x.html" }).success).toBe(false);
    expect(blockSchema.safeParse({ id: "l", type: "live", source: "athletes" }).success).toBe(false);
  });

  it("sanitises rich text on parse", () => {
    const r = blockSchema.parse({ id: "r1", type: "richText", html: '<p onclick="x()">Hi<script>alert(1)</script></p>' });
    expect(r.type === "richText" && r.html).toBe("<p>Hi</p>");
  });

  it("keys page content by BCP 47 tags only", () => {
    expect(pageContentSchema.safeParse({ en: { title: "A", blocks: [] }, "de-CH": { title: "B", blocks: [] }, "pt-BR": { title: "C" } }).success).toBe(true);
    expect(pageContentSchema.safeParse({ english: { title: "A", blocks: [] } }).success).toBe(false);
    expect(pageContentSchema.safeParse({ pt_BR: { title: "A", blocks: [] } }).success).toBe(false);
  });

  it("parses stored content leniently (drops invalid blocks, keeps the rest)", () => {
    const c = parsePageContent({ en: { title: "Home", blocks: [{ id: "a", type: "spacer" }, { id: "b", type: "evil" }] }, bogus: { title: "x" } });
    expect(Object.keys(c)).toEqual(["en"]);
    expect(c.en!.blocks).toHaveLength(1);
  });

  it("collects image paths and checks ownership", () => {
    const content = { en: { title: "x", state: "ok" as const, blocks: [{ id: "a", type: "image" as const, image: { path: IMG, focalX: 50, focalY: 50 }, width: "wide" as const }] } };
    expect(imagePathsOf(content)).toEqual([IMG]);
    expect(imagesBelongTo(content, ORG)).toBe(true);
    expect(imagesBelongTo(content, "22222222-2222-4222-8222-222222222222")).toBe(false);
  });

  it("moves, clones and round-trips translatable texts", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 0, 9)).toEqual([1, 2, 3]);
    const blocks = [newBlock("spacer"), newBlock("richText")];
    const copy = cloneBlocks(blocks);
    expect(copy[0]!.id).not.toBe(blocks[0]!.id);
    const lang = { title: "Hello", state: "ok" as const, blocks: [{ id: "h", type: "hero" as const, headline: "Big", overlay: 40, height: "large" as const, align: "start" as const, ctas: [], image: null }] };
    const texts = translatableTexts(lang);
    expect(texts.map((x) => x.key)).toEqual(["title", "blocks.0.headline"]);
    const out = applyTexts(lang, { title: "Bonjour", "blocks.0.headline": "Grand", "blocks.0.overlay": "x" });
    expect(out.title).toBe("Bonjour");
    expect(out.blocks[0]!.headline).toBe("Grand");
    expect(out.blocks[0]!.overlay).toBe(40);
  });

  it("builds privacy-friendly video embeds", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(vimeoId("https://vimeo.com/123456789")).toBe("123456789");
    expect(videoEmbed("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({ kind: "youtube", embedUrl: expect.stringContaining("youtube-nocookie.com") });
    expect(videoEmbed("https://vimeo.com/123456789")).toMatchObject({ embedUrl: expect.stringContaining("dnt=1") });
    expect(videoEmbed("http://example.com/x.mp4")).toBeNull();
    expect(videoEmbed("https://cdn.example.com/x.mp4")).toMatchObject({ kind: "file" });
  });
});

describe("site rich-text sanitizer (XSS)", () => {
  const payloads = [
    "<img src=x onerror=alert(1)>",
    "<svg/onload=alert(1)>",
    "<a href=\"javascript:alert(1)\">x</a>",
    "<a href=\"java&#x09;script:alert(1)\">x</a>",
    "<a href=\"JaVaScRiPt:alert(1)\">x</a>",
    "<a href=\"data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==\">x</a>",
    "<a href=\"//evil.example\">x</a>",
    "<iframe src=\"https://evil.example\"></iframe>",
    "<style>body{display:none}</style>",
    "<p style=\"background:url(javascript:alert(1))\">x</p>",
    "<scr<script>ipt>alert(1)</script>",
    "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
    "<form action=/x><input name=a></form>",
    "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    "<object data=x></object><embed src=x>",
    "<details open ontoggle=alert(1)>",
    "<!--<img src=x onerror=alert(1)>-->",
    "<base href=\"https://evil.example/\">",
    "<a href=\"vbscript:msgbox(1)\">x</a>",
  ];
  it.each(payloads)("neutralises %s", (p) => {
    const out = sanitizeRichText(p);
    expect(out).not.toMatch(/<(script|img|svg|iframe|style|form|input|object|embed|details|base|math)\b/i);
    expect(out).not.toMatch(/\son\w+\s*=/i);
    expect(out).not.toMatch(/javascript:|vbscript:|data:text/i);
    expect(out).not.toMatch(/href="\/\//);
  });

  it("keeps formatting and safe links", () => {
    const out = sanitizeRichText('<h1>Title</h1><p><strong>Bold</strong> <a href="/camps">camps</a> <a href="https://club.example">site</a> <a href="mailto:a@b.ch">mail</a></p>');
    expect(out).toContain("<h2>Title</h2>");
    expect(out).toContain('<a href="/camps">camps</a>');
    expect(out).toContain('rel="noopener noreferrer nofollow" target="_blank"');
    expect(out).toContain('href="mailto:a@b.ch"');
  });

  it("classifies links", () => {
    expect(safeSiteHref("/x")).toEqual({ href: "/x", external: false });
    expect(safeSiteHref("#faq")).toEqual({ href: "#faq", external: false });
    expect(safeSiteHref("tel:+41 21 000 00 00")?.href).toBe("tel:+41210000000");
    expect(safeSiteHref("http://insecure.example")).toBeNull();
    expect(safeSiteHref("https://user:pw@x.example")).toBeNull();
  });
});

describe("site languages", () => {
  it("validates BCP 47 tags", () => {
    for (const ok of ["en", "fr", "de-CH", "pt-BR", "zh-Hant", "zh-Hant-TW", "es-419", "ar", "gsw"]) expect(isLanguageTag(ok), ok).toBe(true);
    for (const bad of ["", "e", "english", "EN", "de_CH", "de-ch", "pt-br", "de-CH-x", "12", "en-", "<script>"]) expect(isLanguageTag(bad), bad).toBe(false);
  });
  it("canonicalises loose input", () => {
    expect(canonicalTag("pt_br")).toBe("pt-BR");
    expect(canonicalTag("DE-ch")).toBe("de-CH");
    expect(canonicalTag("zh-hant")).toBe("zh-Hant");
    expect(canonicalTag("klingon-language")).toBeNull();
    expect(parseLanguageList("en, fr de-ch,xx_yy_zz, EN")).toEqual({ tags: ["en", "fr", "de-CH"], invalid: ["xx_yy_zz"] });
  });
  it("falls back to the nearest UI catalog", () => {
    const app = ["en", "de", "fr", "it", "es"];
    expect(uiFallbackChain("de-CH", app)).toEqual(["de", "en"]);
    expect(uiCatalogFor("de-CH", app)).toBe("de");
    expect(uiCatalogFor("fr-CA", app)).toBe("fr");
    expect(uiCatalogFor("pt-BR", app)).toBe("en");
    expect(uiCatalogFor("pt-BR", app, "fr")).toBe("fr");
    expect(uiFallbackChain("rm", app, "de-CH")).toEqual(["de", "en"]);
  });
  it("resolves text direction", () => {
    for (const rtl of ["ar", "he", "fa", "ur", "ar-EG", "pa-Arab"]) expect(textDir(rtl), rtl).toBe("rtl");
    for (const ltr of ["en", "de-CH", "fr", "az-Latn", "zh-Hant", null]) expect(textDir(ltr), String(ltr)).toBe("ltr");
  });
  it("names languages in their own language", () => {
    expect(nativeLanguageName("fr")).toMatch(/^Français/);
    expect(nativeLanguageName("de")).toBe("Deutsch");
  });
  it("maps URL prefixes to enabled tags", () => {
    expect(tagFromSlug("de-ch", ["en", "de-CH"])).toBe("de-CH");
    expect(tagFromSlug("it", ["en", "de-CH"])).toBeNull();
  });
});

describe("site paths and redirects", () => {
  it("guards reserved app paths", () => {
    for (const p of ["/admin", "/admin/site", "/login", "/register/camps", "/book/x", "/shop", "/club/donate", "/embed/x", "/api/public/v1/club", "/_next/static/x", "/sw.js", "/manifest.webmanifest", "/sitemap.xml", "/robots.txt", "/platform", "/.env"]) {
      expect(isReservedPath(p), p).toBe(true);
      expect(isValidSitePath(p), p).toBe(false);
    }
    for (const p of ["/", "/about-us", "/camps/summer-camps", "/pro-training", "/news", "/clubhouse", "/booking-info"]) {
      expect(isReservedPath(p), p).toBe(false);
      expect(isValidSitePath(p), p).toBe(true);
    }
    expect(isValidSitePath("/About")).toBe(false);
    expect(isValidSitePath("/a/b/c/d/e")).toBe(false);
  });
  it("normalises request paths", () => {
    expect(normalizeRequestPath("/About-Us/")).toBe("/about-us");
    expect(normalizeRequestPath("//camps//summer/?x=1")).toBe("/camps/summer");
    expect(normalizeRequestPath("/caf%C3%A9")).toBe("/caf%c3%a9");
    expect(normalizeRequestPath("/a/../admin")).toBeNull();
  });
  it("splits language prefixes", () => {
    expect(splitLangPath("/fr/about-us/", ["en", "fr", "de-CH"], "en")).toEqual({ lang: "fr", path: "/about-us", redundantPrefix: false });
    expect(splitLangPath("/de-ch", ["en", "fr", "de-CH"], "en")).toEqual({ lang: "de-CH", path: "/", redundantPrefix: false });
    expect(splitLangPath("/en/camps", ["en", "fr"], "en")).toEqual({ lang: "en", path: "/camps", redundantPrefix: true });
    expect(splitLangPath("/it/camps", ["en", "fr"], "en")).toEqual({ lang: "en", path: "/it/camps", redundantPrefix: false });
    expect(localizedPath("/", "fr", "en")).toBe("/fr");
    expect(localizedPath("/camps", "de-CH", "en")).toBe("/de-ch/camps");
    expect(localizedPath("/camps", "en", "en")).toBe("/camps");
  });
  it("resolves redirects safely", () => {
    const rules = [
      { from_path: "/old-about/", to_path: "/about-us", status_code: 301 },
      { from_path: "/promo", to_path: "https://club.example/x", status_code: 302 },
      { from_path: "/loop", to_path: "/loop/", status_code: 301 },
      { from_path: "/evil", to_path: "//evil.example", status_code: 301 },
    ];
    expect(resolveRedirect(rules, "/old-about")).toEqual({ to: "/about-us", status: 301 });
    expect(resolveRedirect(rules, "/OLD-ABOUT/")).toEqual({ to: "/about-us", status: 301 });
    expect(resolveRedirect(rules, "/promo")).toEqual({ to: "https://club.example/x", status: 302 });
    expect(resolveRedirect(rules, "/loop")).toBeNull();
    expect(resolveRedirect(rules, "/evil")).toBeNull();
    expect(isSafeRedirectTarget("javascript:alert(1)")).toBe(false);
    expect(isSafeRedirectTarget("http://x.example")).toBe(false);
  });
  it("slugifies and finds post slugs", () => {
    expect(slugify("Über uns & Team!")).toBe("uber-uns-and-team");
    expect(postSlugOf("/news/season-opener")).toBe("season-opener");
    expect(postSlugOf("/news")).toBeNull();
  });
});

describe("site SEO builders", () => {
  it("builds hreflang alternates with x-default", () => {
    const alts = hreflangAlternates("https://club.example/", "/camps", ["en", "fr", "de-CH"], "en");
    expect(alts).toEqual([
      { hreflang: "en", href: "https://club.example/camps" },
      { hreflang: "fr", href: "https://club.example/fr/camps" },
      { hreflang: "de-CH", href: "https://club.example/de-ch/camps" },
      { hreflang: "x-default", href: "https://club.example/camps" },
    ]);
    expect(hreflangAlternates("https://c.example", "/", ["fr"], "en").at(-1)).toEqual({ hreflang: "x-default", href: "https://c.example/fr" });
  });
  it("builds a sitemap with alternates and escapes URLs", () => {
    const xml = buildSitemap("https://club.example", [{ path: "/", languages: ["en", "fr"], lastmod: "2026-01-02T00:00:00Z" }, { path: "/a&b", languages: ["en"] }], "en");
    expect(xml).toContain("<loc>https://club.example/</loc>");
    expect(xml).toContain("<loc>https://club.example/fr</loc>");
    expect(xml).toContain('hreflang="x-default"');
    expect(xml).toContain("/a&amp;b");
    expect(xml).toContain("<lastmod>2026-01-02T00:00:00.000Z</lastmod>");
  });
  it("builds robots.txt", () => {
    expect(buildRobots("https://club.example", true)).toContain("Sitemap: https://club.example/sitemap.xml");
    expect(buildRobots(null, false)).toContain("Disallow: /admin");
    expect(buildRobots(null, false)).not.toContain("Sitemap");
  });
  it("serialises JSON-LD safely", () => {
    const s = jsonLdString({ name: "</script><script>alert(1)</script>" });
    expect(s).not.toContain("</script>");
    expect(sportsEventLd({ name: "Camp", startDate: "2026-07-01", organizer: "Club", offer: { price: 300, currency: "CHF", available: true } })).toMatchObject({ "@type": "SportsEvent", offers: { priceCurrency: "CHF" } });
    expect(breadcrumbLd([{ name: "Home", url: "https://c.example/" }])).toMatchObject({ itemListElement: [{ position: 1 }] });
  });
});

describe("site themes and contrast", () => {
  const branding = DEFAULT_BRANDING;
  it("derives template palettes from the club brand", () => {
    expect(templateColors("arena", branding.colors).background).toBe(branding.colors.background);
    expect(siteIsDark({ template: "arena", branding })).toBe(true);
    expect(siteIsDark({ template: "court", branding })).toBe(false);
    expect(siteIsDark({ template: "classic", branding })).toBe(false);
    expect(templateColors("court", branding.colors).primary).toBe(branding.colors.primary);
  });
  it("keeps body text AA on every template and corrects unreadable overrides", () => {
    for (const template of ["arena", "court", "classic"] as const) {
      const checks = siteContrastChecks({ template, branding });
      expect(checks[0]!.ok, template).toBe(true);
      expect(checks[2]!.ok, template).toBe(true);
    }
    const vars = siteCssVars({ template: "court", branding, palette: { primary: "#FFFF66" } });
    // Brand colour used as text on the light background is darkened to AA.
    expect(contrastRatio(vars["--brand-primary-text"]!, vars["--bg"]!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(vars["--brand-primary-contrast"]!, vars["--brand-primary"]!)).toBeGreaterThanOrEqual(4.5);
    const bad = siteContrastChecks({ template: "court", branding, palette: { text: "#EEEEEE" } });
    expect(bad[0]!.ok).toBe(false);
  });
  it("ignores invalid palette values", () => {
    const vars = siteCssVars({ template: "arena", branding, palette: { primary: "red; background:url(x)" } as never });
    expect(vars["--brand-primary"]).toBe(branding.colors.primary);
  });
});

describe("site forms", () => {
  it("validates the minimal form and catches spam", () => {
    const ok = siteFormSchema.safeParse({ kind: "contact", name: "Synthetic Person", email: "P@Example.test", message: "Hi", consent: true });
    expect(ok.success && ok.data.email).toBe("p@example.test");
    expect(siteFormSchema.safeParse({ kind: "contact", name: "x", email: "x@example.test", message: "Hi", consent: false }).success).toBe(false);
    expect(siteFormSchema.safeParse({ kind: "medical", name: "x", email: "x@example.test", message: "Hi", consent: true }).success).toBe(false);
    expect(looksLikeSpam({ website_url: "http://spam" })).toBe(true);
    expect(looksLikeSpam({ startedAt: Date.now() - 500 })).toBe(true);
    expect(looksLikeSpam({ startedAt: Date.now() - 10_000 })).toBe(false);
  });
});

describe("site navigation", () => {
  const pages: NavPage[] = [
    { id: "h", path: "/", parentId: null, position: 0, showInNav: false, titles: { en: "Home" } },
    { id: "a", path: "/about-us", parentId: null, position: 10, showInNav: true, titles: { en: "About", fr: "À propos" } },
    { id: "c", path: "/camps", parentId: null, position: 20, showInNav: true, titles: { en: "Camps" } },
    { id: "s", path: "/camps/summer", parentId: "c", position: 0, showInNav: false, titles: { en: "Summer" } },
    { id: "x", path: "/hidden", parentId: null, position: 5, showInNav: false, titles: { en: "Hidden" } },
  ];
  it("builds the menu from the page tree with localized links and current marks", () => {
    const nav = buildNav({ custom: [], pages, lang: "fr", defaultLang: "en", currentPath: "/camps/summer" });
    expect(nav.map((n) => n.label)).toEqual(["À propos", "Camps"]);
    expect(nav[0]!.href).toBe("/fr/about-us");
    expect(nav[1]).toMatchObject({ current: true, children: [{ label: "Summer", href: "/fr/camps/summer", current: true }] });
  });
  it("prefers a custom menu and keeps app links unprefixed", () => {
    const nav = buildNav({ custom: [{ label: { en: "Register", fr: "Inscription" }, href: "/register/camps" }, { label: { en: "Club" }, href: "/about-us" }], pages, lang: "fr", defaultLang: "en", currentPath: "/" });
    expect(nav).toEqual([
      { label: "Inscription", href: "/register/camps", current: false, children: undefined },
      { label: "Club", href: "/fr/about-us", current: false, children: undefined },
    ]);
  });
  it("lists a page's languages, default first", () => {
    expect(pageLanguages({ fr: "A", en: "B", de: "" }, ["fr", "en", "de"], "en")).toEqual(["en", "fr"]);
  });
});

describe("starter site", () => {
  it("builds every page in every language with valid blocks", () => {
    const pages = buildStarterSite({
      clubName: "Synthetic Club",
      coverPath: IMG,
      languages: ["en", "fr", "de-CH"],
      has: { camps: true, programs: true, teams: true, coaches: true, training: true, shop: false, campaigns: false, news: true, events: true },
      t: (lang, key) => `${lang}:${key}`,
      links: { camps: "/register/camps", book: "/book/synthetic", shop: "/shop", donate: "/club/donate", login: "/login" },
    });
    const paths = pages.map((p) => p.path);
    expect(paths).toContain("/");
    expect(paths).toContain("/camps");
    expect(paths).not.toContain("/merchandise");
    for (const p of pages) {
      expect(isValidSitePath(p.path), p.path).toBe(true);
      const parsed = pageContentSchema.safeParse(p.content);
      expect(parsed.success, `${p.path}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 2))}`).toBe(true);
      expect(Object.keys(p.content)).toEqual(["en", "fr", "de-CH"]);
    }
  });
});
