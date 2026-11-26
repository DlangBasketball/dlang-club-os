/**
 * Simple fixed-window rate limiter, in memory, per server instance.
 *
 * Public website API limit: PUBLIC_API_LIMIT requests per PUBLIC_API_WINDOW_MS
 * per client IP (per instance; a serverless deployment with several warm
 * instances allows a multiple of it). The CDN cache (s-maxage=60) absorbs
 * most website traffic before it reaches this limiter. The map is bounded so
 * a flood of distinct IPs cannot exhaust memory.
 */

export const PUBLIC_API_LIMIT = 120;
export const PUBLIC_API_WINDOW_MS = 60_000;

export type RateLimitResult = { ok: boolean; remaining: number; resetAt: number };

export function createRateLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const maxKeys = opts.maxKeys ?? 10_000;
  return {
    check(key: string, now: number = Date.now()): RateLimitResult {
      let e = hits.get(key);
      if (!e || now >= e.resetAt) {
        if (!e && hits.size >= maxKeys) {
          for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
          if (hits.size >= maxKeys) hits.clear();
        }
        e = { count: 0, resetAt: now + opts.windowMs };
        hits.set(key, e);
      }
      e.count++;
      return { ok: e.count <= opts.limit, remaining: Math.max(0, opts.limit - e.count), resetAt: e.resetAt };
    },
    reset() {
      hits.clear();
    },
    size() {
      return hits.size;
    },
  };
}

/** Client IP from proxy headers (first X-Forwarded-For hop, then X-Real-IP). */
export function clientIp(headers: { get(name: string): string | null }): string {
  const xff = headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return (first || headers.get("x-real-ip")?.trim() || "unknown").slice(0, 64);
}
