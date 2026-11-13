import type { NextRequest } from "next/server";
import {
  TENANT_DOMAIN_HEADER,
  TENANT_HOST_HEADER,
  TENANT_SLUG_HEADER,
  normalizeHost,
  parseTenantHost,
} from "./host";

/**
 * Middleware step: derive the tenant hint from the Host header and forward it
 * to the app as request headers. Any client-supplied x-tenant-* headers are
 * removed first so they can't be spoofed. No DB call here (Edge runtime) —
 * getTenant() does the lookup, cached, on the server.
 *
 * Must run BEFORE updateSession(), which snapshots the request headers into
 * NextResponse.next({ request }).
 */
export function applyTenantHeaders(request: NextRequest): void {
  const h = request.headers;
  h.delete(TENANT_HOST_HEADER);
  h.delete(TENANT_SLUG_HEADER);
  h.delete(TENANT_DOMAIN_HEADER);

  const host = normalizeHost(h.get("host") ?? request.nextUrl.host);
  if (!host) return;
  h.set(TENANT_HOST_HEADER, host);

  const hint = parseTenantHost(host);
  if (hint.slug) h.set(TENANT_SLUG_HEADER, hint.slug);
  if (hint.customDomain) h.set(TENANT_DOMAIN_HEADER, hint.customDomain);
}
