import { decodeEntities, htmlToText } from "@/lib/website/sanitize";
import { attrOf, childElements, classIdOf, elementEnd, findTags, innerBounds } from "./html-scan";
import { closestSiteFont } from "./fonts";

/**
 * Read a WordPress site's look and frame from its rendered home page (pure):
 * header menu (with sub-menus), logo, theme fonts, brand colours, social
 * profiles and contact details. Works generically for classic themes,
 * Elementor, Bold Builder, Divi, Astra / Kadence / GeneratePress, with
 * WPML / Polylang language switchers (skipped as menu items). Nothing here
 * fetches; wp-import.ts passes the HTML in.
 */

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

export type WpMenuItem = { label: string; url: string; children: WpMenuItem[] };

const MENU_LIST = /(^|[\s_-])(primary|main|header|top|site)[-_]?(menu|nav|navigation)\b|main-navigation-menu|\bmenu-main\b|elementor-nav-menu\b|\bnav-menu\b|\bnavbar-nav\b|\bmenu-primary\b|et-menu\b|\bmain-menu\b/;
const SKIP_LI = /wpml-ls|lang-item|language-switcher|trp-language|weglot|menu-item-language|pll-parent|\bmenu-item-search|menu-search|\bcart\b|menu-item-cart|woocommerce-cart/;
const MAX_TOP = 12;
const MAX_CHILDREN = 20;

function footerStart(html: string): number {
  const m = /<footer\b|id=["'](colophon|footer)["']|class=["'][^"']*\bsite-footer\b/i.exec(html);
  return m ? m.index : html.length;
}

function parseMenuList(html: string, ulStart: number, depth: number): WpMenuItem[] {
  const [from, to] = innerBounds(html, ulStart);
  const out: WpMenuItem[] = [];
  for (const li of childElements(html, from, to, "li")) {
    const liHtml = html.slice(li.start, li.end);
    const liOpen = liHtml.slice(0, liHtml.indexOf(">") + 1);
    if (SKIP_LI.test(classIdOf(liOpen))) continue;
    const subAt = liHtml.search(/<ul\b/i);
    const head = subAt === -1 ? liHtml : liHtml.slice(0, subAt);
    const a = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(head);
    if (!a) continue;
    const label = htmlToText(a[2]!.replace(/<img\b[^>]*>/gi, ""), 200).replace(/\s+/g, " ").trim().slice(0, 60);
    if (!label) continue;
    const url = (attrOf(`<a ${a[1]}>`, "href") ?? "").trim();
    const children = depth < 2 && subAt !== -1 ? parseMenuList(liHtml, subAt, depth + 1).slice(0, MAX_CHILDREN) : [];
    out.push({ label, url, children });
  }
  return out;
}

/** The site's main header menu (top level + sub-menus), or [] when none is found. */
export function extractHeaderMenu(html: string): WpMenuItem[] {
  const src = String(html ?? "");
  const stop = footerStart(src);
  const candidates = findTags(src, "ul", (t) => MENU_LIST.test(classIdOf(t)), 0, stop);
  let at = candidates[0] ?? -1;
  if (at === -1) {
    const nav = findTags(src, "nav", () => true, 0, stop)[0];
    if (nav !== undefined) {
      const ul = src.slice(nav, elementEnd(src, nav)).search(/<ul\b/i);
      if (ul !== -1) at = nav + ul;
    }
  }
  if (at === -1) return [];
  return parseMenuList(src, at, 0).slice(0, MAX_TOP);
}

/**
 * Menu from the public "WP REST API Menus" endpoint (/wp-json/menus/v1/locations/<location>),
 * when a site exposes it: { items: [{ title, url, child_items? }] } or a bare array.
 * Core's /wp/v2/menu-items needs authentication, so the HTML menu is the usual source.
 */
export function menuFromRest(json: unknown): WpMenuItem[] {
  const list = Array.isArray(json) ? json : json && typeof json === "object" && Array.isArray((json as { items?: unknown }).items) ? (json as { items: unknown[] }).items : [];
  const one = (v: unknown, depth: number): WpMenuItem | null => {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    const rawTitle = typeof o.title === "string" ? o.title : o.title && typeof o.title === "object" ? String((o.title as { rendered?: unknown }).rendered ?? "") : "";
    const label = htmlToText(rawTitle, 200).replace(/\s+/g, " ").trim().slice(0, 60);
    if (!label || /wpml|language/i.test(String(o.type ?? "")) ) return null;
    const kids = depth < 1 && Array.isArray(o.child_items) ? (o.child_items.map((c) => one(c, depth + 1)).filter(Boolean) as WpMenuItem[]).slice(0, MAX_CHILDREN) : [];
    return { label, url: typeof o.url === "string" ? o.url : "", children: kids };
  };
  return (list.map((v) => one(v, 0)).filter(Boolean) as WpMenuItem[]).slice(0, MAX_TOP);
}

/** The header menu location among a REST "locations" listing (primary / main / header / top). */
export function pickMenuLocation(json: unknown): string | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const keys = Object.keys(json as object).filter((k) => /^[\w-]{1,60}$/.test(k));
  return keys.find((k) => /primary|main|header/i.test(k)) ?? keys.find((k) => /top|menu/i.test(k)) ?? null;
}

export type SiteNavItem ={ label: Record<string, string>; href: string; children?: SiteNavItem[] };

/**
 * Merge the per-language menus into one site menu. `resolve` maps a menu URL
 * to a site href: a site path ("/camps"), an external https URL, "" for a
 * dropdown parent without a page ("#"), or null to drop the item (a page that
 * was not imported). Other languages are aligned by position (WPML menus have
 * the same shape) or by the page they link to.
 */
export function mergeMenus(menus: { lang: string; items: WpMenuItem[] }[], defaultLang: string, resolve: (url: string) => string | null): SiteNavItem[] {
  const main = menus.find((m) => m.lang === defaultLang) ?? menus[0];
  if (!main) return [];
  type Pair = { idx: number; nav: SiteNavItem; kids: Pair[]; total: number };
  const hrefOf = (url: string): string | null => {
    const raw = url.trim();
    return !raw || raw.startsWith("#") || /^javascript:/i.test(raw) ? "" : resolve(raw);
  };
  const build = (items: WpMenuItem[], depth: number): Pair[] =>
    items.flatMap((it, idx): Pair[] => {
      const kids = depth === 0 ? build(it.children, 1).slice(0, MAX_CHILDREN) : [];
      const href = hrefOf(it.url);
      if ((href === null || href === "") && !kids.length) return [];
      const nav: SiteNavItem = { label: { [main.lang]: it.label }, href: href ?? "", ...(kids.length ? { children: kids.map((k) => k.nav) } : {}) };
      return [{ idx, nav, kids, total: items.length }];
    });
  const top = build(main.items, 0).slice(0, MAX_TOP);
  const align = (mine: Pair[], theirs: WpMenuItem[], lang: string) => {
    for (const p of mine) {
      let match = p.nav.href ? theirs.find((t) => hrefOf(t.url) === p.nav.href) : undefined;
      if (!match && theirs.length === p.total) match = theirs[p.idx];
      if (!match) continue;
      p.nav.label[lang] = match.label;
      if (p.kids.length) align(p.kids, match.children, lang);
    }
  };
  for (const other of menus) if (other !== main && other.items.length) align(top, other.items, other.lang);
  return top.map((p) => p.nav);
}

const SHOP_PATH = /^\/(shop|boutique|store|tienda|negozio|produkte|products?)(\/|$)/;

/**
 * Menu URL -> site href. Links on the old site become the imported page's
 * new path (language prefix removed: the site menu is localised per page
 * language), the shop goes to the club shop, other sites stay external
 * (https only), and links to pages that were not imported are dropped.
 */
export function makeMenuResolver(opts: { baseUrl: string; prefixes: readonly { tag: string; prefix: string | null }[]; pathMap: ReadonlyMap<string, string> }): (url: string) => string | null {
  let base: URL;
  try {
    base = new URL(opts.baseUrl);
  } catch {
    return () => null;
  }
  const basePath = base.pathname.replace(/\/+$/, "");
  const sameHost = (h: string) => h.replace(/^www\./, "") === base.hostname.replace(/^www\./, "");
  return (url: string) => {
    let u: URL;
    try {
      u = new URL(url, `${base.origin}${basePath}/`);
    } catch {
      return null;
    }
    if (!sameHost(u.hostname)) {
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      u.protocol = "https:";
      return u.username || u.password ? null : u.toString();
    }
    let path = decodeEntities(u.pathname).replace(/\/{2,}/g, "/").toLowerCase();
    if (basePath && path.startsWith(`${basePath.toLowerCase()}/`)) path = path.slice(basePath.length);
    const seg = path.split("/")[1] ?? "";
    if (opts.prefixes.some((p) => p.prefix && p.prefix === seg)) path = path.slice(seg.length + 1) || "/";
    if (path.length > 1) path = path.replace(/\/+$/, "");
    if (!path || path === "/") return "/";
    const hit = opts.pathMap.get(path);
    if (hit) return hit;
    if (SHOP_PATH.test(path)) return "/shop";
    return null;
  };
}

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

const LOGO_EXCLUDE = /sticky|mobile|responsive|footer|partner|sponsor|client|payment|flag|wpml/;

/** The header logo image URL (https, jpg / png / webp), or null. */
export function extractLogoUrl(html: string, pageUrl: string, toUrl: (src: string | null, page: string) => string | null): string | null {
  const src = String(html ?? "");
  const stop = Math.min(footerStart(src), src.search(/<main\b/i) === -1 ? src.length : src.search(/<main\b/i) + 2000);
  const imgs = findTags(src, "img", () => true, 0, stop).map((i) => src.slice(i, src.indexOf(">", i) + 1));
  const pick = (t: string) => toUrl(attrOf(t, "src") ?? attrOf(t, "data-src"), pageUrl);
  const ranked = [
    imgs.filter((t) => /custom-logo/.test(classIdOf(t))),
    imgs.filter((t) => /logo/.test(classIdOf(t)) && !LOGO_EXCLUDE.test(classIdOf(t))),
    imgs.filter((t) => /logo/i.test(attrOf(t, "alt") ?? "") && !LOGO_EXCLUDE.test(classIdOf(t))),
    imgs.filter((t) => /logo/i.test((attrOf(t, "src") ?? "").split("/").pop() ?? "") && !LOGO_EXCLUDE.test(classIdOf(t))),
  ];
  for (const list of ranked) for (const t of list) {
    const u = pick(t);
    if (u) return u;
  }
  return null;
}

// ---------------------------------------------------------------------------
// CSS (style blocks + style attributes)
// ---------------------------------------------------------------------------

type Decl = { name: string; value: string; selector: string };

/** Custom properties and plain declarations of the page's inline CSS. */
function cssDeclarations(html: string): Decl[] {
  const out: Decl[] = [];
  const src = String(html ?? "");
  for (const m of src.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const r of m[1]!.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const selector = r[1]!.trim().slice(-300);
      for (const d of r[2]!.split(";")) {
        const i = d.indexOf(":");
        if (i > 0) out.push({ name: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1).trim(), selector });
      }
    }
  }
  for (const m of src.matchAll(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    for (const d of decodeEntities(m[2] ?? m[3] ?? "").split(";")) {
      const i = d.indexOf(":");
      if (i > 0) out.push({ name: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1).trim(), selector: "[style]" });
    }
  }
  return out;
}

const PAGE_SPECIFIC = /page-id-\d|postid-\d|\.single-|\.archive|\.category-|\.tag-|\.woocommerce|\.wpcf7|\.sp-|\.bt_bb_card/;

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

export type DetectedFonts = { display: string | null; body: string | null; uppercase: boolean; families: string[] };

const ICON_FONT = /icon|awesome|dashicons|glyph|eicons|remix|essential|fontello|ionicons|material|lineicons|themify|linearicons|elegant|woocommerce|star|social|sports?|soccer|tennis|volleyball|superbowl|basket|^fa\b|bt_bb|flaticon|typicons|genericons/i;
const GENERIC = /^(inherit|initial|unset|sans-serif|serif|monospace|system-ui|cursive|fantasy|-apple-system|blinkmacsystemfont|var\()/i;

function firstFamily(value: string): string | null {
  for (const part of value.split(",")) {
    const f = part.replace(/!important/i, "").trim().replace(/^["']|["']$/g, "").trim();
    if (!f || GENERIC.test(f) || f.length > 60 || !/^[A-Za-z0-9 ]+$/.test(f) || ICON_FONT.test(f)) continue;
    return f;
  }
  return null;
}

/** Google Fonts families linked by the page (css and css2 APIs). */
export function googleFontFamilies(html: string): string[] {
  const out: string[] = [];
  for (const m of String(html ?? "").matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s>)]+)/gi)) {
    const q = decodeEntities(m[1]!).replace(/&#0?38;/g, "&");
    for (const part of q.split("&")) {
      if (!part.startsWith("family=")) continue;
      for (const fam of decodeURIComponent(part.slice(7).replace(/\+/g, " ")).split("|")) {
        const name = fam.split(":")[0]!.trim();
        if (name && /^[A-Za-z0-9 ]{1,60}$/.test(name) && !out.includes(name)) out.push(name);
      }
    }
  }
  return out;
}

export function detectFonts(html: string): DetectedFonts {
  const src = String(html ?? "");
  const decls = cssDeclarations(src);
  let display: string | null = null;
  let body: string | null = null;
  const isVar = (d: Decl) => d.name.startsWith("--") && /font(-family)?$/.test(d.name) && !/size|weight|style|transform|icon|spacing|height/.test(d.name);
  for (const d of decls) {
    if (!isVar(d) || PAGE_SPECIFIC.test(d.selector)) continue;
    const fam = firstFamily(d.value);
    if (!fam) continue;
    if (!display && /(heading|headings|headline|title|display|h1|typography-primary|supertitle)/.test(d.name) && !/subtitle/.test(d.name)) display = fam;
    else if (!body && /(body|text|base|content|paragraph|typography-text|typography-secondary)/.test(d.name)) body = fam;
  }
  // Plain rules: h1 / headings and body.
  for (const d of decls) {
    if (d.name !== "font-family" || PAGE_SPECIFIC.test(d.selector)) continue;
    const fam = firstFamily(d.value);
    if (!fam) continue;
    if (!display && /(^|[\s,])h1\b/.test(d.selector)) display = fam;
    if (!body && /(^|[\s,])body\b/.test(d.selector)) body = fam;
  }
  const faces = Array.from(src.matchAll(/@font-face\s*\{([^}]*)\}/gi))
    .filter((m) => !/icon/i.test(m[1]!))
    .map((m) => firstFamily(/font-family\s*:\s*([^;]+)/i.exec(m[1]!)?.[1] ?? ""))
    .filter((f): f is string => !!f);
  const families = Array.from(new Set([...googleFontFamilies(src), ...faces].filter((f) => !ICON_FONT.test(f))));
  if (!display) display = families.find((f) => closestSiteFont(f, "display")?.condensed) ?? families[0] ?? null;
  if (!body) body = families.find((f) => f !== display) ?? null;
  const uppercase =
    decls.some((d) => /^--(heading|headings|headline|title|e-global-typography-primary)[\w-]*text-transform$/.test(d.name) && /uppercase/i.test(d.value)) ||
    decls.some((d) => d.name === "text-transform" && /uppercase/i.test(d.value) && /(^|[\s,])h1\b/.test(d.selector) && !PAGE_SPECIFIC.test(d.selector));
  return { display, body, uppercase, families };
}

/** Site font settings for detected theme fonts (closest curated fonts). */
export function fontChoice(d: DetectedFonts): { display?: string; ui?: string; uppercase?: boolean } {
  const display = closestSiteFont(d.display, "display")?.family;
  const ui = closestSiteFont(d.body, "body")?.family;
  return { ...(display ? { display } : {}), ...(ui ? { ui } : {}), ...(d.uppercase ? { uppercase: true } : {}) };
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

export type DetectedColors = { primary: string | null; accent: string | null };

function toHex(v: string): string | null {
  const s = v.replace(/!important/i, "").trim();
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (h) {
    const x = h[1]!.length === 3 ? h[1]!.split("").map((c) => c + c).join("") : h[1]!;
    return `#${x.toUpperCase()}`;
  }
  const r = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (r) {
    if (r[4] !== undefined && parseFloat(r[4]) < (r[4].endsWith("%") ? 90 : 0.9)) return null;
    return `#${[r[1], r[2], r[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }
  return null;
}

/** True for a colour with some hue (not grey / near-white / near-black). */
export function isBrandish(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2 / 255;
  const s = max === min ? 0 : (max - min) / 255 / (1 - Math.abs(2 * l - 1));
  return s >= 0.25 && l >= 0.12 && l <= 0.88;
}

const PRIMARY_NAMES = ["--e-global-color-primary", "--e-global-color-accent", "--accent-color", "--primary-color", "--theme-color", "--main-color", "--brand-color", "--color-primary", "--primary", "--ast-global-color-0", "--global-palette1", "--wp--preset--color--primary", "--color-accent", "--theme-primary", "--accent"];
const ACCENT_NAMES = ["--e-global-color-secondary", "--e-global-color-accent", "--alternate-color", "--secondary-color", "--color-secondary", "--secondary", "--ast-global-color-1", "--global-palette2", "--wp--preset--color--secondary", "--theme-secondary"];

export function detectColors(html: string): DetectedColors {
  const decls = cssDeclarations(html).filter((d) => !PAGE_SPECIFIC.test(d.selector));
  const byName = (names: string[], not: string | null) => {
    for (const n of names) for (const d of decls) {
      if (d.name !== n) continue;
      const hex = toHex(d.value);
      if (hex && isBrandish(hex) && hex !== not) return hex;
    }
    return null;
  };
  let primary = byName(PRIMARY_NAMES, null);
  if (!primary) {
    // Most used saturated button / link background.
    const freq = new Map<string, number>();
    for (const d of decls) {
      if (!/^(background|background-color|border-color|color)$/.test(d.name)) continue;
      const hex = toHex(d.value.split(/\s+/).find((p) => p.startsWith("#") || p.startsWith("rgb")) ?? "");
      if (!hex || !isBrandish(hex)) continue;
      const weight = /btn|button|\ba\b|link|accent|primary/i.test(d.selector) ? 3 : 1;
      freq.set(hex, (freq.get(hex) ?? 0) + weight);
    }
    primary = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).find(([, n]) => n >= 2)?.[0] ?? null;
  }
  const accent = primary ? byName(ACCENT_NAMES, primary) : null;
  return { primary, accent };
}

// ---------------------------------------------------------------------------
// Social links + contact
// ---------------------------------------------------------------------------

const SOCIAL: [string, RegExp][] = [
  ["facebook", /(^|\.)(facebook|fb)\.com$/],
  ["instagram", /(^|\.)instagram\.com$/],
  ["youtube", /(^|\.)(youtube\.com|youtu\.be)$/],
  ["x", /(^|\.)(twitter|x)\.com$/],
  ["tiktok", /(^|\.)tiktok\.com$/],
  ["linkedin", /(^|\.)linkedin\.com$/],
];
const NOT_PROFILE = /\/(sharer|share|intent|dialog|plugins|embed|watch|p|reel|reels|status|hashtag|explore|tr)\b|sharer\.php|share\?/i;

/** Club social profiles linked from the page (one per network). */
export function extractSocialLinks(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of String(html ?? "").matchAll(/<a\b[^>]*\shref\s*=\s*["']([^"']+)["']/gi)) {
    let u: URL;
    try {
      u = new URL(decodeEntities(m[1]!).trim().replace(/^\/\//, "https://"));
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) continue;
    const host = u.hostname.toLowerCase().replace(/^(www|m|web|mobile)\./, "");
    const net = SOCIAL.find(([, re]) => re.test(host))?.[0];
    if (!net || out[net] || NOT_PROFILE.test(u.pathname)) continue;
    if (u.pathname.replace(/\/+$/, "") === "") continue;
    u.protocol = "https:";
    u.search = "";
    u.hash = "";
    const s = u.toString().replace(/\/+$/, "");
    if (s.length <= 500) out[net] = s;
  }
  return out;
}

export type DetectedContact = { email: string | null; phone: string | null; address: string | null };

const EMAIL_RE = /^[^@\s<>"']+@[^@\s<>"']+\.[a-z]{2,}$/i;
const PHONE_RE = /\+?\d[\d\s().\/-]{5,30}\d/;

export function cleanPhone(raw: string | null | undefined): string | null {
  const m = PHONE_RE.exec(String(raw ?? ""));
  if (!m) return null;
  const p = m[0].replace(/\s+/g, " ").trim();
  const digits = p.replace(/\D/g, "").length;
  return digits >= 6 && digits <= 15 && p.length <= 40 && /^[+0-9 ().\/-]+$/.test(p) ? p : null;
}

const STREET = /\b(rue|chemin|ch\.|route|rte|avenue|av\.|boulevard|bd|place|impasse|all[ée]e|quai|stra(ss|ß)e|str\.|weg|gasse|platz|via|viale|piazza|corso|calle|avenida|plaza|street|st\.|road|rd\.?|lane|drive|way|square)\b|\b\w+(strasse|straße|gasse|weg|platz)\b/i;

/** Contact email / phone / postal address from the footer (or header). */
export function extractContact(html: string): DetectedContact {
  const src = String(html ?? "");
  const foot = src.slice(footerStart(src));
  const scopes = [foot, src];
  let email: string | null = null;
  let phone: string | null = null;
  for (const scope of scopes) {
    if (!email) {
      for (const m of scope.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)) {
        const e = decodeEntities(decodeURIComponent(m[1]!)).trim();
        if (EMAIL_RE.test(e) && !/example\.|domain\.|wordpress|sentry|wixpress/i.test(e) && e.length <= 254) {
          email = e;
          break;
        }
      }
    }
    if (!phone) {
      for (const m of scope.matchAll(/<a\b[^>]*href\s*=\s*["']tel:([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        const title = attrOf(m[0].slice(0, m[0].indexOf(">") + 1), "title");
        phone = cleanPhone(decodeURIComponent(m[1]!)) ?? cleanPhone(htmlToText(m[2]!, 200)) ?? cleanPhone(title);
        if (phone) break;
      }
    }
  }
  let address: string | null = null;
  const addr = /<address\b[^>]*>([\s\S]*?)<\/address>/i.exec(src);
  if (addr) address = htmlToText(addr[1]!, 400).replace(/\s+/g, " ").trim() || null;
  if (!address) {
    const ld = /"streetAddress"\s*:\s*"([^"]{3,120})"[\s\S]{0,300}?"postalCode"\s*:\s*"([^"]{2,12})"[\s\S]{0,300}?"addressLocality"\s*:\s*"([^"]{2,80})"/.exec(src);
    if (ld) address = `${ld[1]}, ${ld[2]} ${ld[3]}`;
  }
  if (!address) {
    const segments = foot
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .split(/<[^>]+>/)
      .map((s) => decodeEntities(s).replace(/\s+/g, " ").trim())
      .filter((s) => s.length >= 8 && s.length <= 140);
    address =
      segments.find((s) => !/@|©|&copy;|rights|http/i.test(s) && /\b\d{4,5}\b/.test(s) && /[A-Za-zÀ-ÿ]{3,}/.test(s) && (STREET.test(s) || /,\s*(\w{1,3}-)?\d{4,5}\s+[A-ZÀ-Ý]/.test(s)) && !cleanPhone(s.replace(/\b\d{4,5}\b/, "")))
      ?? null;
  }
  return { email, phone, address: address ? address.slice(0, 300) : null };
}
