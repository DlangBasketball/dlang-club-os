/**
 * Service worker for the installable club app. Deliberately tiny and
 * framework-free; served by src/app/sw.js/route.ts at /sw.js (scope "/").
 *
 * Caching policy (privacy first: most athletes are minors):
 *   - "static":   same-origin, hashed build assets (/_next/static/*) and the
 *                 generated app icons -> cache-first.
 *   - "navigate": page navigations -> network-first; when the network fails
 *                 the translated offline page is shown. Navigation responses
 *                 are NEVER written to the cache (pages can hold personal data).
 *   - "bypass":   everything else, untouched by the worker: API routes, auth,
 *                 server-component/data payloads, image proxy (may carry
 *                 signed athlete photos), PDF downloads, cross-origin,
 *                 non-GET, anything with an Authorization header.
 */

export type SwRequestInfo = {
  url: string;
  /** The service worker's own origin (self.location.origin). */
  origin: string;
  method: string;
  /** Request.mode: "navigate" for page loads. */
  mode: string;
  hasAuthorization?: boolean;
  /** Next.js server-component payload request (RSC header). */
  isRsc?: boolean;
};
export type SwStrategy = "static" | "navigate" | "bypass";

/**
 * The request matcher. It is serialised verbatim into /sw.js (see
 * buildServiceWorkerScript), so it must stay SELF-CONTAINED: no imports, no
 * references to module-level constants, plain ES2017.
 */
export function swRequestPolicy(req: SwRequestInfo): SwStrategy {
  const NEVER_PREFIXES = ["/api", "/auth", "/_next/data", "/_next/image", "/sw.js", "/manifest.webmanifest", "/offline"];
  const STATIC_PREFIXES = ["/_next/static/", "/pwa/icon/"];

  if (String(req.method || "GET").toUpperCase() !== "GET") return "bypass";
  if (req.hasAuthorization || req.isRsc) return "bypass";
  let u: URL;
  try {
    u = new URL(req.url, req.origin);
  } catch {
    return "bypass";
  }
  if (u.origin !== req.origin) return "bypass";
  if (u.searchParams.has("_rsc")) return "bypass";
  const path = u.pathname;
  for (let i = 0; i < NEVER_PREFIXES.length; i++) {
    const p = NEVER_PREFIXES[i] as string;
    if (path === p || path.startsWith(p + "/")) return "bypass";
  }
  // File downloads (e.g. invoice PDFs) go straight to the network.
  if (/\/pdf$|\.pdf$/i.test(path)) return "bypass";
  if (req.mode === "navigate") return "navigate";
  for (let i = 0; i < STATIC_PREFIXES.length; i++) {
    if (path.startsWith(STATIC_PREFIXES[i] as string)) return "static";
  }
  return "bypass";
}

export const OFFLINE_PATH = "/offline";
export const SW_CACHE_PREFIX = "club-app-";
export const SW_MAX_STATIC_ENTRIES = 200;

/** Cache version: changes per deployment so old static caches are dropped. */
export function swVersion(env: Record<string, string | undefined> = process.env): string {
  const raw = env.VERCEL_DEPLOYMENT_ID || env.VERCEL_GIT_COMMIT_SHA || env.NEXT_PUBLIC_APP_VERSION || "v1";
  return raw.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40) || "v1";
}

/** The full /sw.js source. */
export function buildServiceWorkerScript(version: string): string {
  const v = JSON.stringify(version.replace(/[^A-Za-z0-9_.-]/g, "") || "v1");
  return `/* Club app service worker. Generated; see src/lib/pwa/service-worker.ts. */
"use strict";
const VERSION = ${v};
const PREFIX = ${JSON.stringify(SW_CACHE_PREFIX)};
const STATIC_CACHE = PREFIX + "static-" + VERSION;
const OFFLINE_CACHE = PREFIX + "offline-" + VERSION;
const OFFLINE_URL = ${JSON.stringify(OFFLINE_PATH)};
const MAX_STATIC = ${SW_MAX_STATIC_ENTRIES};
const policy = (${swRequestPolicy.toString()});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      // Signed out on purpose: the cached offline page holds no personal data.
      .then((cache) => cache.add(new Request(OFFLINE_URL, { credentials: "omit", cache: "reload" })))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== STATIC_CACHE && k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_STATIC; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  const cc = response.headers.get("cache-control") || "";
  if (response.ok && response.type === "basic" && !/no-store|private/i.test(cc)) {
    cache.put(request, response.clone()).then(() => trim(cache)).catch(() => undefined);
  }
  return response;
}

async function networkFirstNavigation(request) {
  try {
    // Never cached: pages can contain personal data.
    return await fetch(request);
  } catch (err) {
    const cache = await caches.open(OFFLINE_CACHE);
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const strategy = policy({
    url: request.url,
    origin: self.location.origin,
    method: request.method,
    mode: request.mode,
    hasAuthorization: request.headers.has("authorization"),
    isRsc: request.headers.has("rsc"),
  });
  if (strategy === "navigate") event.respondWith(networkFirstNavigation(request));
  else if (strategy === "static") event.respondWith(cacheFirst(request));
  // "bypass": no respondWith -> the browser handles the request normally.
});
`;
}
