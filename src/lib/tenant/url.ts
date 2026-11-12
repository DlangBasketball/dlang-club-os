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
