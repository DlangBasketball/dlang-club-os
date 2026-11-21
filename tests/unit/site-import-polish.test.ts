import { describe, expect, it } from "vitest";
import {
  absoluteImageUrl, extractLeadingHero, groupTranslations, hasLiveFor, htmlToBlocks, liveBlocksFor, mapWpItem, suggestLive, type WpItem,
} from "@/lib/site/wp-convert";
import {
  detectColors, detectFonts, extractContact, extractHeaderMenu, extractLogoUrl, extractSocialLinks, fontChoice, googleFontFamilies, isBrandish,
  makeMenuResolver, menuFromRest, mergeMenus, pickMenuLocation,
} from "@/lib/site/wp-theme";
import { closestSiteFont, siteFontByFamily } from "@/lib/site/fonts";
import { contentHash, editedSinceImport, rerunAction, stableStringify } from "@/lib/site/wp-rerun";
import { buildNav, cleanNav, indentNavItem, outdentNavItem, switcherLanguages } from "@/lib/site/nav";
import { cleanFonts, siteCssVars, siteFontsHref } from "@/lib/site/theme";
import { blockSchema, parsePageContent } from "@/lib/site/blocks";
import { DEFAULT_BRANDING } from "@/lib/tenant/defaults";

// Synthetic WordPress markup modelled on Elementor / Bold Builder / WPML output.
// No real club content.

const HEADER = `
<!doctype html><html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;700&#038;family=Inter:wght@400&#038;display=swap">
<style id="theme-inline-css">
@font-face{font-family:"ClubIcons";src:url("https://wp.example/wp-content/themes/t/icons/ClubIcons.woff")}
:root{--e-global-color-primary:#B01E2D;--e-global-color-secondary:#1D4E89;--e-global-color-text:#333333;
--e-global-typography-primary-font-family:"Barlow Condensed";--e-global-typography-text-font-family:"Inter";
--e-global-typography-primary-text-transform:uppercase}
.page-id-77{--e-global-color-primary:#00FF00}
.btn{background-color:#B01E2D}
</style>
</head><body>
<header id="masthead" class="site-header">
  <a href="https://wp.example/" class="custom-logo-link"><img class="sticky-logo" src="https://wp.example/wp-content/uploads/logo-small.png" alt=""><img class="custom-logo" src="https://wp.example/wp-content/uploads/club-logo.png" alt="Club"></a>
  <nav class="elementor-nav-menu--main" aria-label="Menu">
    <ul id="menu-main" class="elementor-nav-menu">
      <li class="menu-item menu-item-home current-menu-item"><a href="https://wp.example/">Home</a></li>
      <li class="menu-item menu-item-has-children"><a href="#">About</a>
        <ul class="sub-menu">
          <li class="menu-item"><a href="https://wp.example/about-us/">Our club</a></li>
          <li class="menu-item"><a href="https://wp.example/history/">History</a></li>
          <li class="menu-item"><a href="#">Coming soon</a></li>
        </ul>
      </li>
      <li class="menu-item"><a href="https://wp.example/camps/">Camps</a></li>
      <li class="menu-item"><a href="https://wp.example/shop/">Shop</a></li>
      <li class="menu-item"><a href="https://partner.example/tickets">Tickets</a></li>
      <li class="menu-item"><a href="https://wp.example/old-page-not-imported/">Old</a></li>
      <li class="menu-item wpml-ls-item wpml-ls-menu-item"><a href="https://wp.example/fr/"><img class="wpml-ls-flag" src="x.svg" alt=""><span>Français</span></a></li>
    </ul>
  </nav>
  <div class="header-social">
    <a href="https://www.facebook.com/syntheticclub/">f</a>
    <a href="https://twitter.com/syntheticclub">t</a>
    <a href="https://www.instagram.com/syntheticclub/?hl=en">i</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
  </div>
</header>
<main><h1>Welcome</h1></main>
<footer id="colophon">
  <ul id="menu-footer" class="menu"><li><a href="https://wp.example/imprint/">Imprint</a></li></ul>
  <p>Contact</p>
  <a href="tel:" title="021 555 00 00"><span>021 555 00 00</span></a>
  <a href="mailto:hello@club.example">hello@club.example</a>
  <div>Synthetic Road 12, 1000 Townsville</div>
  <a href="https://www.youtube.com/@syntheticclub">yt</a>
  <a href="https://www.instagram.com/p/ABC123/">post</a>
  <p>© 2025 Synthetic Club. All rights reserved.</p>
</footer>
</body></html>`;

const HEADER_FR = HEADER
  .replace(">Home<", ">Accueil<")
  .replace(">About<", ">À propos<")
  .replace(">Our club<", ">Notre club<")
  .replace(">History<", ">Histoire<")
  .replace(">Camps<", ">Stages<")
  .replace(/https:\/\/wp\.example\/(about-us|history|camps)\//g, "https://wp.example/fr/$1/");

describe("header menu", () => {
  it("reads the main menu with sub-menus and skips the language switcher", () => {
    const menu = extractHeaderMenu(HEADER);
    expect(menu.map((m) => m.label)).toEqual(["Home", "About", "Camps", "Shop", "Tickets", "Old"]);
    expect(menu[1]!.url).toBe("#");
    expect(menu[1]!.children.map((c) => c.label)).toEqual(["Our club", "History", "Coming soon"]);
    expect(menu.some((m) => /Français/.test(m.label))).toBe(false);
  });

  it("reads a public menus REST payload (plugin) when the site exposes one", () => {
    expect(pickMenuLocation({ footer: {}, "primary-menu": {} })).toBe("primary-menu");
    expect(pickMenuLocation([])).toBeNull();
    const items = menuFromRest({
      items: [
        { title: "Home", url: "https://wp.example/" },
        { title: "Club &amp; Teams", url: "#", child_items: [{ title: "U18", url: "https://wp.example/u18/" }] },
        { title: "English", url: "https://wp.example/", type: "wpml_ls_menu_item" },
        { title: "" },
      ],
    });
    expect(items).toEqual([
      { label: "Home", url: "https://wp.example/", children: [] },
      { label: "Club & Teams", url: "#", children: [{ label: "U18", url: "https://wp.example/u18/", children: [] }] },
    ]);
  });

  it("falls back to the first <nav> list and returns [] without one", () => {
    expect(extractHeaderMenu(`<nav><ul><li><a href="/a">A</a></li></ul></nav>`).map((m) => m.label)).toEqual(["A"]);
    expect(extractHeaderMenu("<p>no menu</p>")).toEqual([]);
  });

  it("maps links to imported pages, keeps external https, sends shop links to the club shop and drops the rest", () => {
    const resolve = makeMenuResolver({
      baseUrl: "https://wp.example",
      prefixes: [{ tag: "en", prefix: null }, { tag: "fr", prefix: "fr" }],
      pathMap: new Map([["/about-us", "/about-us"], ["/history", "/history"], ["/camps", "/camps-info"]]),
    });
    expect(resolve("https://wp.example/")).toBe("/");
    expect(resolve("https://wp.example/camps/")).toBe("/camps-info");
    expect(resolve("https://www.wp.example/fr/camps/")).toBe("/camps-info");
    expect(resolve("https://wp.example/shop/product/x/")).toBe("/shop");
    expect(resolve("http://partner.example/tickets")).toBe("https://partner.example/tickets");
    expect(resolve("https://wp.example/old-page-not-imported/")).toBeNull();
    expect(resolve("javascript:alert(1)")).toBeNull();
  });

  it("merges the per-language menus into one menu with labels per language", () => {
    const resolve = makeMenuResolver({
      baseUrl: "https://wp.example",
      prefixes: [{ tag: "en", prefix: null }, { tag: "fr", prefix: "fr" }],
      pathMap: new Map([["/about-us", "/about-us"], ["/history", "/history"], ["/camps", "/camps"]]),
    });
    const nav = mergeMenus([{ lang: "en", items: extractHeaderMenu(HEADER) }, { lang: "fr", items: extractHeaderMenu(HEADER_FR) }], "en", resolve);
    expect(nav.map((n) => n.label.en)).toEqual(["Home", "About", "Camps", "Shop", "Tickets"]);
    expect(nav[0]).toEqual({ label: { en: "Home", fr: "Accueil" }, href: "/" });
    expect(nav[1]!.href).toBe("");
    expect(nav[1]!.label.fr).toBe("À propos");
    expect(nav[1]!.children).toEqual([
      { label: { en: "Our club", fr: "Notre club" }, href: "/about-us" },
      { label: { en: "History", fr: "Histoire" }, href: "/history" },
    ]);
    expect(nav[2]!.label).toEqual({ en: "Camps", fr: "Stages" });
  });
});

describe("logo, fonts, colours, social, contact", () => {
  it("finds the header logo (custom-logo first, sticky / mobile copies skipped)", () => {
    expect(extractLogoUrl(HEADER, "https://wp.example/", absoluteImageUrl)).toBe("https://wp.example/wp-content/uploads/club-logo.png");
    expect(extractLogoUrl(`<header><img class="logo-img" src="/wp-content/uploads/a-logo.webp"></header>`, "https://wp.example/", absoluteImageUrl)).toBe("https://wp.example/wp-content/uploads/a-logo.webp");
    expect(extractLogoUrl(`<header><img src="/hero.jpg"></header>`, "https://wp.example/", absoluteImageUrl)).toBeNull();
  });

  it("detects theme fonts from Elementor globals and Google Fonts, ignoring icon fonts", () => {
    const f = detectFonts(HEADER);
    expect(f.display).toBe("Barlow Condensed");
    expect(f.body).toBe("Inter");
    expect(f.uppercase).toBe(true);
    expect(f.families).not.toContain("ClubIcons");
    expect(fontChoice(f)).toEqual({ display: "Barlow Condensed", ui: "Inter", uppercase: true });
  });

  it("detects classic theme font variables and maps them to the closest curated font", () => {
    const html = `<link href='//fonts.googleapis.com/css2?family=Exo:wght@400&#038;family=Antonio:wght@700' rel='stylesheet'>
      <style>:root{--body-font:Exo; --heading-font:Antonio; --heading-text-transform:uppercase}</style>`;
    expect(googleFontFamilies(html)).toEqual(["Exo", "Antonio"]);
    expect(fontChoice(detectFonts(html))).toEqual({ display: "Antonio", ui: "Exo 2", uppercase: true });
  });

  it("closest curated font", () => {
    expect(closestSiteFont("Oswald", "display")?.family).toBe("Oswald");
    expect(closestSiteFont("League Gothic", "display")?.family).toBe("Oswald");
    expect(closestSiteFont("Roboto Condensed", "display")?.family).toBe("Barlow Condensed");
    expect(closestSiteFont("Poppins", "body")?.family).toBe("Montserrat");
    expect(closestSiteFont("Bebas Neue", "body")).toBeNull();
    expect(closestSiteFont("Playfair Display", "display")).toBeNull();
    expect(closestSiteFont("Some Unknown Sans", "body")?.family).toBe("Inter");
  });

  it("detects brand colours (theme globals first, page-specific overrides and greys ignored)", () => {
    expect(detectColors(HEADER)).toEqual({ primary: "#B01E2D", accent: "#1D4E89" });
    expect(detectColors(`<style>.page-id-3{--accent-color:#00FF00} :root{--accent-color:#980122; --alternate-color: rgb(29, 66, 138)}</style>`)).toEqual({ primary: "#980122", accent: "#1D428A" });
    // No variables: the most used saturated button colour.
    expect(detectColors(`<style>.btn{background:#0055AA} a.button{background-color:#0055AA} body{color:#222222}</style>`).primary).toBe("#0055AA");
    expect(detectColors(`<style>body{color:#222;background:#fff}</style>`)).toEqual({ primary: null, accent: null });
    expect(isBrandish("#777777")).toBe(false);
    expect(isBrandish("#B01E2D")).toBe(true);
  });

  it("finds social profiles (not share links or posts)", () => {
    expect(extractSocialLinks(HEADER)).toEqual({
      facebook: "https://www.facebook.com/syntheticclub",
      x: "https://twitter.com/syntheticclub",
      instagram: "https://www.instagram.com/syntheticclub",
      youtube: "https://www.youtube.com/@syntheticclub",
    });
  });

  it("finds contact email, phone (even on an empty tel: link) and postal address in the footer", () => {
    expect(extractContact(HEADER)).toEqual({ email: "hello@club.example", phone: "021 555 00 00", address: "Synthetic Road 12, 1000 Townsville" });
    expect(extractContact(`<footer><address>Halle 3<br>8000 Zürich</address><a href="tel:+41445550000">Call</a></footer>`)).toEqual({ email: null, phone: "+41445550000", address: "Halle 3 8000 Zürich" });
  });
});

// ---------------------------------------------------------------------------

const ELEMENTOR_SLIDES = `
<div class="elementor-element elementor-widget-slides"><div class="elementor-swiper"><div class="elementor-slides-wrapper elementor-main-swiper swiper" dir="ltr">
 <div class="swiper-wrapper elementor-slides">
  <div class="elementor-repeater-item-a1 swiper-slide"><div class="swiper-slide-bg" style="background-image:url(https://wp.example/wp-content/uploads/slide-1.jpg)"></div>
   <a class="swiper-slide-inner" href="https://wp.example/camps/"><div class="swiper-slide-contents">
     <div class="elementor-slide-heading">Summer <strong>camps</strong> are open</div>
     <div class="elementor-slide-description">Book a week of basketball.</div>
     <div class="elementor-button elementor-slide-button">Register now</div>
   </div></a></div>
  <div class="elementor-repeater-item-a2 swiper-slide"><div class="swiper-slide-bg" style="background-image:url(&#039;https://wp.example/wp-content/uploads/slide-2.webp&#039;)"></div>
   <div class="swiper-slide-inner"><div class="swiper-slide-contents">
     <div class="elementor-slide-heading">Train with us</div>
     <a class="elementor-button" href="https://wp.example/training/">Book a session</a>
   </div></div></div>
  <div class="elementor-repeater-item-a1 swiper-slide swiper-slide-duplicate"><div class="swiper-slide-bg" style="background-image:url(https://wp.example/wp-content/uploads/slide-1.jpg)"></div></div>
 </div></div></div></div>
<h2>Our club</h2><p>Since 1990 we develop young players.</p>`;

const BOLD_SLIDER = `
<p><section class="bt_bb_section"><div class="bt_bb_content_slider bt_hero_slider"><div class="slick-slider">
 <div class="bt_bb_content_slider_item" style=";background-image:url(&#039;https://wp.example/wp-content/uploads/home-1.jpg&#039;);">
  <header class="bt_bb_headline"><h1 class="bt_bb_headline_tag"><span class="bt_bb_headline_superheadline">Synthetic Club</span><span class="bt_bb_headline_content"><span>Play with <strong>passion</strong>.<br /><br /> Win with <strong>integrity</strong>.</span></span></h1></header>
  <div class="bt_bb_button"><a href="https://cdn.example/intro.mp4" class="bt_bb_link" title="WATCH VIDEO"><span class="bt_bb_button_text">WATCH VIDEO</span></a></div>
 </div>
</div></div></section></p>
<header class="bt_bb_headline"><h2><span class="bt_bb_headline_superheadline">About us</span><span>We coach <strong>every</strong> level</span></h2></header>
<p>Text about the club.</p>`;

describe("hero sliders", () => {
  it("turns an Elementor slides widget into a hero slideshow (duplicates skipped)", () => {
    const hero = extractLeadingHero(ELEMENTOR_SLIDES, "https://wp.example/");
    expect(hero?.slides).toHaveLength(2);
    expect(hero!.slides[0]).toMatchObject({ image: "https://wp.example/wp-content/uploads/slide-1.jpg", headline: "Summer camps are open", subheadline: "Book a week of basketball." });
    expect(hero!.slides[0]!.ctas).toEqual([{ label: "Register now", href: "/camps/" }]);
    expect(hero!.slides[1]!.ctas).toEqual([{ label: "Book a session", href: "/training/" }]);
    const blocks = htmlToBlocks(ELEMENTOR_SLIDES, { title: "Home", pageUrl: "https://wp.example/", isHome: true });
    const b = blocks[0]!;
    expect(b.type).toBe("hero");
    if (b.type !== "hero") return;
    expect(b.headline).toBe("Summer camps are open");
    expect(b.slides).toHaveLength(1);
    expect(b.slides![0]!.headline).toBe("Train with us");
    expect(b.autoplay).toBe(true);
    expect(blockSchema.safeParse({ ...b, image: null, slides: b.slides!.map((s) => ({ ...s, image: null })) }).success).toBe(true);
    expect(blocks.find((x) => x.type === "richText" || x.type === "twoColumn")).toBeTruthy();
  });

  it("reads a page-builder slider headline with its kicker and keeps headlines wrapped in <header>", () => {
    const blocks = htmlToBlocks(BOLD_SLIDER, { title: "Home", pageUrl: "https://wp.example/", isHome: true });
    const hero = blocks[0]!;
    expect(hero).toMatchObject({ type: "hero", eyebrow: "Synthetic Club", headline: "Play with passion. Win with integrity." });
    if (hero.type === "hero") expect(hero.ctas[0]).toMatchObject({ label: "WATCH VIDEO", href: "https://cdn.example/intro.mp4" });
    const text = JSON.stringify(blocks.slice(1));
    expect(text).toContain("We coach <strong>every</strong> level");
    expect(text).toContain("About us");
  });

  it("never shows the page title 'Home' when a better heading exists", () => {
    const html = `<p><img src="https://wp.example/wp-content/uploads/a.jpg"></p><p>intro</p><p>more</p><p>text</p><h2>Where champions grow</h2><p>x</p>`;
    const home = htmlToBlocks(html, { title: "Home", pageUrl: "https://wp.example/", isHome: true })[0]!;
    expect(home.type === "hero" && home.headline).toBe("Where champions grow");
    const tagline = htmlToBlocks(`<p><img src="https://wp.example/wp-content/uploads/a.jpg"></p>`, { title: "Home", isHome: true, tagline: "Basketball for everyone" })[0]!;
    expect(tagline.type === "hero" && tagline.headline).toBe("Basketball for everyone");
    const other = htmlToBlocks(`<p><img src="https://wp.example/wp-content/uploads/a.jpg"></p>`, { title: "Camps" })[0]!;
    expect(other.type === "hero" && other.headline).toBe("Camps");
  });

  it("does not treat a carousel after text as the hero", () => {
    expect(extractLeadingHero(`<p>${"Intro text. ".repeat(10)}</p><div class="owl-carousel"><div class="owl-item"><img src="https://wp.example/x.jpg"></div></div>`)).toBeNull();
  });

  it("turns repeated image + title tiles into a card grid", () => {
    const tiles = ["Juniors", "Seniors", "Girls"].map((n, i) => `<div class="card"><img src="https://wp.example/wp-content/uploads/t${i}.jpg" alt="https://wp.example/wp-content/uploads/t${i}.jpg"><h3>${n}</h3><p>Team ${n}.</p></div>`).join("");
    const blocks = htmlToBlocks(`<h2>Teams</h2><p>All our teams.</p>${tiles}`, { title: "Teams" });
    const cards = blocks.find((b) => b.type === "cards");
    expect(cards?.type === "cards" && cards.items.map((c) => c.title)).toEqual(["Juniors", "Seniors", "Girls"]);
    expect(cards?.type === "cards" && cards.items[0]!.image?.alt).toBeUndefined();
  });
});

describe("live blocks for imported pages", () => {
  it("matches generic keywords in en / fr / de / it / es", () => {
    expect(suggestLive({ slug: "summer-camps", title: "Summer camps" })).toBe("camps");
    expect(suggestLive({ slug: "stages-ete", title: "Stages d'été" })).toBe("camps");
    expect(suggestLive({ slug: "ferienlager", title: "Ferienlager" })).toBe("camps");
    expect(suggestLive({ slug: "calendario", title: "Calendario partite" })).toBe("schedule");
    expect(suggestLive({ slug: "equipos", title: "Equipos" })).toBe("schedule");
    expect(suggestLive({ slug: "pro-training", title: "Pro training" })).toBe("training");
    expect(suggestLive({ slug: "entrainement", title: "Entraînement" })).toBe("training");
    expect(suggestLive({ slug: "boutique", title: "Boutique" })).toBe("shop");
    expect(suggestLive({ slug: "actualites", title: "Actualités" })).toBe("news");
    expect(suggestLive({ slug: "partenaires", title: "Partenaires" })).toBe("sponsors");
    expect(suggestLive({ slug: "about-us", title: "About us" })).toBeNull();
    expect(suggestLive({ slug: "camps", title: "Camps", path: "/" })).toBeNull();
  });

  it("builds valid blocks and detects them on re-import", () => {
    for (const k of ["camps", "schedule", "training", "shop", "news", "sponsors"] as const) {
      const blocks = liveBlocksFor(k);
      for (const b of blocks) expect(blockSchema.safeParse(b).success).toBe(true);
      expect(hasLiveFor(blocks, k)).toBe(true);
      expect(hasLiveFor([], k)).toBe(false);
    }
    expect(liveBlocksFor("schedule").map((b) => b.type === "live" && b.source)).toEqual(["schedule", "results"]);
  });
});

describe("WPML front pages", () => {
  it("attaches the translated front page (own id and slug) to the home page", () => {
    const home = mapWpItem({ id: 10, slug: "home", link: "https://wp.example/", title: { rendered: "Home" }, content: { rendered: "<p>x</p>" } }) as WpItem;
    const accueil = mapWpItem(
      { id: 20, slug: "accueil", link: "https://wp.example/fr/", title: { rendered: "Accueil" }, content: { rendered: "<p>y</p>" } },
      { langPrefixes: [{ tag: "fr", prefix: "fr" }], lang: "fr" },
    ) as WpItem;
    expect(accueil.path).toBe("/");
    const { groups, unmatched } = groupTranslations([home, accueil], "en");
    expect(unmatched).toHaveLength(0);
    expect(groups[0]!.translations.fr?.sourceId).toBe("20");
  });
});

describe("re-import safety", () => {
  it("hashes content independently of key order", () => {
    expect(stableStringify({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe('{"a":{"d":[1,{"x":1,"y":2}]},"b":1}');
    expect(contentHash({ en: { title: "A", blocks: [] } })).toBe(contentHash({ en: { blocks: [], title: "A" } }));
  });

  it("detects edits by hash, or by time for rows imported before hashes existed", () => {
    const content = { en: { title: "A", blocks: [] } };
    const hash = contentHash(content);
    expect(editedSinceImport({ content, updatedAt: null }, { hash, importedAt: null })).toBe(false);
    expect(editedSinceImport({ content: { en: { title: "B", blocks: [] } }, updatedAt: null }, { hash, importedAt: null })).toBe(true);
    expect(editedSinceImport({ content, updatedAt: "2026-01-01T12:05:00Z" }, { hash: null, importedAt: "2026-01-01T12:00:00Z" })).toBe(false);
    expect(editedSinceImport({ content, updatedAt: "2026-01-02T12:00:00Z" }, { hash: null, importedAt: "2026-01-01T12:00:00Z" })).toBe(true);
    expect(rerunAction(true, false)).toBe("keep");
    expect(rerunAction(true, true)).toBe("update");
    expect(rerunAction(false, false)).toBe("update");
  });
});

describe("custom header menu", () => {
  it("cleans stored menus: language-tag labels, safe links, drop-down parents need children", () => {
    const nav = cleanNav([
      { label: { en: "Home", xx_bad: "x" }, href: "/" },
      { label: { en: "About" }, href: "", children: [{ label: { en: "Club", fr: "Club" }, href: "/about-us" }, { label: { en: "Bad" }, href: "javascript:alert(1)" }] },
      { label: { en: "Empty parent" }, href: "" },
      { label: {}, href: "/no-label" },
      { label: { en: "External" }, href: "https://partner.example/" },
      "nonsense",
    ]);
    expect(nav).toEqual([
      { label: { en: "Home" }, href: "/" },
      { label: { en: "About" }, href: "", children: [{ label: { en: "Club", fr: "Club" }, href: "/about-us" }] },
      { label: { en: "External" }, href: "https://partner.example/" },
    ]);
    expect(cleanNav(Array.from({ length: 20 }, (_, i) => ({ label: { en: `I${i}` }, href: `/p${i}` })))).toHaveLength(12);
  });

  it("renders drop-down parents without a link, localised per language, current when a child is", () => {
    const nav = buildNav({
      custom: [{ label: { en: "About", fr: "À propos" }, href: "", children: [{ label: { en: "Club", fr: "Club" }, href: "/about-us" }] }],
      pages: [], lang: "fr", defaultLang: "en", currentPath: "/about-us",
    });
    expect(nav).toEqual([{ label: "À propos", href: "", current: true, children: [{ label: "Club", href: "/fr/about-us", current: true, children: undefined }] }]);
  });

  it("language switcher lists every site language (default first) once the site has more than one", () => {
    expect(switcherLanguages(["fr", "en", "de"], ["en"], "en")).toEqual(["en", "fr", "de"]);
    expect(switcherLanguages(["en"], ["en"], "en")).toEqual(["en"]);
  });

  it("nests and un-nests items", () => {
    const list = [{ label: { en: "A" }, href: "/a" }, { label: { en: "B" }, href: "/b" }, { label: { en: "C" }, href: "/c" }];
    const nested = indentNavItem(list, 1);
    expect(nested).toEqual([{ label: { en: "A" }, href: "/a", children: [{ label: { en: "B" }, href: "/b" }] }, { label: { en: "C" }, href: "/c" }]);
    expect(indentNavItem(list, 0)).toEqual(list);
    expect(outdentNavItem(nested, 0, 0)).toEqual([{ label: { en: "A" }, href: "/a", children: undefined }, { label: { en: "B" }, href: "/b" }, { label: { en: "C" }, href: "/c" }]);
  });
});

describe("site fonts and hero schema", () => {
  const branding = DEFAULT_BRANDING;

  it("keeps the uppercase flag and maps curated fonts to their self-hosted variables", () => {
    expect(cleanFonts({ display: "Oswald", ui: "Inter", uppercase: true, x: 1 })).toEqual({ display: "Oswald", ui: "Inter", uppercase: true });
    const vars = siteCssVars({ template: "arena", branding, fonts: { display: "Oswald", ui: "Exo 2" } });
    expect(vars["--font-display"]).toMatch(/^var\(--site-font-oswald, "Oswald"\)/);
    expect(vars["--font-ui"]).toMatch(/^var\(--site-font-exo-2, "Exo 2"\)/);
    expect(siteFontsHref({ template: "arena", branding, fonts: { display: "Oswald", ui: "Exo 2" } })).toBeNull();
    expect(siteFontsHref({ template: "arena", branding, fonts: { display: "Lobster" } })).toContain("family=Lobster");
    expect(siteFontByFamily("bebas neue")?.id).toBe("bebas-neue");
  });

  it("accepts hero slideshows and still reads heroes stored without them", () => {
    const content = parsePageContent({
      en: {
        title: "Home",
        blocks: [
          { id: "h1", type: "hero", headline: "One", slides: [{ headline: "Two", ctas: [{ label: "Go", href: "/camps" }] }], autoplay: false, interval: 5 },
          { id: "h2", type: "hero", headline: "Old" },
          { id: "h3", type: "hero", headline: "Bad", slides: [{ headline: "x", ctas: [{ label: "x", href: "javascript:alert(1)" }] }] },
        ],
      },
    });
    const [a, b] = content.en!.blocks;
    expect(a).toMatchObject({ type: "hero", slides: [{ headline: "Two", ctas: [{ label: "Go", href: "/camps", style: "primary" }] }], autoplay: false, interval: 5 });
    expect(b).toMatchObject({ type: "hero", headline: "Old" });
    expect(b && "slides" in b ? b.slides : undefined).toBeUndefined();
    expect(content.en!.blocks).toHaveLength(2);
  });
});
