/** Display helpers shared by server pages and client components (no React, no I/O). */

/** Localised ISO weekday name (1 = Monday ... 7 = Sunday). */
export function weekdayName(locale: string, isoDay: number, width: "long" | "short" = "long"): string {
  // 2026-11-16 is a Monday.
  return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 15 + isoDay)));
}

/** "Venue, street, postcode city" for display. */
export function venueLine(v: { name: string; address: string | null; postalCode: string | null; city: string | null } | undefined | null): string {
  if (!v) return "";
  const place = [v.postalCode, v.city].filter(Boolean).join(" ");
  return [v.name, v.address, place].filter(Boolean).join(", ");
}

/**
 * Public booking pages: a host that names a club (its subdomain or custom
 * domain, or an unknown club) only serves that club's slug; platform hosts
 * serve any club by slug.
 */
export function hostNamesOtherClub(tenant: { slug: string; source: string }, slug: string): boolean {
  const named = tenant.source === "custom_domain" || tenant.source === "subdomain" || tenant.source === "unknown";
  return named && tenant.slug.toLowerCase() !== slug.toLowerCase();
}
