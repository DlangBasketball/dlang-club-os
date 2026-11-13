import { isValidSlug, normalizeHost, platformRootDomain } from "./host";

/**
 * Public base URL of a tenant, for links that leave the app (emails, push,
 * PDFs, Stripe return URLs). A link must open the club's own branded host,
 * never the platform apex: on the apex, tenant resolution falls back to
 * DEFAULT_ORG_SLUG and would show another club's branding.
 *
 * Order: custom domain (platform-managed, so verified) -> https://<slug>.<PLATFORM_ROOT_DOMAIN>
 * -> NEXT_PUBLIC_SITE_URL (single-tenant / local development only).
 */
export function tenantBaseUrl(
  org: { slug?: string | null; customDomain?: string | null } | null | undefined,
  env: { rootDomain?: string | null; siteUrl?: string | null } = {},
): string {
  const custom = normalizeHost(org?.customDomain ?? null);
  if (custom) return `https://${custom}`;
  const root = env.rootDomain !== undefined ? normalizeHost(env.rootDomain) : platformRootDomain();
  const slug = org?.slug?.trim().toLowerCase();
  if (root && slug && isValidSlug(slug)) return `https://${slug}.${root}`;
  const site = env.siteUrl !== undefined ? env.siteUrl : process.env.NEXT_PUBLIC_SITE_URL;
  return (site ?? "").replace(/\/+$/, "");
}

/** Join a base URL and an app path ("/parent/invoices/…"). Absolute URLs pass through. */
export function tenantLink(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

const RAW_HOST_RE = /^[a-z0-9.-]+(?::\d{1,5})?$/;

function siteOrigin(site: string | null | undefined): { origin: string; host: string } | null {
  if (!site) return null;
  try {
    const u = new URL(site);
    return { origin: u.origin, host: u.host.toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * Origin for links that send a signed-in user away and back again (Stripe
 * Checkout success/cancel, Connect onboarding refresh/return). Auth cookies are
 * per host, so the user must come back to the host they left from, provided
 * that host belongs to the org:
 *
 *   1. request host == org custom domain or <slug>.<PLATFORM_ROOT_DOMAIN>
 *      (or <slug>.localhost in local dev)          -> that host
 *   2. request host == NEXT_PUBLIC_SITE_URL host   -> NEXT_PUBLIC_SITE_URL (platform host)
 *   3. anything else (unknown / spoofed / absent)  -> tenantBaseUrl(org)
 *
 * The request host is only ever compared against hosts derived from the org
 * row and server env, never echoed back unvalidated.
 */
export function tenantReturnOrigin(
  org: { slug?: string | null; customDomain?: string | null } | null | undefined,
  requestHost: string | null | undefined,
  env: { rootDomain?: string | null; siteUrl?: string | null } = {},
): string {
  const site = env.siteUrl !== undefined ? env.siteUrl : process.env.NEXT_PUBLIC_SITE_URL;
  const root = env.rootDomain !== undefined ? normalizeHost(env.rootDomain) : platformRootDomain();
  const raw = (requestHost ?? "").split(",")[0]!.trim().toLowerCase();
  const host = RAW_HOST_RE.test(raw) ? normalizeHost(raw) : null;

  if (host) {
    const slug = org?.slug?.trim().toLowerCase();
    const validSlug = slug && isValidSlug(slug) ? slug : null;
    const known = new Set<string>();
    const custom = normalizeHost(org?.customDomain ?? null);
    if (custom) known.add(custom);
    if (validSlug && root) known.add(`${validSlug}.${root}`);
    if (known.has(host)) return `https://${host}`;
    if (validSlug && host === `${validSlug}.localhost`) return `http://${raw}`;

    const platform = siteOrigin(site);
    // Platform host: exact host[:port] match with NEXT_PUBLIC_SITE_URL (URL.host
    // carries a port only when it is non-default, so "app.example.com:443" also matches).
    if (platform && (raw === platform.host || (!platform.host.includes(":") && host === platform.host))) {
      return platform.origin;
    }
  }

  const base = tenantBaseUrl(org, { rootDomain: root, siteUrl: site ?? null });
  return base || "http://localhost:3000";
}
