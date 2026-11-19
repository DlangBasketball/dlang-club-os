import { brandingToCssVars, sanitizeColors } from "@/lib/tenant/theme";
import type { TenantBranding } from "@/lib/tenant/types";
import type { EmbedTheme } from "./settings-shape";

/**
 * Theme for embeds, the public API "theme" object and the public pages'
 * header: the club's own palette, or a light / dark variant that keeps the
 * club's brand colours (primary, accent) on a neutral surface. Values are the
 * design-system CSS variables (src/app/globals.css), derived from validated
 * hex colours only.
 */
const LIGHT = { background: "#FFFFFF", surface: "#F6F6F4", text: "#141414" };
const DARK = { background: "#0A0A0A", surface: "#121212", text: "#F1F1F1" };

export function themedBranding(branding: TenantBranding, theme: EmbedTheme): TenantBranding {
  if (theme === "club") return branding;
  const c = sanitizeColors(branding.colors);
  const base = theme === "light" ? LIGHT : DARK;
  return { ...branding, colors: { ...c, ...base }, darkMode: theme === "dark" };
}

export function embedThemeVars(branding: TenantBranding, theme: EmbedTheme): Record<string, string> {
  return brandingToCssVars(themedBranding(branding, theme));
}

export function parseThemeParam(v: unknown, fallback: EmbedTheme): EmbedTheme {
  return v === "light" || v === "dark" || v === "club" ? v : fallback;
}
