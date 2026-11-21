import { describe, expect, it } from "vitest";
import {
  IMAGE_REF, detectLanguages, extractImageUrls, groupTranslations, htmlToBlocks, imageRefsOf, mapWpItem, pageLangFromItem,
  replaceImageRefs, sitePathFor, skipReasonFor, stripShortcodes, tokenize, type WpItem,
} from "@/lib/site/wp-convert";
import { blockSchema } from "@/lib/site/blocks";

// Synthetic WordPress payloads (no real club content).
const BUILDER_PAGE = `
<p><section class="bt_bb_section"><div class="bt_bb_background_image_holder" data-background_image_src="https://wp.example/wp-content/uploads/2025/06/hero.jpg" style="background-image: url(&#039;https://wp.example/wp-content/plugins/x/blank.gif&#039;);"></div>
<div class="row"><h1>Play with passion</h1><p>Train with purpose. Win with integrity.</p></div></section></p>
<h2>About us</h2>
<p>We offer the <strong>highest level</strong> coaching. <a href="https://wp.example/camps/">See camps</a> <a href="javascript:alert(1)">bad</a></p>
<p><img src="https://wp.example/wp-content/uploads/2025/06/team.jpg" alt="Team photo" srcset="https://wp.example/wp-content/uploads/2025/06/team-300x200.jpg 300w, https://wp.example/wp-content/uploads/2025/06/team-1024x683.jpg 1024w"></p>
<script>alert("x")</script>
<div class="gallery"><img src="https://wp.example/u/g1.jpg"><img src="https://wp.example/u/g2.jpg"><img src="https://wp.example/u/g3.png"><img src="https://wp.example/u/g4.webp"></div>
<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
[contact-form-7 id="12" title="Contact"]
<style>.x{}</style>
<p>Long text ${"lorem ipsum ".repeat(300)}</p>
`;

describe("WordPress HTML -> blocks", () => {
  it("strips shortcodes", () => {
    expect(stripShortcodes('a [gallery ids="1,2"] b [/gallery] c [x/]')).toBe("a   b   c  ");
  });

  it("finds images in img, srcset and builder background attributes (https only, no placeholders)", () => {
    const urls = extractImageUrls(BUILDER_PAGE);
    expect(urls).toContain("https://wp.example/wp-content/uploads/2025/06/hero.jpg");
    expect(urls).toContain("https://wp.example/wp-content/uploads/2025/06/team-1024x683.jpg");
    expect(urls.some((u) => u.includes("blank.gif"))).toBe(false);
    expect(extractImageUrls('<img src="http://wp.example/a.jpg"><img src="data:image/png;base64,xx"><img src="/b.jpg">', "https://wp.example/page/")).toEqual([
      "https://wp.example/a.jpg", "https://wp.example/b.jpg",
    ]);
  });

  it("tokenises builder wrappers instead of swallowing them", () => {
    const tokens = tokenize(BUILDER_PAGE);
    expect(tokens.find((t) => t.t === "heading")).toMatchObject({ text: "Play with passion" });
    expect(tokens.some((t) => t.t === "video")).toBe(true);
    expect(JSON.stringify(tokens)).not.toContain("alert(\"x\")");
  });

  it("converts a page-builder page into hero, text, two-column, gallery and video blocks", () => {
    const blocks = htmlToBlocks(BUILDER_PAGE, { title: "Home" });
    const types = blocks.map((b) => b.type);
    expect(types[0]).toBe("hero");
    expect(blocks[0]).toMatchObject({ headline: "Play with passion", subheadline: "Train with purpose. Win with integrity." });
    expect(types).toContain("twoColumn");
    expect(types).toContain("gallery");
    expect(types).toContain("video");
    expect(types).toContain("richText");
    const html = JSON.stringify(blocks);
    expect(html).not.toMatch(/javascript:|<script|contact-form-7|onerror/);
    expect(html).toContain('href=\\"https://wp.example/camps/\\"');
    const gallery = blocks.find((b) => b.type === "gallery");
    expect(gallery && gallery.type === "gallery" && gallery.images).toHaveLength(4);
  });

  it("swaps image placeholders for library paths and drops the ones not imported", () => {
    const blocks = htmlToBlocks(BUILDER_PAGE, { title: "Home" });
    const refs = imageRefsOf(blocks);
    expect(refs.length).toBeGreaterThanOrEqual(6);
    const org = "11111111-1111-4111-8111-111111111111";
    const map = new Map(refs.filter((r) => !r.includes("g4")).map((r, i) => [r, `${org}/gallery/imp-${i}.jpg`]));
    const out = replaceImageRefs(blocks, map);
    expect(JSON.stringify(out)).not.toContain(IMAGE_REF);
    for (const b of out) expect(blockSchema.safeParse(b).success, JSON.stringify(b).slice(0, 200)).toBe(true);
    const gallery = out.find((b) => b.type === "gallery");
    expect(gallery && gallery.type === "gallery" && gallery.images).toHaveLength(3);
    // Nothing imported at all: image-only blocks disappear, hero keeps its text.
    const none = replaceImageRefs(blocks, new Map());
    expect(none.some((b) => b.type === "gallery" || b.type === "image")).toBe(false);
    expect(none[0]).toMatchObject({ type: "hero", image: null });
  });
});

describe("WordPress skip rules", () => {
  it.each([
    ["cart", "<p>[woocommerce_cart]</p>", "plugin_page"],
    ["checkout", "", "plugin_page"],
    ["my-account", "<p>[woocommerce_my_account]</p>", "plugin_page"],
    ["wpbc-appointment-booking", "<p>[booking]</p>", "plugin_page"],
    ["membership-levels", "<p>[pmpro_levels]</p>", "plugin_page"],
    ["page-not-found", "<p>Oops</p>", "plugin_page"],
    ["under-construction", "<p>Soon</p>", "plugin_page"],
    ["news-old", "<p>Old</p>", "test_page"],
    ["gym-schedule", '<p>[timetable id="3"]</p>', "shortcode_only"],
    ["blank", "<div> </div>", "empty"],
  ])("skips %s", (slug, html, reason) => {
    expect(skipReasonFor({ slug, html })).toBe(reason);
  });
  it("keeps real pages", () => {
    expect(skipReasonFor({ slug: "about-us", html: "<h2>About</h2><p>We are a club.</p>" })).toBeNull();
    expect(skipReasonFor({ slug: "gallery", html: '<img src="https://wp.example/a.jpg">' })).toBeNull();
    expect(skipReasonFor({ slug: "camps", html: '<p>Our camps [button url="/x"]Book[/button] run every season and are great fun.</p>' })).toBeNull();
    expect(skipReasonFor({ slug: "about-us", status: "draft", html: "<p>x</p>" })).toBe("not_published");
  });
});

describe("WordPress items, paths and languages", () => {
  const raw = (id: number, slug: string, link: string, extra: Record<string, unknown> = {}) => ({
    id, slug, link, parent: 0, menu_order: 0, status: "publish", title: { rendered: `T ${slug}` }, content: { rendered: `<p>Body ${slug}</p>` },
    excerpt: { rendered: "" }, featured_media: 0, date_gmt: "2026-01-01T10:00:00", modified_gmt: "2026-01-02T10:00:00", ...extra,
  });

  it("detects WPML / Polylang languages from hreflang links", () => {
    const home = '<link rel="alternate" hreflang="en" href="https://wp.example/"><link rel="alternate" hreflang="fr" href="https://wp.example/fr/"><link rel="alternate" hreflang="x-default" href="https://wp.example/">';
    expect(detectLanguages(home, "https://wp.example")).toEqual([{ tag: "en", prefix: null }, { tag: "fr", prefix: "fr" }]);
  });

  it("maps items and strips language prefixes", () => {
    const fr = mapWpItem(raw(22, "a-propos", "https://wp.example/fr/a-propos/", { featured_media: 7 }), { langPrefixes: [{ tag: "fr", prefix: "fr" }] });
    expect(fr).toMatchObject({ sourceId: "22", path: "/a-propos", lang: "fr", featuredMedia: "7", date: "2026-01-01T10:00:00Z" });
    const poly = mapWpItem(raw(5, "about", "https://wp.example/about/", { lang: "en", translations: { en: 5, fr: 22 } }));
    expect(poly?.translations).toEqual({ en: "5", fr: "22" });
    expect(mapWpItem({ id: "x" })).toBeNull();
  });

  it("keeps old paths, renames reserved ones and avoids clashes", () => {
    expect(sitePathFor({ path: "/about-us", slug: "about-us" }, new Set())).toEqual({ path: "/about-us", changed: false });
    expect(sitePathFor({ path: "/club", slug: "club" }, new Set())).toEqual({ path: "/club-info", changed: true });
    expect(sitePathFor({ path: "/shop", slug: "shop" }, new Set())).toEqual({ path: "/shop-info", changed: true });
    expect(sitePathFor({ path: "/camps", slug: "camps" }, new Set(["/camps"]))).toEqual({ path: "/camps-2", changed: true });
    expect(sitePathFor({ path: "/fr", slug: "fr" }, new Set(), ["fr"])).toEqual({ path: "/fr-info", changed: true });
  });

  it("groups translations by link, featured image or slug; reports the rest", () => {
    const items = [
      mapWpItem(raw(1, "about", "https://wp.example/about/", { featured_media: 9 }))!,
      mapWpItem(raw(2, "camps", "https://wp.example/camps/"))!,
      mapWpItem(raw(21, "a-propos", "https://wp.example/fr/a-propos/", { featured_media: 9 }), { langPrefixes: [{ tag: "fr", prefix: "fr" }] })!,
      mapWpItem(raw(22, "camps", "https://wp.example/fr/camps/"), { langPrefixes: [{ tag: "fr", prefix: "fr" }] })!,
      mapWpItem(raw(23, "orphelin", "https://wp.example/fr/orphelin/"), { langPrefixes: [{ tag: "fr", prefix: "fr" }] })!,
    ] as WpItem[];
    const { groups, unmatched } = groupTranslations(items, "en");
    expect(groups.find((g) => g.main.sourceId === "1")!.translations.fr!.sourceId).toBe("21");
    expect(groups.find((g) => g.main.sourceId === "2")!.translations.fr!.sourceId).toBe("22");
    expect(unmatched.map((u) => u.sourceId)).toEqual(["23"]);
  });

  it("builds a page language with SEO description", () => {
    const it = mapWpItem(raw(3, "faq", "https://wp.example/faq/"))!;
    const lang = pageLangFromItem(it, null);
    expect(lang.title).toBe("T faq");
    expect(lang.metaDescription).toBe("Body faq");
    expect(lang.blocks[0]).toMatchObject({ type: "richText" });
  });
});
