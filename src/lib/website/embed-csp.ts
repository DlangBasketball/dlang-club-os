import { frameAncestorsCsp, isValidOrigin } from "./origins";

/**
 * Per-club CSP for /embed pages, computed in middleware (Edge runtime: no
 * Node APIs, no service-role key). The club's allowed origins come from the
 * anon-callable public.website_embed_origins() RPC, which returns origins only
 * for a club whose website connection is enabled (origins are public anyway:
 * they end up in this header). Cached per instance for 60 s.
 */

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; origins: string[] }>();

export function isEmbedPath(pathname: string): boolean {
  return pathname === "/embed" || pathname.startsWith("/embed/");
}

export async function embedOrigins(hint: { slug?: string | null; host?: string | null }): Promise<string[]> {
  const slug = hint.slug && /^[a-z0-9][a-z0-9-]{0,62}$/.test(hint.slug) ? hint.slug : null;
  const host = hint.host && /^[a-z0-9.-]{1,253}$/.test(hint.host) ? hint.host : null;
  if (!slug && !host) return [];
  const key = `${slug ?? ""}|${host ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.origins;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return [];
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/website_embed_origins`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_slug: slug, p_host: host }),
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    const origins = Array.isArray(data) ? data.filter((o): o is string => typeof o === "string" && isValidOrigin(o)) : [];
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: Date.now(), origins });
    return origins;
  } catch {
    return [];
  }
}

export async function embedCspHeader(hint: { slug?: string | null; host?: string | null }): Promise<string> {
  return frameAncestorsCsp(await embedOrigins(hint));
}
