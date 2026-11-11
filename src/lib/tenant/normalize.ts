import { DEFAULT_BRANDING, DEFAULT_LIGHT_COLORS } from "./defaults";
import { normalizeTerminology } from "./terms";
import { safeFont, sanitizeColors } from "./theme";
import type { PublicTenantRow, Tenant, TenantBranding, TenantSource, TenantStatus } from "./types";

const URL_RE = /^(https:\/\/[^\s"'<>()]+|\/[^\s"'<>()]*)$/;
const safeUrl = (v: unknown): string | null => (typeof v === "string" && v && URL_RE.test(v) ? v : null);

/** Stored branding jsonb (snake_case) -> complete, sanitised TenantBranding. */
export function normalizeBranding(input: unknown): TenantBranding {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const darkMode = typeof o.dark_mode === "boolean" ? o.dark_mode : DEFAULT_BRANDING.darkMode;
  const base = darkMode ? DEFAULT_BRANDING.colors : DEFAULT_LIGHT_COLORS;
  const fonts = (o.fonts && typeof o.fonts === "object" ? o.fonts : {}) as Record<string, unknown>;
  return {
    logoUrl: safeUrl(o.logo_url),
    faviconUrl: safeUrl(o.favicon_url),
    colors: sanitizeColors(o.colors, base),
    fonts: {
      display: safeFont(fonts.display, DEFAULT_BRANDING.fonts.display),
      ui: safeFont(fonts.ui, DEFAULT_BRANDING.fonts.ui),
      mono: safeFont(fonts.mono, DEFAULT_BRANDING.fonts.mono),
    },
    darkMode,
  };
}

/** TenantBranding -> jsonb shape stored in organizations.branding. */
export function brandingToJson(b: TenantBranding) {
  return {
    logo_url: b.logoUrl,
    favicon_url: b.faviconUrl,
    colors: { ...b.colors },
    fonts: { ...b.fonts },
    dark_mode: b.darkMode,
  };
}

const STATUSES: TenantStatus[] = ["trial", "active", "suspended"];

export function rowToTenant(row: PublicTenantRow, source: TenantSource): Tenant {
  const supported = Array.isArray(row.supported_locales) && row.supported_locales.length ? row.supported_locales : ["en"];
  const defaultLocale = row.default_locale && supported.includes(row.default_locale) ? row.default_locale : supported[0]!;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    customDomain: row.custom_domain,
    branding: normalizeBranding(row.branding),
    terminology: normalizeTerminology(row.terminology),
    sport: row.sport,
    country: row.country ?? "CH",
    defaultLocale,
    supportedLocales: supported,
    currency: row.currency ?? "CHF",
    timezone: row.timezone ?? "UTC",
    status: STATUSES.includes(row.status as TenantStatus) ? (row.status as TenantStatus) : "active",
    source,
  };
}
