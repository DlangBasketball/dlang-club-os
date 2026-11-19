import { DEFAULT_BRANDING } from "./defaults";
import type { TenantBranding, TenantColors } from "./types";

/**
 * Runtime theming: converts a tenant's branding into the CSS custom
 * properties that globals.css / tailwind.config.ts already consume
 * (--brand-primary, --bg, --surface, --text, ...). Setting them on <html>
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

/** Font names served by next/font in the root layout (no extra stylesheet). */
const BUILTIN_FONTS: Record<"display" | "ui" | "mono", string> = {
  display: "Fraunces",
  ui: "Geist",
  mono: "Geist Mono",
};

/** Lighten (dark bg) or darken (light bg) `fg` until it reaches `min` contrast on `bg`. */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  if (contrastRatio(fg, bg) >= min) return normalizeHex(fg);
  const target = luminance(bg) < 0.2 ? "#FFFFFF" : "#000000";
  for (let w = 0.05; w <= 1; w += 0.05) {
    const c = mix(fg, target, w);
    if (contrastRatio(c, bg) >= min) return c;
  }
  return target;
}

/**
 * Map branding -> CSS variables, using the design-system token contract
 * (docs/design/DESIGN_SYSTEM.md: --brand-primary, --bg, --surface, --text,
 * ...). The layout writes these as an inline style on <html>, which beats
 * both the :root defaults and the [data-theme="light"] block in globals.css.
 * Legacy names (--red-primary, --bg-main, --accent, ...) are aliases in
 * globals.css and follow automatically. Every value is derived from
 * validated hex colors / whitelisted font names, so it is safe to inline.
 */
export function brandingToCssVars(b: TenantBranding): Record<string, string> {
  const c = sanitizeColors(b.colors);
  const dark = luminance(c.background) < 0.2;
  const onPrimary = readableOn(c.primary);
  const vars: Record<string, string> = {
    // Brand
    "--brand-primary": c.primary,
    "--brand-primary-dark": c.primaryDark,
    "--brand-primary-deep": mix(c.primary, c.background, dark ? 0.82 : 0.88),
    "--brand-primary-contrast": onPrimary,
    "--brand-primary-text": ensureContrast(c.primary, c.background),
    "--brand-accent": c.accent,
    "--brand-accent-dark": mix(c.accent, "#000000", 0.2),
    "--brand-accent-contrast": readableOn(c.accent),
    "--brand-accent-text": ensureContrast(c.accent, c.background),
    // Surfaces
    "--bg": c.background,
    "--bg-secondary": mix(c.background, c.text, dark ? 0.035 : 0.025),
    "--surface": c.surface,
    "--surface-elevated": mix(c.surface, c.text, dark ? 0.05 : 0.04),
    "--surface-input": mix(c.surface, c.text, dark ? 0.03 : 0.02),
    "--border": mix(c.background, c.text, dark ? 0.12 : 0.13),
    "--border-soft": mix(c.background, c.text, dark ? 0.09 : 0.08),
    "--border-strong": mix(c.background, c.text, dark ? 0.18 : 0.2),
    // Text (muted shades kept at AA on the background)
    "--text": c.text,
    "--text-secondary": ensureContrast(mix(c.text, c.background, 0.27), c.background),
    "--text-muted": ensureContrast(mix(c.text, c.background, 0.4), c.background),
    "--text-subtle": ensureContrast(mix(c.text, c.background, 0.45), c.background),
    "--text-disabled": mix(c.text, c.background, 0.62),
    "--text-inverse": onPrimary,
    // Derived tints (also computed in globals.css; set here so a scoped
    // preview subtree resolves them from the draft colors, not :root).
    "--brand-primary-soft": rgba(c.primary, 0.12),
    "--brand-accent-soft": rgba(c.accent, 0.14),
    "--shadow-glow": `0 0 24px ${rgba(c.primary, 0.18)}`,
    "--shadow-glow-strong": `0 6px 24px ${rgba(c.primary, 0.28)}, 0 0 0 1px ${rgba(c.primary, 0.4)}`,
  };
  // Fonts: the defaults come from next/font (layout.tsx). Only a custom
  // tenant font replaces the token, loaded via googleFontsHref().
  (["display", "ui", "mono"] as const).forEach((k) => {
    const f = safeFont(b.fonts[k], BUILTIN_FONTS[k]);
    if (f === BUILTIN_FONTS[k]) return;
    const fallback = k === "display" ? '"Times New Roman", serif' : k === "ui" ? "system-ui, -apple-system, sans-serif" : "ui-monospace, monospace";
    vars[`--font-${k}`] = `"${f}", ${fallback}`;
  });
  return vars;
}

/** True when the palette's background is dark (drives `color-scheme`). */
export function isDarkPalette(b: TenantBranding): boolean {
  return luminance(sanitizeColors(b.colors).background) < 0.2;
}

/** Google Fonts stylesheet URL for the tenant's fonts (null if none). */
export function googleFontsHref(b: TenantBranding): string | null {
  const fams = Array.from(
    new Set(
      (["display", "ui", "mono"] as const)
        .map((k) => safeFont(b.fonts[k], ""))
        .filter((f) => f && !Object.values(BUILTIN_FONTS).includes(f)),
    ),
  );
  if (!fams.length) return null;
  const q = fams.map((f) => `family=${f.replace(/ /g, "+")}:wght@400;500;600;700`).join("&");
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}
