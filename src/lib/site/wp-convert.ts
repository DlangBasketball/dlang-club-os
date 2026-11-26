import { decodeEntities, htmlToText } from "@/lib/website/sanitize";
import { canonicalTag } from "./languages";
import { isReservedPath, normalizeRequestPath, slugify } from "./paths";
import { sanitizeRichText } from "./sanitize";
import { isSafeVideoUrl, newBlockId, type Block, type BlockOf, type LiveSource, type MediaRef, type PageLang } from "./blocks";
import { attrOf, classIdOf, elementEnd, findTags, openTagAt } from "./html-scan";

/**
 * WordPress -> site blocks (pure). Works with any WordPress site through its
 * public REST payloads (wp/v2/pages, wp/v2/posts): classic editor, Gutenberg
 * and page builders (Elementor, Bold Builder, Divi output) alike, because it
 * reads the rendered HTML generically:
 *
 *   headings / paragraphs / lists / quotes -> rich text (sanitised)
 *   a leading background or full-width image + heading -> hero
 *   one image beside a short text run       -> two columns
 *   3+ images in a row                      -> gallery (lightbox)
 *   YouTube / Vimeo iframes or links, <video> -> video (privacy-friendly embed)
 *   scripts, styles, forms, shortcodes      -> dropped
 *
 * Images are referenced by their SOURCE URL through IMAGE_REF placeholders;
 * the importer copies them into the club's media library and swaps in the
 * library path (replaceImageRefs), dropping any it could not copy.
 *
 * Pages that are plugin plumbing (cart, checkout, account, booking /
 * membership plugin pages, 404 / under-construction, test copies) or whose
 * content is only a shortcode are skipped by generic rules (skipReason).
 */

export const IMAGE_REF = "wpimg:";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const rendered = (v: unknown): string => (isObj(v) ? str(v.rendered) : str(v));

// ---------------------------------------------------------------------------
// Skip rules
// ---------------------------------------------------------------------------

const SKIP_EXACT = new Set([
  "cart", "basket", "checkout", "my-account", "account", "login", "log-in", "logout", "log-out", "lost-password",
  "reset-password", "register", "registration", "order-tracking", "order-tracking-form", "order-received", "thank-you",
  "wishlist", "compare", "on-sale", "page-not-found", "404", "not-found", "under-construction", "coming-soon",
  "maintenance", "sample-page", "footer", "header", "mega-menu", "search", "search-results",
]);
const SKIP_PREFIX = /^(wpbc|wp-booking|booking-|bookings?$|membership|pmpro|elementor|single-product|product-elements|blog-single|gallery-single|woocommerce|wc-|edd-|amelia|bookly|tribe-|event-tickets|my-)/;
const SKIP_WORD = /(^|-)(test|testing|demo|draft|copy|old|backup|preview|template)(-\d+)?($|-)/;

export type SkipReason = "plugin_page" | "shortcode_only" | "empty" | "test_page" | "not_published";

/** Text of HTML after removing shortcodes, scripts and tags. */
export function visibleText(html: string): string {
  return htmlToText(stripShortcodes(html), 20_000).trim();
}

export function stripShortcodes(html: string): string {
  // [shortcode attr="..."] ... [/shortcode] and self-closing [shortcode /]
  return String(html ?? "").replace(/\[\/?[a-zA-Z_][\w-]*(?:\s[^\]]*)?\/?\]/g, " ");
}

export function skipReasonFor(page: { slug: string; status?: string; html: string }): SkipReason | null {
  const slug = (page.slug || "").toLowerCase();
  if (page.status && page.status !== "publish") return "not_published";
  if (SKIP_EXACT.has(slug) || SKIP_PREFIX.test(slug)) return "plugin_page";
  if (SKIP_WORD.test(slug)) return "test_page";
  const raw = String(page.html ?? "");
  const hasShortcode = /\[[a-zA-Z_][\w-]*[^\]]*\]/.test(raw);
  const text = visibleText(raw);
  const images = extractImageUrls(raw).length;
  if (!text && !images) return hasShortcode ? "shortcode_only" : "empty";
  if (hasShortcode && text.length < 40 && !images && /^\s*(<p>\s*)?\[[^\]]+\](\s*<\/p>)?\s*$/.test(raw.trim())) return "shortcode_only";
  return null;
}

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------

type Token =
  | { t: "heading"; level: number; html: string; text: string }
  | { t: "text"; html: string; text: string }
  | { t: "image"; src: string; alt: string }
  | { t: "video"; url: string };

const BLOCKY = /<(div|section|article|h[1-6]|ul|ol|img|iframe|figure|table|video|p)\b/i;

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "") : null;
}

/** Largest candidate of a srcset (falls back to src). */
function bestSrc(tag: string): string | null {
  const srcset = attr(tag, "srcset") ?? attr(tag, "data-srcset");
  if (srcset) {
    const best = srcset
      .split(",")
      .map((s) => s.trim().split(/\s+/))
      .map(([u, w]) => ({ u: u ?? "", w: parseInt((w ?? "0").replace(/\D/g, ""), 10) || 0 }))
      .filter((c) => c.u && c.w <= 2400)
      .sort((a, b) => b.w - a.w)[0];
    if (best?.u) return best.u;
  }
  return attr(tag, "data-src") ?? attr(tag, "data-lazy-src") ?? attr(tag, "src");
}

/** https (or protocol-relative -> https) absolute image URL, resolved against the page. */
export function absoluteImageUrl(src: string | null | undefined, pageUrl?: string | null): string | null {
  if (!src) return null;
  const s = src.trim();
  if (!s || s.startsWith("data:") || /blank\.gif|spacer\.gif|placeholder/i.test(s)) return null;
  try {
    const u = new URL(s.startsWith("//") ? `https:${s}` : s, pageUrl || undefined);
    if (u.protocol === "http:") u.protocol = "https:";
    if (u.protocol !== "https:" || u.username || u.password) return null;
    if (!/\.(jpe?g|png|webp)$/i.test(u.pathname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function videoUrlFrom(src: string | null): string | null {
  if (!src) return null;
  const s = src.startsWith("//") ? `https:${src}` : src;
  return isSafeVideoUrl(s) ? s : null;
}

/** Every image URL referenced by the HTML (img, srcset, background images), deduplicated. */
export function extractImageUrls(html: string, pageUrl?: string | null): string[] {
  const out = new Set<string>();
  for (const m of String(html ?? "").matchAll(/<img\b[^>]*>/gi)) {
    const u = absoluteImageUrl(bestSrc(m[0]), pageUrl);
    if (u) out.add(u);
  }
  for (const m of String(html ?? "").matchAll(/data-(?:background(?:_image_src|-image|_image)?|bg(?:-image|-src)?|lazyload|src-full)\s*=\s*["']([^"']+)["']/gi)) {
    const u = absoluteImageUrl(decodeEntities(m[1]!), pageUrl);
    if (u) out.add(u);
  }
  for (const m of String(html ?? "").matchAll(/background(?:-image)?\s*:\s*url\(\s*(?:&#0?39;|&quot;|["'])?([^"')&]+)/gi)) {
    const u = absoluteImageUrl(decodeEntities(m[1]!), pageUrl);
    if (u) out.add(u);
  }
  return Array.from(out);
}

const KICKER_RE = /<(span|div|small|p)\b[^>]*class\s*=\s*["'][^"']*(superheadline|supertitle|pre-?title|pretitle|kicker|eyebrow|overline)[^"']*["'][^>]*>[\s\S]*?<\/\1>/i;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Text of inline HTML: inline tags vanish without adding spaces ("<b>passion</b>." -> "passion."). */
export function inlineText(html: string, max = 400): string {
  return htmlToText(String(html ?? "").replace(/<\/?(strong|b|em|i|span|a|mark|small|u|sup|sub|font)\b[^>]*>/gi, ""), max * 2)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function tokenize(html: string, pageUrl?: string | null): Token[] {
  let src = stripShortcodes(String(html ?? ""));
  src = src.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of ["script", "style", "noscript", "form", "svg", "template", "button", "select", "textarea", "nav", "footer"]) {
    src = src.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), " ");
  }
  // <header>: the site header (menu) is dropped; page builders also wrap
  // headlines in <header> (Bold Builder, some themes), those are kept.
  src = src.replace(/<header\b[\s\S]*?<\/header\s*>/gi, (m) => (/<(nav|ul)\b|site-header|masthead/i.test(m) ? " " : m.replace(/^<header\b[^>]*>|<\/header\s*>$/gi, " ")));
  const tokens: Token[] = [];
  const re = /<(h[1-6]|p|ul|ol|blockquote)\b[^>]*>([\s\S]*?)<\/\1\s*>|<img\b[^>]*>|<iframe\b[^>]*>|<video\b[^>]*>[\s\S]*?<\/video>|data-background(?:_image_src|-image|_image)?\s*=\s*["']([^"']+)["']|<a\b[^>]*href\s*=\s*["'](https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|vimeo\.com)\/[^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const whole = m[0];
    const tag = (m[1] ?? "").toLowerCase();
    if (tag) {
      const inner = m[2] ?? "";
      if (BLOCKY.test(inner) && !/^(ul|ol)$/.test(tag)) {
        // A wrapper around block content (page builders put <p> around sections): look inside.
        re.lastIndex = m.index + whole.indexOf(">") + 1;
        continue;
      }
      // A kicker inside a headline ("CLUB NAME" above the title) becomes its own line.
      if (/^h[1-6]$/.test(tag)) {
        const kick = KICKER_RE.exec(inner);
        if (kick) {
          const kt = inlineText(kick[0]);
          if (kt) tokens.push({ t: "text", html: `<p>${escapeHtml(kt)}</p>`, text: kt });
          const rest = inner.replace(kick[0], "");
          const ht = inlineText(rest);
          if (ht) tokens.push({ t: "heading", level: Number(tag[1]), html: rest, text: ht });
          continue;
        }
      }
      // Inline images inside a text element.
      for (const im of inner.matchAll(/<img\b[^>]*>/gi)) {
        const u = absoluteImageUrl(bestSrc(im[0]), pageUrl);
        if (u) tokens.push({ t: "image", src: u, alt: (attr(im[0], "alt") ?? "").slice(0, 300) });
      }
      const text = (/^h[1-6]$/.test(tag) ? inlineText(inner) : htmlToText(inner, 10_000)).trim();
      if (!text) continue;
      if (/^h[1-6]$/.test(tag)) tokens.push({ t: "heading", level: Number(tag[1]), html: inner, text });
      else tokens.push({ t: "text", html: tag === "p" ? `<p>${inner}</p>` : whole, text });
      continue;
    }
    if (/^<img/i.test(whole)) {
      const u = absoluteImageUrl(bestSrc(whole), pageUrl);
      if (u) tokens.push({ t: "image", src: u, alt: (attr(whole, "alt") ?? "").slice(0, 300) });
      continue;
    }
    if (/^<iframe/i.test(whole)) {
      const u = videoUrlFrom(attr(whole, "src") ?? attr(whole, "data-src"));
      if (u) tokens.push({ t: "video", url: u });
      continue;
    }
    if (/^<video/i.test(whole)) {
      const s = attr(whole, "src") ?? /<source\b[^>]*src\s*=\s*["']([^"']+)["']/i.exec(whole)?.[1] ?? null;
      const u = videoUrlFrom(s);
      if (u) tokens.push({ t: "video", url: u });
      continue;
    }
    if (m[3]) {
      const u = absoluteImageUrl(decodeEntities(m[3]), pageUrl);
      if (u) tokens.push({ t: "image", src: u, alt: "" });
      continue;
    }
    if (m[4]) {
      const u = videoUrlFrom(decodeEntities(m[4]));
      if (u) tokens.push({ t: "video", url: u });
    }
  }
  // Dedupe repeated images / videos (sliders and responsive duplicates).
  const seen = new Set<string>();
  return tokens.filter((tk) => {
    if (tk.t !== "image" && tk.t !== "video") return true;
    const k = tk.t === "image" ? tk.src : tk.url;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** Alt text, unless it is just the file name / URL (page builders fill alt with it). */
const cleanAlt = (alt?: string | null): string | undefined => {
  const a = (alt ?? "").trim();
  return !a || /^https?:\/\/|^[\w-]+\.(jpe?g|png|webp|gif)$/i.test(a) ? undefined : a.slice(0, 300);
};
const ref = (src: string, alt?: string): MediaRef => ({ path: `${IMAGE_REF}${src}`, alt: cleanAlt(alt), focalX: 50, focalY: 50 });

function runHtml(run: Token[]): string {
  return sanitizeRichText(
    run
      .map((tk) => (tk.t === "heading" ? `<h${Math.min(Math.max(tk.level, 2), 4)}>${tk.html}</h${Math.min(Math.max(tk.level, 2), 4)}>` : tk.t === "text" ? tk.html : ""))
      .join(""),
  );
}

/** A short line right before a heading is its kicker ("ABOUT US" above "We offer ..."). */
function splitHead(run: Token[]): { eyebrow?: string; heading?: string; rest: Token[] } {
  const [a, b] = run;
  if (a?.t === "text" && a.text.length <= 40 && b?.t === "heading") return { eyebrow: a.text.slice(0, 80), heading: b.text.slice(0, 200), rest: run.slice(2) };
  if (a?.t === "heading") return { heading: a.text.slice(0, 200), rest: run.slice(1) };
  return { rest: run };
}

type CardItem = { title: string; text?: string; image: MediaRef };

/** 3+ repetitions of image -> short heading [-> short text]: a card grid (team / programme tiles). */
function cardRun(tokens: Token[], start: number): { items: CardItem[]; end: number } | null {
  const items: CardItem[] = [];
  let i = start;
  while (i + 1 < tokens.length && items.length < 24) {
    const img = tokens[i]!;
    const head = tokens[i + 1]!;
    if (img.t !== "image" || head.t !== "heading" || head.text.length > 120) break;
    const next = tokens[i + 2];
    const hasText = next?.t === "text" && next.text.length <= 400 && tokens[i + 3]?.t !== "heading";
    items.push({ title: head.text.slice(0, 120), text: hasText ? next.text.slice(0, 600) : undefined, image: ref(img.src, img.alt) });
    i += hasText ? 3 : 2;
  }
  return items.length >= 3 ? { items, end: i } : null;
}

// ---------------------------------------------------------------------------
// Hero sliders (Elementor slides / Swiper, Slider Revolution, Slick, Bold
// Builder content slider, Smart Slider, Owl, generic "hero" sections)
// ---------------------------------------------------------------------------

export type ExtractedSlide = { image: string | null; alt: string; eyebrow?: string; headline: string; subheadline?: string; ctas: { label: string; href: string }[] };

const tokensOf = (openTag: string) => (attrOf(openTag, "class") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
const SLIDER_TOKEN = /^(swiper|swiper-container|swiper-wrapper|slick-slider|elementor-slides|elementor-slides-wrapper|rev_slider|rev_slider_wrapper|rs-module|rs-module-wrap|n2-section-smartslider|carousel|owl-carousel|flexslider|metaslider|sp-slider|[\w-]*content_slider|[\w-]*hero_slider|[\w-]*hero-slider|hero|[\w-]+-hero|hero-[\w-]+|[\w-]*-slider|[\w-]*_slider)$/;
const SLIDE_TOKEN = /^(swiper-slide|slick-slide|[\w-]*slider_item|[\w-]*slider-item|rs-slide|carousel-item|n2-ss-slide|sp-slide|owl-item|[\w-]*slide-item|[\w-]*slide_item)$/;
const CLONE_TOKEN = /^(swiper-slide-duplicate|slick-cloned|cloned)$/;
const HEADING_CLASS = /(slide|slider|hero|banner)[-_]?(heading|title|headline)\b/;
const SUB_CLASS = /subheadline|sub-?title|slide-description|slide-text|(hero|banner)[-_](text|subtitle|description|lead)/;
const BUTTON_CLASS = /button|btn|bt_bb_link|\bcta\b/;

function textOfClass(html: string, re: RegExp): { text: string; raw: string } | null {
  for (const at of findTags(html, "[a-z][\\w-]*", (t) => re.test(classIdOf(t)))) {
    const raw = html.slice(at, elementEnd(html, at));
    const text = inlineText(raw, 300);
    if (text) return { text, raw };
  }
  return null;
}

function sitePathIfSameSite(href: string, pageUrl?: string | null): string {
  try {
    const u = new URL(href, pageUrl || undefined);
    if (pageUrl && u.origin === new URL(pageUrl).origin) return `${u.pathname}${u.search}` || "/";
    return u.toString();
  } catch {
    return href;
  }
}

function slideFrom(html: string, pageUrl?: string | null): ExtractedSlide | null {
  const image = extractImageUrls(html, pageUrl)[0] ?? null;
  const imgTag = /<img\b[^>]*>/i.exec(html)?.[0];
  const kick = KICKER_RE.exec(html);
  const eyebrow = kick ? inlineText(kick[0], 80) : undefined;
  let headline = "";
  let subheadline: string | undefined;
  const h = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/i.exec(html);
  if (h) headline = inlineText(kick ? h[2]!.replace(kick[0], "") : h[2]!, 200);
  if (!headline) headline = textOfClass(html, HEADING_CLASS)?.text.slice(0, 200) ?? "";
  const sub = textOfClass(html, SUB_CLASS);
  if (sub && sub.text !== headline) subheadline = sub.text.slice(0, 400);
  if (!subheadline && h) {
    const after = html.slice(h.index + h[0].length);
    const p = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(after);
    const pt = p ? inlineText(p[1]!, 400) : "";
    if (pt && pt.length <= 300) subheadline = pt;
  }
  const ctas: { label: string; href: string }[] = [];
  const firstHref = attrOf(/<a\b[^>]*>/i.exec(html)?.[0] ?? "", "href");
  for (const at of findTags(html, "a|div|span", (t) => BUTTON_CLASS.test(classIdOf(t)))) {
    if (ctas.length >= 2) break;
    const open = openTagAt(html, at);
    const raw = html.slice(at, elementEnd(html, at));
    const label = (inlineText(raw, 80) || attrOf(open, "title") || "").trim().slice(0, 80);
    const href = /^<a\b/i.test(open) ? attrOf(open, "href") : firstHref;
    if (!label || !href || href.startsWith("#") || /^javascript:/i.test(href)) continue;
    const target = sitePathIfSameSite(href, pageUrl);
    if (!ctas.some((c) => c.label === label)) ctas.push({ label, href: target });
  }
  if (!image && !headline) return null;
  return { image, alt: (imgTag ? attrOf(imgTag, "alt") : "")?.slice(0, 300) ?? "", eyebrow: eyebrow || undefined, headline, subheadline, ctas };
}

/**
 * The page's leading slider / hero section (only when no visible text comes
 * before it): its slides (background image, kicker, heading, subheading,
 * buttons) and the HTML without it.
 */
export function extractLeadingHero(html: string, pageUrl?: string | null): { slides: ExtractedSlide[]; rest: string } | null {
  const src = String(html ?? "");
  const at = findTags(src, "div|section|rs-module-wrap|rs-module|ul", (t) => tokensOf(t).some((c) => SLIDER_TOKEN.test(c)))[0];
  if (at === undefined) return null;
  const before = src.slice(0, at).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ");
  if (visibleText(before).length > 30) return null;
  const end = elementEnd(src, at);
  const container = src.slice(at, end);
  const slideStarts = findTags(container, "div|li|rs-slide|section|a", (t) => {
    const cls = tokensOf(t);
    return cls.some((c) => SLIDE_TOKEN.test(c)) && !cls.some((c) => CLONE_TOKEN.test(c));
  });
  const parts: string[] = [];
  let prevEnd = -1;
  for (const s of slideStarts) {
    if (s < prevEnd) continue;
    prevEnd = elementEnd(container, s);
    parts.push(container.slice(s, prevEnd));
  }
  const seen = new Set<string>();
  const slides = (parts.length ? parts : [container])
    .map((p) => slideFrom(p, pageUrl))
    .filter((s): s is ExtractedSlide => !!s)
    .filter((s) => {
      const k = `${s.image}|${s.headline}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 9);
  if (!slides.length) return null;
  return { slides, rest: src.slice(0, at) + src.slice(end) };
}

const ctaOf = (c: { label: string; href: string }, i: number) => ({ label: c.label, href: c.href, style: (i === 0 ? "primary" : "secondary") as "primary" | "secondary" });

function heroFromSlides(slides: ExtractedSlide[], fallbackHeadline: string): BlockOf<"hero"> {
  const [first, ...more] = slides;
  return {
    id: newBlockId(), type: "hero", eyebrow: first!.eyebrow, headline: (first!.headline || fallbackHeadline).slice(0, 200), subheadline: first!.subheadline,
    image: first!.image ? ref(first!.image, first!.alt) : null, overlay: 45, height: "full", align: "start", ctas: first!.ctas.slice(0, 3).map(ctaOf),
    ...(more.length
      ? {
          slides: more.slice(0, 8).map((s) => ({ eyebrow: s.eyebrow, headline: s.headline.slice(0, 200), subheadline: s.subheadline, image: s.image ? ref(s.image, s.alt) : null, ctas: s.ctas.slice(0, 2).map(ctaOf) })),
          autoplay: true,
          interval: 7,
        }
      : {}),
  };
}

export type BlockOptions = {
  title?: string;
  featuredImage?: string | null;
  pageUrl?: string | null;
  /** The site's home page: never show the page title ("Home") as the hero headline. */
  isHome?: boolean;
  /** Site tagline (home hero fallback). */
  tagline?: string | null;
};

/** Convert a page's rendered HTML into blocks. `title` feeds the hero when the page starts with an image. */
export function htmlToBlocks(html: string, opts: BlockOptions = {}): Block[] {
  const leading = extractLeadingHero(html, opts.pageUrl);
  const tokens = tokenize(leading ? leading.rest : html, opts.pageUrl);
  const blocks: Block[] = [];
  let i = 0;
  const firstHeading = (tokens.find((t) => t.t === "heading" && t.level <= 2) as Extract<Token, { t: "heading" }> | undefined)?.text;
  const titleFallback = opts.isHome ? firstHeading ?? opts.tagline ?? "" : opts.title ?? "";

  if (leading) {
    blocks.push(heroFromSlides(leading.slides, titleFallback));
  }
  // Hero: a leading image (or the featured image) with the first heading.
  const firstImg = tokens.findIndex((t) => t.t === "image");
  const firstText = tokens.findIndex((t) => t.t === "heading" || t.t === "text");
  const heroImage = !leading && firstImg !== -1 && (firstText === -1 || firstImg < firstText) ? (tokens[firstImg] as Extract<Token, { t: "image" }>) : null;
  const heroSrc = leading ? null : heroImage?.src ?? opts.featuredImage ?? null;
  if (heroSrc) {
    const headIdx = tokens.findIndex((t) => t.t === "heading");
    const head = headIdx !== -1 && headIdx <= Math.max(firstImg, 0) + 2 ? (tokens[headIdx] as Extract<Token, { t: "heading" }>) : null;
    const next = head ? tokens[headIdx + 1] : undefined;
    const sub = next && next.t === "text" && next.text.length <= 300 ? next.text : undefined;
    blocks.push({
      id: newBlockId(), type: "hero", headline: (head?.text ?? titleFallback).slice(0, 200), subheadline: sub,
      image: ref(heroSrc, heroImage?.alt), overlay: 45, height: "large", align: "start", ctas: [],
    });
    const consumed = new Set<number>();
    if (heroImage) consumed.add(firstImg);
    if (head) consumed.add(headIdx);
    if (sub) consumed.add(headIdx + 1);
    const rest = tokens.filter((_, k) => !consumed.has(k));
    tokens.length = 0;
    tokens.push(...rest);
  }

  while (i < tokens.length) {
    const tk = tokens[i]!;
    const grid = cardRun(tokens, i);
    if (grid) {
      blocks.push({ id: newBlockId(), type: "cards", columns: grid.items.length % 4 === 0 ? 4 : 3, items: grid.items });
      i = grid.end;
      continue;
    }
    if (tk.t === "video") {
      blocks.push({ id: newBlockId(), type: "video", url: tk.url });
      i++;
      continue;
    }
    if (tk.t === "image") {
      let j = i;
      while (j < tokens.length && tokens[j]!.t === "image") j++;
      const imgs = tokens.slice(i, j) as Extract<Token, { t: "image" }>[];
      const nextRun = tokens[j] && tokens[j]!.t !== "image" && tokens[j]!.t !== "video";
      if (imgs.length >= 3) {
        blocks.push({ id: newBlockId(), type: "gallery", images: imgs.slice(0, 80).map((x) => ref(x.src, x.alt)), columns: imgs.length % 4 === 0 ? 4 : 3 });
        i = j;
        continue;
      }
      if (imgs.length === 1 && nextRun) {
        // Image followed by a short text run -> two columns (image first).
        let k = j;
        while (k < tokens.length && (tokens[k]!.t === "text" || tokens[k]!.t === "heading")) k++;
        const run = tokens.slice(j, k);
        const len = run.reduce((n, r) => n + (r.t === "image" || r.t === "video" ? 0 : r.text.length), 0);
        if (len > 0 && len <= 1500) {
          const h = splitHead(run);
          blocks.push({
            id: newBlockId(), type: "twoColumn", eyebrow: h.eyebrow, heading: h.heading, html: runHtml(h.rest),
            image: ref(imgs[0]!.src, imgs[0]!.alt), imageSide: blocks.filter((b) => b.type === "twoColumn").length % 2 ? "end" : "start", ctas: [],
          });
          i = k;
          continue;
        }
      }
      for (const x of imgs) blocks.push({ id: newBlockId(), type: "image", image: ref(x.src, x.alt), width: "wide" });
      i = j;
      continue;
    }
    // Text run.
    let j = i;
    while (j < tokens.length && (tokens[j]!.t === "text" || tokens[j]!.t === "heading")) j++;
    const run = tokens.slice(i, j);
    const len = run.reduce((n, r) => n + (r.t === "text" || r.t === "heading" ? r.text.length : 0), 0);
    const after = tokens[j];
    let imgRun = 0;
    while (tokens[j + imgRun]?.t === "image") imgRun++;
    // One image beside the text (more images after it only when they still form a gallery).
    if (after && after.t === "image" && len <= 1500 && (imgRun === 1 || imgRun - 1 >= 3) && !cardRun(tokens, j)) {
      const h = splitHead(run);
      blocks.push({
        id: newBlockId(), type: "twoColumn", eyebrow: h.eyebrow, heading: h.heading, html: runHtml(h.rest),
        image: ref(after.src, after.alt), imageSide: "end", ctas: [],
      });
      i = j + 1;
      continue;
    }
    const html2 = runHtml(run);
    if (html2) blocks.push({ id: newBlockId(), type: "richText", html: html2, width: len > 2500 ? "wide" : "narrow" });
    i = j;
  }
  return blocks.slice(0, 80);
}

/** Swap IMAGE_REF placeholders for library paths; drop refs that could not be imported. */
export function replaceImageRefs<T>(value: T, map: ReadonlyMap<string, string>): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      return v
        .map(walk)
        .filter((x) => !(isObj(x) && typeof x.path === "string" && (x.path as string).startsWith(IMAGE_REF)))
        .filter((x) => x !== DROP);
    }
    if (!isObj(v)) return v;
    if (typeof v.path === "string" && v.path.startsWith(IMAGE_REF)) {
      const lib = map.get(v.path.slice(IMAGE_REF.length));
      return lib ? { ...v, path: lib } : DROP;
    }
    const out: Obj = {};
    for (const [k, x] of Object.entries(v)) {
      const r = walk(x);
      if (r === DROP) out[k] = null;
      else out[k] = r;
    }
    return out;
  };
  const res = walk(value);
  return cleanupBlocks(res) as T;
}

const DROP = Symbol("drop");

/** After image removal: image blocks without an image and empty galleries disappear. */
function cleanupBlocks(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v
      .map(cleanupBlocks)
      .filter((b) => !(isObj(b) && b.type === "image" && !b.image))
      .filter((b) => !(isObj(b) && b.type === "gallery" && Array.isArray(b.images) && b.images.length === 0));
  }
  if (!isObj(v)) return v;
  const out: Obj = {};
  for (const [k, x] of Object.entries(v)) out[k] = cleanupBlocks(x);
  return out;
}

/** Image source URLs still referenced by placeholders. */
export function imageRefsOf(value: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!isObj(v)) return;
    if (typeof v.path === "string" && v.path.startsWith(IMAGE_REF)) out.add(v.path.slice(IMAGE_REF.length));
    Object.values(v).forEach(walk);
  };
  walk(value);
  return Array.from(out);
}

// ---------------------------------------------------------------------------
// Pages / posts / languages
// ---------------------------------------------------------------------------

export type WpLanguage = { tag: string; prefix: string | null };

/** Languages a WordPress home page advertises through hreflang links (WPML / Polylang). */
export function detectLanguages(homeHtml: string, baseUrl: string): WpLanguage[] {
  const out: WpLanguage[] = [];
  let basePath = "/";
  try {
    basePath = new URL(baseUrl).pathname.replace(/\/+$/, "") || "/";
  } catch {
    /* keep "/" */
  }
  for (const m of String(homeHtml ?? "").matchAll(/<link\b[^>]*rel=["']alternate["'][^>]*>/gi)) {
    const hl = attr(m[0], "hreflang");
    const href = attr(m[0], "href");
    if (!hl || !href || hl === "x-default") continue;
    const tag = canonicalTag(hl);
    if (!tag || out.some((l) => l.tag === tag)) continue;
    let prefix: string | null = null;
    try {
      const p = new URL(href).pathname.replace(/\/+$/, "");
      const rel = basePath !== "/" && p.startsWith(basePath) ? p.slice(basePath.length) : p;
      const seg = rel.split("/").filter(Boolean)[0] ?? null;
      prefix = seg && seg.toLowerCase().split("-")[0] === tag.toLowerCase().split("-")[0] ? seg.toLowerCase() : null;
    } catch {
      /* ignore */
    }
    out.push({ tag, prefix });
  }
  return out;
}

export type WpItem = {
  sourceId: string;
  slug: string;
  path: string;
  lang: string | null;
  parentSourceId: string | null;
  menuOrder: number;
  title: string;
  html: string;
  excerpt: string;
  status: string;
  link: string;
  featuredMedia: string | null;
  date: string | null;
  modified: string | null;
  /** Translation group ids: language -> source id (Polylang / WPML REST). */
  translations: Record<string, string>;
};

const idOf = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? String(v) : typeof v === "string" && /^\d{1,18}$/.test(v) && v !== "0" ? v : null);

/** Normalise a wp/v2 page or post payload. `basePath` is the WordPress home path ("/" usually). */
export function mapWpItem(raw: unknown, opts: { basePath?: string; langPrefixes?: readonly WpLanguage[]; lang?: string | null } = {}): WpItem | null {
  if (!isObj(raw)) return null;
  const sourceId = idOf(raw.id);
  const slug = str(raw.slug).toLowerCase().slice(0, 160);
  const link = str(raw.link);
  if (!sourceId || !slug) return null;
  let path = "/";
  try {
    path = normalizeRequestPath(new URL(link).pathname) ?? `/${slug}`;
  } catch {
    path = `/${slug}`;
  }
  const base = (opts.basePath ?? "/").replace(/\/+$/, "");
  if (base && path.startsWith(`${base}/`)) path = path.slice(base.length);
  // Strip a language prefix (/fr/...).
  let lang: string | null = opts.lang ?? (typeof raw.lang === "string" ? canonicalTag(raw.lang) : null);
  const seg = path.split("/")[1] ?? "";
  const pre = (opts.langPrefixes ?? []).find((l) => l.prefix && l.prefix === seg);
  if (pre) {
    path = path.slice(seg.length + 1) || "/";
    lang = lang ?? pre.tag;
  }
  const translations: Record<string, string> = {};
  if (isObj(raw.translations)) {
    for (const [k, v] of Object.entries(raw.translations)) {
      const t = canonicalTag(k);
      const id = idOf(v);
      if (t && id) translations[t] = id;
    }
  }
  if (Array.isArray(raw.wpml_translations)) {
    for (const t of raw.wpml_translations) {
      if (!isObj(t)) continue;
      const tag = canonicalTag(str(t.locale).split("_")[0]) ?? canonicalTag(str(t.locale));
      const id = idOf(t.id);
      if (tag && id) translations[tag] = id;
    }
  }
  if (!lang && typeof raw.wpml_current_locale === "string") lang = canonicalTag(raw.wpml_current_locale.split("_")[0]);
  return {
    sourceId, slug, path, lang,
    parentSourceId: idOf(raw.parent),
    menuOrder: typeof raw.menu_order === "number" ? raw.menu_order : 0,
    title: htmlToText(rendered(raw.title), 200).trim(),
    html: rendered(raw.content),
    excerpt: htmlToText(rendered(raw.excerpt), 600).trim(),
    status: str(raw.status) || "publish",
    link,
    featuredMedia: idOf(raw.featured_media),
    date: str(raw.date_gmt) ? `${str(raw.date_gmt)}Z` : str(raw.date) || null,
    modified: str(raw.modified_gmt) ? `${str(raw.modified_gmt)}Z` : str(raw.modified) || null,
    translations,
  };
}

/**
 * Site path for an imported page: the WordPress path when it is a valid,
 * non-reserved site path (kept so links survive); otherwise a slug-based
 * alternative (reserved "/club" -> "/club-info"). `taken` avoids clashes.
 */
export function sitePathFor(item: Pick<WpItem, "path" | "slug">, taken: ReadonlySet<string>, languageSlugs: readonly string[] = []): { path: string; changed: boolean } {
  if (item.path === "/" && !taken.has("/")) return { path: "/", changed: false };
  const clean = (p: string) => p.split("/").filter(Boolean).slice(0, 4).map((s) => s.replace(/[^a-z0-9_%-]/g, "-").replace(/^-+/, "").slice(0, 120)).filter(Boolean);
  const segs = clean(item.path);
  const first = segs[0] ?? "";
  const bad = !segs.length || isReservedPath(`/${first}`) || languageSlugs.includes(first);
  let candidate = segs.length ? `/${segs.join("/")}` : `/${slugify(item.slug) || "page"}`;
  if (bad) candidate = `/${slugify(item.slug) || "page"}-info`;
  let p = candidate;
  for (let n = 2; taken.has(p); n++) p = `${candidate}-${n}`;
  return { path: p, changed: p !== normalizeRequestPath(item.path) };
}

/** Group items by translation: default-language items keyed by source id, others attached when linked. */
export function groupTranslations(items: readonly WpItem[], defaultLang: string): {
  groups: { main: WpItem; translations: Record<string, WpItem> }[];
  unmatched: WpItem[];
} {
  const isDefault = (it: WpItem) => !it.lang || it.lang.split("-")[0] === defaultLang.split("-")[0];
  const mains = items.filter(isDefault);
  const others = items.filter((it) => !isDefault(it));
  const byId = new Map(mains.map((m) => [m.sourceId, { main: m, translations: {} as Record<string, WpItem> }]));
  const unmatched: WpItem[] = [];
  for (const o of others) {
    // 1) explicit translation links on either side
    let target: string | null = null;
    for (const id of Object.values(o.translations)) if (byId.has(id)) target = id;
    if (!target) for (const g of byId.values()) if (Object.values(g.main.translations).includes(o.sourceId)) target = g.main.sourceId;
    // 2) same featured image (unique)
    if (!target && o.featuredMedia) {
      const hits = mains.filter((m) => m.featuredMedia === o.featuredMedia);
      if (hits.length === 1) target = hits[0]!.sourceId;
    }
    // 3) the front page of each language (WPML / Polylang serve it at /fr/
    //    with its own id and slug, e.g. "accueil" for "home")
    if (!target && o.path === "/") {
      const hits = mains.filter((m) => m.path === "/");
      if (hits.length === 1) target = hits[0]!.sourceId;
    }
    // 4) same slug
    if (!target) {
      const hits = mains.filter((m) => m.slug === o.slug);
      if (hits.length === 1) target = hits[0]!.sourceId;
    }
    const g = target ? byId.get(target) : undefined;
    if (g && o.lang && !g.translations[o.lang]) g.translations[o.lang] = o;
    else unmatched.push(o);
  }
  return { groups: Array.from(byId.values()), unmatched };
}

/** One page language from a WordPress item. */
export function pageLangFromItem(it: WpItem, featuredUrl: string | null, opts: { isHome?: boolean; tagline?: string | null } = {}): PageLang {
  const blocks = htmlToBlocks(it.html, { title: it.title, featuredImage: featuredUrl, pageUrl: it.link, isHome: opts.isHome ?? it.path === "/", tagline: opts.tagline });
  return {
    title: it.title || it.slug,
    metaDescription: (it.excerpt || visibleText(it.html)).slice(0, 300) || undefined,
    state: "ok",
    blocks,
  };
}

/** Empty translation flagged for the editor ("needs translation"). */
export function needsTranslation(title: string): PageLang {
  return { title, state: "needs_translation", blocks: [] };
}

/** Clean text of a WordPress post body for a site post. */
export function postBodyHtml(html: string): string {
  return sanitizeRichText(stripShortcodes(html), 60_000);
}

// ---------------------------------------------------------------------------
// Live blocks for imported pages
// ---------------------------------------------------------------------------

/** What a page is about, for the live block the importer can append. */
export type LiveSuggestion = "camps" | "schedule" | "training" | "shop" | "news" | "sponsors";

// Generic keyword rules (en / fr / de / it / es), matched on whole words of the slug and title.
const LIVE_RULES: [LiveSuggestion, RegExp][] = [
  ["shop", /^(shop|shops|boutique|store|merch|merchandise|fanshop|tienda|negozio|laden)$/],
  ["news", /^(news|blog|actualites?|actus?|nouvelles|aktuelles|neuigkeiten|notizie|noticias|novedades)$/],
  ["sponsors", /^(partners?|sponsors?|sponsoring|partenaires?|sponsoren|patrocinadores|patrocinios|sostenitori)$/],
  ["camps", /^(camps?|stages?|ferienlager|lager|trainingslager|campamentos?|campi|campus|colonies?)$/],
  ["schedule", /^(schedule|schedules|fixtures|games|matches|calendrier|matchs|horaires?|spielplan|spiele|calendario|partite|partidos|results|resultats|ergebnisse|risultati|resultados|standings|classements?|tabelle|teams?|equipes?|mannschaften|mannschaft|squadre|squadra|equipos?|roster|leagues?|ligues?|ligen|liga|leghe)$/],
  ["training", /^(training|trainings|entrainements?|coaching|clinics?|allenamenti|allenamento|entrenamientos?|lessons|privatstunden|cours)$/],
];

function words(s: string): string[] {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The live block a page should get from its slug / title, or null (home pages never get one). */
export function suggestLive(page: { slug: string; title: string; path?: string }): LiveSuggestion | null {
  if (page.path === "/") return null;
  const w = [...words(decodeSafe(page.slug)), ...words(page.title)];
  for (const [kind, re] of LIVE_RULES) if (w.some((x) => re.test(x))) return kind;
  return null;
}

/** The blocks for a suggestion (headings come from the live block defaults per language). */
export function liveBlocksFor(kind: LiveSuggestion): Block[] {
  const live = (source: LiveSource, limit: number): Block => ({ id: newBlockId(), type: "live", source, limit });
  switch (kind) {
    case "camps": return [live("camps", 12)];
    case "schedule": return [live("schedule", 6), live("results", 6)];
    case "training": return [live("training", 6)];
    case "shop": return [live("shop", 8)];
    case "news": return [live("news", 9)];
    case "sponsors": return [{ id: newBlockId(), type: "logos", source: "sponsors", items: [] }];
  }
}

/** True when the blocks already show what the suggestion adds (re-import safe). */
export function hasLiveFor(blocks: readonly Block[], kind: LiveSuggestion): boolean {
  const want = liveBlocksFor(kind)[0]!;
  if (want.type === "live") return blocks.some((b) => b.type === "live" && b.source === want.source);
  return blocks.some((b) => b.type === "logos" && b.source === "sponsors");
}
