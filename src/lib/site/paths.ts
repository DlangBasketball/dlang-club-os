import { langSlug, tagFromSlug } from "./languages";

/**
 * Site paths and the reserved-path guard.
 *
 * A club's site pages live at clean paths on the club's host ("/",
 * "/about-us", "/camps/summer-camps", "/news/<slug>"), the same paths as its
 * previous website. Every path whose FIRST segment the app itself serves
 * always wins: the site never shadows admin, login, registration, booking,
 * the shop, embeds, the API, Next.js internals, ... The list mirrors
 * public.site_path_reserved() in the migration; tests/unit/site-routing.test.ts
 * proves every top-level route under src/app is listed.
 *
 * Non-default languages are served under their tag prefix (/fr/about-us,
 * /de-ch/camps); the default language has no prefix.
 */

export const RESERVED_SEGMENTS = [
  "admin", "coach", "parent", "player", "platform", "login", "auth", "register", "book", "shop", "club", "embed",
  "embed.js", "api", "board", "scout", "waitlist", "onboarding", "signup", "legal", "offline", "pwa",
  "sw.js", "manifest.webmanifest", "_next", "favicon.ico", "sitemap.xml", "robots.txt", "icon",
  "apple-icon", "opengraph-image", "monitoring",
] as const;

const RESERVED = new Set<string>(RESERVED_SEGMENTS);

/** First path segment, lower-cased ("" for "/"). */
export function firstSegment(pathname: string): string {
  return (pathname.replace(/^\/+/, "").split(/[/?#]/)[0] ?? "").toLowerCase();
}

/** True when the app serves this path itself (the site must never answer it). */
export function isReservedPath(pathname: string): boolean {
  const seg = firstSegment(pathname);
  if (!seg) return false;
  if (RESERVED.has(seg)) return true;
  // Next.js metadata / internal files and dot-files are never site pages.
  return seg.startsWith("_") || seg.startsWith(".");
}

const SEGMENT_RE = /^[a-z0-9][a-z0-9_%-]{0,119}$/;

/** Mirrors public.site_path_valid(): "/" or 1-4 lower-case segments, not reserved. */
export function isValidSitePath(path: string): boolean {
  if (path === "/") return true;
  if (typeof path !== "string" || path.length > 300 || !path.startsWith("/")) return false;
  const segs = path.slice(1).split("/");
  if (segs.length < 1 || segs.length > 4) return false;
  if (!segs.every((s) => SEGMENT_RE.test(s))) return false;
  return !isReservedPath(path);
}

/** "Über uns!" -> "uber-uns"; empty -> "". */
export function slugify(input: string, max = 80): string {
  return String(input ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/**
 * Normalise a requested pathname for lookup: strip query / hash, collapse
 * slashes, drop the trailing slash, lower-case percent-escapes (WordPress
 * writes them lower-case) and ASCII letters. Returns null for anything that
 * can never be a site path ("..", control characters, over-long).
 */
export function normalizeRequestPath(pathname: string): string | null {
  let p = String(pathname ?? "").split(/[?#]/)[0] ?? "";
  if (p.length > 400 || /[\u0000-\u001f\\]/.test(p)) return null;
  p = p.replace(/\/{2,}/g, "/");
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  if (p.split("/").some((s) => s === ".." || s === ".")) return null;
  p = p.replace(/%[0-9A-F]{2}/gi, (m) => m.toLowerCase()).toLowerCase();
  return p || "/";
}

export type SplitPath = {
  /** Content language of the request. */
  lang: string;
  /** Language-neutral page path ("/", "/about-us"). */
  path: string;
  /** The URL carried the default language's prefix: redirect to the clean URL. */
  redundantPrefix: boolean;
};

/** "/fr/about-us" -> { lang: "fr", path: "/about-us" } when fr is enabled and not the default. */
export function splitLangPath(pathname: string, languages: readonly string[], defaultLang: string): SplitPath | null {
  const p = normalizeRequestPath(pathname);
  if (!p) return null;
  const segs = p === "/" ? [] : p.slice(1).split("/");
  const tag = tagFromSlug(segs[0], languages);
  if (!tag) return { lang: defaultLang, path: p, redundantPrefix: false };
  const rest = segs.slice(1);
  const path = rest.length ? `/${rest.join("/")}` : "/";
  return { lang: tag, path, redundantPrefix: tag.toLowerCase() === defaultLang.toLowerCase() };
}

/** Public URL path of a page in a language ("/about-us", "fr" -> "/fr/about-us"). */
export function localizedPath(path: string, lang: string, defaultLang: string): string {
  if (lang.toLowerCase() === defaultLang.toLowerCase()) return path;
  return `/${langSlug(lang)}${path === "/" ? "" : path}`;
}

/** Redirect targets: an internal path or an https URL (never //host, javascript:, data:). */
export function isSafeRedirectTarget(to: string): boolean {
  if (typeof to !== "string" || !to || to.length > 500 || /\s/.test(to)) return false;
  if (to.startsWith("//") || to.startsWith("/\\")) return false;
  if (to.startsWith("/")) return true;
  try {
    const u = new URL(to);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}

export type RedirectRule = { from_path: string; to_path: string; status_code: number };

/** First rule matching the path (exact, or ignoring a trailing slash / case). */
export function resolveRedirect(rules: readonly RedirectRule[], pathname: string): { to: string; status: 301 | 302 } | null {
  const want = normalizeRequestPath(pathname);
  if (!want) return null;
  for (const r of rules) {
    const from = normalizeRequestPath(r.from_path);
    if (from === want && isSafeRedirectTarget(r.to_path) && normalizeRequestPath(r.to_path) !== want) {
      return { to: r.to_path, status: r.status_code === 302 ? 302 : 301 };
    }
  }
  return null;
}

/** Path of a WordPress URL on its own host ("https://club.ch/about-us/" -> "/about-us"). */
export function pathOfUrl(url: string): string | null {
  try {
    return normalizeRequestPath(new URL(url).pathname);
  } catch {
    return null;
  }
}

/** News posts are served under this prefix (/news/<slug>). */
export const NEWS_PREFIX = "/news";

export function postPath(slug: string): string {
  return `${NEWS_PREFIX}/${slug}`;
}

/** "/news/<slug>" -> slug, else null. */
export function postSlugOf(path: string): string | null {
  const m = /^\/news\/([a-z0-9][a-z0-9_%-]{0,159})$/.exec(path);
  return m ? m[1]! : null;
}
