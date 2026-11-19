/**
 * Website origins: CORS, CSP frame-ancestors, postMessage targets and
 * return_to links. Pure + isomorphic (middleware/edge, route handlers, unit
 * tests). An "origin" here is always an exact https origin, lowercase, with
 * an optional explicit port and nothing else (no path, no wildcard): the same
 * rule as public.website_origins_valid() in the database.
 */

export const MAX_ORIGINS = 20;

const ORIGIN_RE = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$/;

/** Normalise one origin typed by an admin ("https://WWW.Club.ch/" -> "https://www.club.ch"); null when invalid. */
export function normalizeOrigin(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 255 || raw.includes("*")) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  // Only a bare origin (an optional trailing slash is tolerated).
  if ((u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return null;
  const origin = u.origin.toLowerCase();
  return ORIGIN_RE.test(origin) ? origin : null;
}

export function isValidOrigin(o: string): boolean {
  return ORIGIN_RE.test(o);
}

/**
 * Parse an admin's list (newline / comma separated) into unique, valid
 * origins. Returns the invalid entries too, so the form can name them.
 */
export function parseOriginList(text: string | string[]): { origins: string[]; invalid: string[] } {
  const parts = (Array.isArray(text) ? text : text.split(/[\s,]+/)).map((s) => s.trim()).filter(Boolean);
  const origins: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    const o = normalizeOrigin(p);
    if (!o) invalid.push(p);
    else if (!origins.includes(o)) origins.push(o);
  }
  return { origins: origins.slice(0, MAX_ORIGINS), invalid };
}

/** Exact match of a request Origin header against the allowed list. */
export function isAllowedOrigin(origin: string | null | undefined, allowed: readonly string[]): origin is string {
  if (!origin) return false;
  const o = origin.trim().toLowerCase();
  if (!ORIGIN_RE.test(o)) return false;
  return allowed.some((a) => a === o);
}

/**
 * CORS headers for the public API. Access-Control-Allow-Origin echoes the
 * Origin only when it is allowed (never "*"); Vary: Origin always, so shared
 * caches keep one copy per origin.
 */
export function corsHeaders(origin: string | null | undefined, allowed: readonly string[]): Record<string, string> {
  const h: Record<string, string> = { Vary: "Origin" };
  if (isAllowedOrigin(origin, allowed)) {
    h["Access-Control-Allow-Origin"] = origin.trim().toLowerCase();
    h["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Accept, Accept-Language, If-None-Match";
    h["Access-Control-Expose-Headers"] = "ETag";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

/**
 * CSP for /embed pages: frameable by the app itself and the club's allowed
 * website origins only. Invalid entries are dropped, so a bad value can never
 * inject another directive.
 */
export function frameAncestorsCsp(allowed: readonly string[]): string {
  const list = allowed.filter((o) => ORIGIN_RE.test(o));
  return `frame-ancestors 'self'${list.length ? ` ${list.join(" ")}` : ""}`;
}

/** The parent origin an embed may post its height to (?origin=), or null. */
export function embedParentOrigin(param: string | null | undefined, allowed: readonly string[]): string | null {
  const o = normalizeOrigin(param ?? null);
  return o && allowed.includes(o) ? o : null;
}

/**
 * Validate a return_to link (where checkout / login sends the visitor back
 * to): an absolute https URL on one of the allowed origins. Returns the
 * normalised URL or null.
 */
export function safeReturnTo(value: string | null | undefined, allowed: readonly string[]): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 1000) return null;
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (!allowed.includes(u.origin.toLowerCase())) return null;
  return u.toString();
}
