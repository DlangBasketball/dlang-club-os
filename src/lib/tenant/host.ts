/**
 * Host -> tenant parsing. Pure and Edge-safe (used by middleware and server).
 *
 *   club.example.com            -> { customDomain: "club.example.com" }
 *   dlang.<PLATFORM_ROOT_DOMAIN> -> { slug: "dlang" }
 *   dlang.localhost:3000        -> { slug: "dlang" }       (local dev)
 *   localhost / 127.0.0.1 / apex / www / *.vercel.app -> {} (use DEFAULT_ORG_SLUG)
 */

/** Request headers set by middleware (client-supplied values are overwritten). */
export const TENANT_HOST_HEADER = "x-tenant-host";
export const TENANT_SLUG_HEADER = "x-tenant-slug";
export const TENANT_DOMAIN_HEADER = "x-tenant-domain";

export type TenantHint = { slug?: string; customDomain?: string };

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Labels that are never tenant slugs (platform hosts). */
const RESERVED = new Set(["www", "app", "api", "admin", "auth", "mail", "status", "static", "assets", "cdn", "platform", "support", "help", "docs"]);

export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s) && !RESERVED.has(s);
}

/** Lower-case, strip port and trailing dot; null for empty/invalid input. */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let h = raw.split(",")[0]!.trim().toLowerCase();
  if (h.startsWith("[")) return null; // IPv6 literal — never a tenant
  h = h.replace(/:\d+$/, "").replace(/\.$/, "");
  return h || null;
}

export function platformRootDomain(): string | null {
  const v = process.env.PLATFORM_ROOT_DOMAIN ?? process.env.NEXT_PUBLIC_PLATFORM_ROOT_DOMAIN;
  return normalizeHost(v ?? null);
}

/** Hosts that belong to the platform/preview infra rather than a tenant. */
function isInfraHost(host: string): boolean {
  return (
    host === "localhost" ||
    IPV4_RE.test(host) ||
    host.endsWith(".vercel.app") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  );
}

export function parseTenantHost(rawHost: string | null | undefined, rootDomain: string | null = platformRootDomain()): TenantHint {
  const host = normalizeHost(rawHost);
  if (!host) return {};

  // <slug>.localhost — browsers resolve *.localhost to 127.0.0.1.
  if (host.endsWith(".localhost")) {
    const label = host.slice(0, -".localhost".length);
    return !label.includes(".") && isValidSlug(label) ? { slug: label } : {};
  }

  if (isInfraHost(host)) return {};

  if (rootDomain) {
    if (host === rootDomain || host === `www.${rootDomain}`) return {};
    if (host.endsWith(`.${rootDomain}`)) {
      const label = host.slice(0, -(rootDomain.length + 1));
      // Only single-label subdomains are tenants.
      return !label.includes(".") && isValidSlug(label) ? { slug: label } : {};
    }
  }

  return DOMAIN_RE.test(host) ? { customDomain: host } : {};
}
