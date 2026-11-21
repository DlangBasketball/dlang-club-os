import type { TenantBranding, TenantColors } from "@/lib/tenant/types";
import { DEFAULT_LIGHT_COLORS } from "@/lib/tenant/defaults";
import {
  brandingContrastChecks,
  brandingToCssVars,
  contrastRatio,
  googleFontsHref,
  isDarkPalette,
  isHexColor,
  normalizeHex,
  readableOn,
  safeFont,
  sanitizeColors,
  type ContrastCheck,
} from "@/lib/tenant/theme";
import { siteFontByFamily, siteFontVar } from "./fonts";

/**
 * Site templates. All three are driven by the SAME CSS variables as the app
 * (src/app/globals.css token contract), scoped onto the site wrapper, so a
 * club's brand colours, logo and fonts apply everywhere:
 *
 *   arena    dark luxury: the club's own app palette (V5 tokens by default),
 *            big full-bleed photography, display serif headlines
 *   court    light editorial: warm paper background, the club's brand colour
 *            as accent, generous white space
 *   classic  sporty: light background, bold uppercase UI-font headlines,
 *            brand-coloured bands
 *
 * Palette overrides (site_settings.palette) apply on top. Every pair the
 * site uses is contrast-checked (WCAG AA); unreadable text colours are
 * corrected automatically by brandingToCssVars() (ensureContrast).
 */

export const SITE_TEMPLATES = ["arena", "court", "classic"] as const;
export type SiteTemplate = (typeof SITE_TEMPLATES)[number];

export function isSiteTemplate(v: unknown): v is SiteTemplate {
  return typeof v === "string" && (SITE_TEMPLATES as readonly string[]).includes(v);
}

export type SitePalette = Partial<Pick<TenantColors, "primary" | "accent" | "background" | "surface" | "text">>;
/** display / ui: font family names; uppercase: headlines in capitals (sporty condensed look). */
export type SiteFonts = { display?: string; ui?: string; uppercase?: boolean };

/** Keep only valid #rrggbb values. */
export function cleanPalette(input: unknown): SitePalette {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: SitePalette = {};
  for (const k of ["primary", "accent", "background", "surface", "text"] as const) if (isHexColor(o[k])) out[k] = normalizeHex(o[k] as string);
  return out;
}

export function cleanFonts(input: unknown): SiteFonts {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: SiteFonts = {};
  for (const k of ["display", "ui"] as const) {
    const f = safeFont(o[k], "");
    if (f) out[k] = f;
  }
  if (o.uppercase === true) out.uppercase = true;
  return out;
}

/** Template base colours from the club's brand (primary / accent kept). */
export function templateColors(template: SiteTemplate, brand: TenantColors): TenantColors {
  const c = sanitizeColors(brand);
  if (template === "arena") {
    // The club's own palette; a light club palette is turned dark for "arena".
    if (isDarkPalette({ colors: c } as TenantBranding)) return c;
    return sanitizeColors({ ...c, background: DARK_BG, surface: DARK_SURFACE, text: DARK_TEXT });
  }
  if (template === "court") return sanitizeColors({ ...c, background: PAPER_BG, surface: PAPER_SURFACE, text: INK_TEXT });
  return sanitizeColors({ ...c, background: DEFAULT_LIGHT_COLORS.background, surface: "#FFFFFF", text: CLASSIC_TEXT });
}

// Template base tones (data, mapped to CSS variables; never used directly in components).
const DARK_BG = "#0A0A0A";
const DARK_SURFACE = "#1A1A1A";
const DARK_TEXT = "#F1F1F1";
const PAPER_BG = "#F8F5EF";
const PAPER_SURFACE = "#FFFFFF";
const INK_TEXT = "#16130F";
const CLASSIC_TEXT = "#0E1520";

export type SiteThemeInput = { template: SiteTemplate; branding: TenantBranding; palette?: SitePalette; fonts?: SiteFonts };

/** Effective branding of the site (template, then overrides). */
export function siteBranding(input: SiteThemeInput): TenantBranding {
  const base = templateColors(input.template, input.branding.colors);
  const p = cleanPalette(input.palette);
  const colors = sanitizeColors({ ...base, ...p, primaryDark: p.primary ? darker(p.primary) : base.primaryDark });
  const f = cleanFonts(input.fonts);
  return {
    ...input.branding,
    colors,
    darkMode: isDarkPalette({ ...input.branding, colors }),
    fonts: { ...input.branding.fonts, ...(f.display ? { display: f.display } : {}), ...(f.ui ? { ui: f.ui } : {}) },
  };
}

function darker(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.max(0, Math.round(((n >> s) & 255) * 0.75));
  return `#${[ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** CSS variables to put on the site wrapper (plus the template marker class). */
export function siteCssVars(input: SiteThemeInput): Record<string, string> {
  const vars = brandingToCssVars(siteBranding(input));
  // Curated fonts are self-hosted (next/font): point the tokens at their variables.
  const f = cleanFonts(input.fonts);
  for (const [key, fam] of [["--font-display", f.display], ["--font-ui", f.ui]] as const) {
    const def = siteFontByFamily(fam);
    if (def) vars[key] = `var(${siteFontVar(def)}, "${def.family}"), ${def.fallback}`;
  }
  return vars;
}

/** Google Fonts stylesheet for fonts outside the curated (self-hosted) catalog, or null. */
export function siteFontsHref(input: SiteThemeInput): string | null {
  const b = siteBranding(input);
  const fonts = { ...b.fonts };
  for (const k of ["display", "ui"] as const) if (siteFontByFamily(fonts[k])) fonts[k] = "";
  return googleFontsHref({ ...b, fonts });
}

export function siteIsDark(input: SiteThemeInput): boolean {
  return isDarkPalette(siteBranding(input));
}

/** Contrast report for the admin settings (palette as the site will use it). */
export function siteContrastChecks(input: SiteThemeInput): ContrastCheck[] {
  const colors = siteBranding(input).colors;
  const checks = brandingContrastChecks(colors);
  // Hero text sits on a dark scrim over photos: white on the scrim colour.
  const scrim = "#000000";
  const r = Math.round(contrastRatio("#FFFFFF", scrim) * 100) / 100;
  checks.push({ label: "Hero text on photo scrim", fg: "#FFFFFF", bg: scrim, ratio: r, grade: r >= 7 ? "AAA" : "AA", min: 4.5, ok: r >= 4.5 });
  return checks;
}

/** Text colour for the brand band / CTA banner. */
export function onBrand(input: SiteThemeInput): string {
  return readableOn(siteBranding(input).colors.primary);
}
