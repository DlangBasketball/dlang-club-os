import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { fallbackTenant } from "./defaults";
import {
  TENANT_DOMAIN_HEADER,
  TENANT_HOST_HEADER,
  TENANT_SLUG_HEADER,
  isValidSlug,
  normalizeHost,
  parseTenantHost,
  type TenantHint,
} from "./host";
import { rowToTenant } from "./normalize";
import type { PublicTenantRow, Tenant } from "./types";

/**
 * Server-side tenant resolution.
 *
 *   const tenant = await getTenant();   // cached for the request (React cache)
 *
 * Order: custom domain -> <slug>.<PLATFORM_ROOT_DOMAIN> -> DEFAULT_ORG_SLUG.
 * Lookups go through public.get_public_tenant() with the ANON key — it only
 * returns public-safe branding columns, so no service-role key is needed and
 * nothing private can leak into the page.
 *
 * A small in-process TTL cache avoids a DB round-trip per request; branding
 * saves call invalidateTenantCache().
 */

const TTL_MS = 60_000;
const LOOKUP_TIMEOUT_MS = 2_500;
const memo = new Map<string, { at: number; row: PublicTenantRow | null }>();

export function invalidateTenantCache(): void {
  memo.clear();
}

export function defaultOrgSlug(): string | null {
  const s = process.env.DEFAULT_ORG_SLUG?.trim().toLowerCase();
  return s && isValidSlug(s) ? s : null;
}

async function lookup(hint: { host?: string; slug?: string }): Promise<PublicTenantRow | null | "error"> {
  const key = `${hint.host ?? ""}|${hint.slug ?? ""}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.row;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return "error";

  try {
    const sb = createSupabaseClient<Database>(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) }),
      },
    });
    const { data, error } = await sb.rpc("get_public_tenant", {
      p_host: hint.host ?? null,
      p_slug: hint.slug ?? null,
    });
    if (error) return "error";
    const row = ((Array.isArray(data) ? data[0] : data) as PublicTenantRow | undefined) ?? null;
    if (memo.size > 500) memo.clear();
    memo.set(key, { at: Date.now(), row });
    return row;
  } catch {
    return "error";
  }
}

/** Read the tenant hint from middleware headers, falling back to the Host header. */
async function readHint(): Promise<TenantHint & { host: string | null }> {
  const h = await headers();
  const host = h.get(TENANT_HOST_HEADER) ?? normalizeHost(h.get("host"));
  const slug = h.get(TENANT_SLUG_HEADER) ?? undefined;
  const customDomain = h.get(TENANT_DOMAIN_HEADER) ?? undefined;
  if (slug || customDomain) return { host, slug, customDomain };
  return { host, ...parseTenantHost(host) };
}

export async function resolveTenant(hint: TenantHint): Promise<Tenant> {
  if (hint.customDomain) {
    const row = await lookup({ host: hint.customDomain });
    if (row && row !== "error") return rowToTenant(row, "custom_domain");
    if (row === null) return fallbackTenant(hint.customDomain, "unknown");
    return fallbackTenant(defaultOrgSlug() ?? "default");
  }
  if (hint.slug) {
    const row = await lookup({ slug: hint.slug });
    if (row && row !== "error") return rowToTenant(row, "subdomain");
    if (row === null) return fallbackTenant(hint.slug, "unknown");
    return fallbackTenant(hint.slug);
  }
  const def = defaultOrgSlug();
  if (def) {
    const row = await lookup({ slug: def });
    if (row && row !== "error") return rowToTenant(row, "default");
  }
  return fallbackTenant(def ?? "default");
}

/**
 * Slug of the signed-in user's own org, or null (signed out, no org, error).
 * RLS (org_select) lets a member read exactly their own organizations row.
 */
async function signedInOrgSlug(): Promise<string | null> {
  try {
    const sb = await createServerClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return null;
    const { data: profile } = await sb.from("profiles").select("org_id").eq("id", user.id).maybeSingle();
    if (!profile?.org_id) return null;
    const { data: org } = await sb.from("organizations").select("slug").eq("id", profile.org_id).maybeSingle();
    const slug = org?.slug?.toLowerCase() ?? null;
    return slug && isValidSlug(slug) ? slug : null;
  } catch {
    return null;
  }
}

/**
 * True when the host names no tenant (apex, www, app.<root>, preview/infra
 * hosts): the page is on the platform, not on a specific club's site.
 */
export function isPlatformHint(hint: TenantHint): boolean {
  return !hint.slug && !hint.customDomain;
}

/** The current request's tenant. Cached per request. Never throws. */
export const getTenant = cache(async (): Promise<Tenant> => {
  // readHint() calls headers(): this deliberately opts every page into
  // dynamic rendering (a tenant is per-request). Its bail-out signal must
  // propagate, so it stays outside the try/catch.
  const hint = await readHint();
  try {
    // On a platform host (apex/app/preview) a signed-in member works in their
    // OWN club: resolve its branding/locale instead of DEFAULT_ORG_SLUG's, so a
    // self-signed-up club never sees (or is blocked by) the founding club.
    if (isPlatformHint(hint)) {
      const own = await signedInOrgSlug();
      if (own) {
        const row = await lookup({ slug: own });
        if (row && row !== "error") return rowToTenant(row, "default");
      }
    }
    return await resolveTenant(hint);
  } catch {
    return fallbackTenant(defaultOrgSlug() ?? "default");
  }
});

/**
 * Guard for server actions / data loaders: the signed-in user's org must be
 * the tenant the request was made on. Returns false on mismatch so callers
 * can refuse (prevents org A's admin acting through org B's domain).
 * Unresolved tenants (id null, e.g. local fallback) don't block.
 */
export async function tenantMatchesOrg(orgId: string | null | undefined): Promise<boolean> {
  const t = await getTenant();
  return orgMatchesTenant(orgId, t);
}

/**
 * Pure rule behind tenantMatchesOrg. Only a host that NAMES a club
 * (subdomain / custom domain) can mismatch; platform hosts (source "default"
 * or "fallback") don't belong to any one club, so the user's own org wins.
 */
export function orgMatchesTenant(orgId: string | null | undefined, t: Pick<Tenant, "id" | "source">): boolean {
  if (!t.id) return true;
  if (t.source === "default" || t.source === "fallback") return Boolean(orgId);
  return Boolean(orgId) && orgId === t.id;
}
