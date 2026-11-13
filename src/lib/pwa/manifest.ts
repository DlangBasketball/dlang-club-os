import type { Tenant } from "@/lib/tenant/types";
import { DEFAULT_BRANDING } from "@/lib/tenant/defaults";
import { isHexColor, normalizeHex } from "@/lib/tenant/theme";

/**
 * Per-tenant Progressive Web App manifest. Pure and isomorphic: the route
 * handler (src/app/manifest.webmanifest/route.ts) resolves the tenant from the
 * request host and passes it in; unit tests pass synthetic tenants.
 *
 * Nothing here is personal data: only the club's public branding.
 */

/** Generated icon variants served by src/app/pwa/icon/[variant]/route.tsx. */
export const PWA_ICON_VARIANTS = {
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  "maskable-512": { size: 512, maskable: true },
  "apple-touch": { size: 180, maskable: false },
} as const;
export type PwaIconVariant = keyof typeof PWA_ICON_VARIANTS;

export function isPwaIconVariant(v: string): v is PwaIconVariant {
  return Object.prototype.hasOwnProperty.call(PWA_ICON_VARIANTS, v);
}

export const MANIFEST_PATH = "/manifest.webmanifest";
export const SHORT_NAME_MAX = 12;

export type ManifestIcon = { src: string; sizes: string; type: string; purpose: "any" | "maskable" };

export type WebManifest = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  lang: string;
  dir: "ltr";
  start_url: string;
  scope: string;
  display: "standalone";
  background_color: string;
  theme_color: string;
  categories: string[];
  icons: ManifestIcon[];
};

export type ManifestTenant = Pick<Tenant, "name" | "appName" | "defaultLocale" | "branding">;

/**
 * Home-screen label: browsers truncate around 12 characters, so use the app
 * name when it fits, else its first word, else a hard cut.
 */
export function shortNameFor(appName: string): string {
  const name = appName.replace(/\s+/g, " ").trim();
  if (!name) return name;
  if (name.length <= SHORT_NAME_MAX) return name;
  const first = name.split(" ")[0]!;
  if (first.length <= SHORT_NAME_MAX) return first;
  return name.slice(0, SHORT_NAME_MAX).trim();
}

/** BCP 47 tag for the manifest; tolerant of "fr_CH" / empty values. */
export function manifestLang(locale: string | null | undefined): string {
  const v = (locale ?? "").trim().replace("_", "-");
  return /^[a-zA-Z]{2,3}(-[a-zA-Z]{2})?$/.test(v) ? v : "en";
}

function color(v: string | null | undefined, fallback: string): string {
  return isHexColor(v) ? normalizeHex(v) : fallback;
}

/**
 * Short, stable cache-buster for icon URLs: changes when anything that is
 * drawn into the icons changes (name, logo, colours), so a re-brand reaches
 * installed apps the next time the browser refreshes the manifest.
 */
export function iconVersion(t: ManifestTenant): string {
  const src = [t.appName, t.branding.logoUrl ?? "", t.branding.colors.primary, t.branding.colors.primaryDark, t.branding.colors.background].join("|");
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function iconUrl(variant: PwaIconVariant, version: string): string {
  return `/pwa/icon/${variant}?v=${version}`;
}

export function buildWebManifest(tenant: ManifestTenant, opts: { description: string }): WebManifest {
  const appName = tenant.appName.trim() || tenant.name.trim();
  const colors = tenant.branding?.colors;
  const background = color(colors?.background, DEFAULT_BRANDING.colors.background);
  const v = iconVersion(tenant);
  const icons: ManifestIcon[] = (["192", "512", "maskable-512"] as const).map((variant) => {
    const spec = PWA_ICON_VARIANTS[variant];
    return {
      src: iconUrl(variant, v),
      sizes: `${spec.size}x${spec.size}`,
      type: "image/png",
      purpose: spec.maskable ? "maskable" : "any",
    };
  });
  return {
    id: "/",
    name: appName,
    short_name: shortNameFor(appName),
    description: opts.description,
    lang: manifestLang(tenant.defaultLocale),
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: background,
    // Matches <meta name="theme-color"> from the root layout.
    theme_color: background,
    categories: ["sports", "education", "lifestyle"],
    icons,
  };
}

/** Colours for a generated monogram icon (brand gradient, readable letter). */
export function monogramColors(tenant: ManifestTenant): { from: string; to: string } {
  const c = tenant.branding?.colors;
  return {
    from: color(c?.primary, DEFAULT_BRANDING.colors.primary),
    to: color(c?.primaryDark, DEFAULT_BRANDING.colors.primaryDark),
  };
}

/** First letter or digit of the app name ("DLang OS" -> "D"). */
export function iconMonogram(appName: string): string {
  const ch = appName.trim().match(/[\p{L}\p{N}]/u)?.[0];
  return (ch ?? "C").toUpperCase();
}

/**
 * Logo URLs the icon route may fetch server-side. Admin-entered, so guard
 * against SSRF: https only, a DNS name (no IP literals), no local/internal
 * hosts, no credentials, standard port.
 */
export function isFetchableLogoUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (/(^|\.)(localhost|local|internal|localdomain|home|lan|intranet|corp)$/.test(host)) return false;
  return true;
}
