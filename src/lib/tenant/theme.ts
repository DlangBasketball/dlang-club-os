import { DEFAULT_BRANDING } from "./defaults";
import type { TenantBranding, TenantColors } from "./types";

/**
 * Runtime theming: converts a tenant's branding into the CSS custom
 * properties that globals.css / tailwind.config.ts already consume
 * (--bg-main, --red-primary, --text-primary, ...). Setting them on <html>
 * rebrands the whole UI with zero component changes.
 *
 * Pure + isomorphic (used by the root layout and the live preview).
 */

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const FONT_RE = /^[A-Za-z0-9 ]{1,60}$/;

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v);
}

export function normalizeHex(v: string): string {
  const h = v.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return `#${full.toUpperCase()}`;
}

export function safeFont(v: unknown, fallback: string): string {
  return typeof v === "string" && FONT_RE.test(v.trim()) ? v.trim() : fallback;
}

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = normalizeHex(hex).slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Linear mix: weight 0 -> a, 1 -> b. */
export function mix(a: string, b: string, weight: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => A[i]! + (B[i]! - A[i]!) * weight) as RGB);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
  const ch = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** WCAG contrast ratio (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastGrade = "AAA" | "AA" | "AA-large" | "fail";
export function gradeContrast(ratio: number): ContrastGrade {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA-large";
  return "fail";
}

/** Black or white, whichever reads better on `bg`. */
export function readableOn(bg: string): string {
  return contrastRatio(bg, "#FFFFFF") >= contrastRatio(bg, "#111111") ? "#FFFFFF" : "#111111";
}

export type ContrastCheck = { label: string; fg: string; bg: string; ratio: number; grade: ContrastGrade; min: number; ok: boolean };

/** The pairs the settings page validates before saving. */
export function brandingContrastChecks(c: TenantColors): ContrastCheck[] {
  const pairs: [string, string, string, number][] = [
    ["Body text on background", c.text, c.background, 4.5],
    ["Body text on cards", c.text, c.surface, 4.5],
    ["Button label on primary", readableOn(c.primary), c.primary, 4.5],
    ["Primary on background (links, icons)", c.primary, c.background, 3],
    ["Accent on background", c.accent, c.background, 3],
  ];
  return pairs.map(([label, fg, bg, min]) => {
    const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100;
    return { label, fg, bg, ratio, grade: gradeContrast(ratio), min, ok: ratio >= min };
  });
}

/** Coerce any colors object into a safe, complete palette. */
export function sanitizeColors(input: unknown, base: TenantColors = DEFAULT_BRANDING.colors): TenantColors {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const pick = (k: keyof TenantColors) => (isHexColor(o[k]) ? normalizeHex(o[k] as string) : base[k]);
  return {
    primary: pick("primary"),
    primaryDark: pick("primaryDark"),
    accent: pick("accent"),
    background: pick("background"),
    surface: pick("surface"),
    text: pick("text"),
  };
}

/**
 * Map branding -> CSS variables. Every value is derived from validated hex
 * colors / whitelisted font names, so it is safe to inline.
 */
export function brandingToCssVars(b: TenantBranding): Record<string, string> {
  const c = sanitizeColors(b.colors);
  const dark = luminance(c.background) < 0.2;
  const onPrimary = readableOn(c.primary);
  const fonts = {
    display: safeFont(b.fonts.display, DEFAULT_BRANDING.fonts.display),
    ui: safeFont(b.fonts.ui, DEFAULT_BRANDING.fonts.ui),
    mono: safeFont(b.fonts.mono, DEFAULT_BRANDING.fonts.mono),
  };

  return {
    // Surfaces
    "--bg-main": c.background,
    "--bg-secondary": mix(c.background, c.text, dark ? 0.035 : 0.025),
    "--surface-card": c.surface,
    "--surface-elevated": mix(c.surface, c.text, dark ? 0.05 : 0.04),
    "--surface-input": mix(c.surface, c.text, dark ? 0.03 : 0.02),
    // Ink
    "--text-primary": c.text,
    "--text-secondary": mix(c.text, c.background, 0.27),
    "--text-muted": mix(c.text, c.background, 0.58),
    "--ink-4": mix(c.text, c.background, 0.7),
    "--text-inverse": onPrimary,
    // Lines
    "--border": mix(c.background, c.text, dark ? 0.12 : 0.13),
    "--border-soft": mix(c.background, c.text, dark ? 0.09 : 0.08),
    // Brand (legacy "red"/"maroon" token names kept for compatibility)
    "--red-primary": c.primary,
    "--red-dark": c.primaryDark,
    "--red-deep": mix(c.primaryDark, "#000000", 0.4),
    "--burgundy-glow": mix(c.primary, c.background, 0.82),
    // On light themes text-inverse sits on a near-solid brand tint.
    "--maroon-soft": dark ? rgba(c.primary, 0.12) : rgba(c.primary, 0.88),
    "--glow-red": `0 0 30px ${rgba(c.primary, 0.18)}`,
    "--glow-red-strong": `0 6px 24px ${rgba(c.primary, 0.28)}, 0 0 0 1px ${rgba(c.primary, 0.4)}`,
    "--shadow-red": `0 0 0 3px ${rgba(c.primary, 0.22)}`,
    "--brand-tint": rgba(c.primary, 0.1),
    // Accent
    "--accent": c.accent,
    "--accent-soft": rgba(c.accent, 0.14),
    "--text-on-accent": readableOn(c.accent),
    // Typography
    "--font-display": `"${fonts.display}", "Times New Roman", serif`,
    "--font-ui": `"${fonts.ui}", system-ui, -apple-system, sans-serif`,
    "--font-mono": `"${fonts.mono}", ui-monospace, monospace`,
  };
}

/** True when the palette's background is dark (drives `color-scheme`). */
export function isDarkPalette(b: TenantBranding): boolean {
  return luminance(sanitizeColors(b.colors).background) < 0.2;
}

/** Google Fonts stylesheet URL for the tenant's fonts (null if none). */
export function googleFontsHref(b: TenantBranding): string | null {
  const fams = Array.from(
    new Set([b.fonts.display, b.fonts.ui, b.fonts.mono].map((f) => safeFont(f, "")).filter(Boolean)),
  );
  if (!fams.length) return null;
  const q = fams.map((f) => `family=${f.replace(/ /g, "+")}:wght@400;500;600;700`).join("&");
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}
