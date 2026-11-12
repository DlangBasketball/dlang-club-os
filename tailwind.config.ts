import type { Config } from "tailwindcss";

/**
 * Club OS — Tailwind theme.
 *
 * Every colour / font / radius / shadow resolves to a CSS custom property
 * defined in src/app/globals.css, so tenants can re-brand at runtime by
 * overriding the variables on :root (see docs/design/DESIGN_SYSTEM.md).
 *
 * Colours are emitted as `var(--token)`; when an opacity modifier is used
 * (`bg-brand-primary/20`) they become `color-mix(in srgb, var(--token) 20%,
 * transparent)`, so tokens can stay plain hex values that tenants can set.
 */
type ColorFn = (opts: { opacityValue?: string | number }) => string;

function token(name: string): string {
  const fn: ColorFn = ({ opacityValue }) => {
    const o = opacityValue === undefined ? undefined : String(opacityValue);
    if (o === undefined || o === "1" || o.startsWith("var(")) {
      return `var(--${name})`;
    }
    if (o === "0") return `color-mix(in srgb, var(--${name}) 0%, transparent)`;
    const pct = `calc(${o} * 100%)`;
    return `color-mix(in srgb, var(--${name}) ${pct}, transparent)`;
  };
  // Tailwind 3 accepts colour functions; its public type only lists strings.
  return fn as unknown as string;
}

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ---- Canonical design-system names --------------------------------
        "brand-primary": token("brand-primary"),
        "brand-primary-dark": token("brand-primary-dark"),
        "brand-primary-deep": token("brand-primary-deep"),
        "brand-primary-soft": token("brand-primary-soft"),
        "brand-primary-contrast": token("brand-primary-contrast"),
        "brand-accent": token("brand-accent"),
        "brand-accent-dark": token("brand-accent-dark"),
        "brand-accent-soft": token("brand-accent-soft"),
        "brand-accent-contrast": token("brand-accent-contrast"),
        bg: token("bg"),
        "bg-secondary": token("bg-secondary"),
        surface: token("surface"),
        "surface-elevated": token("surface-elevated"),
        "surface-input": token("surface-input"),
        border: token("border"),
        "border-soft": token("border-soft"),
        "border-strong": token("border-strong"),
        text: token("text"),
        "text-secondary": token("text-secondary"),
        "text-muted": token("text-muted"),
        "text-subtle": token("text-subtle"),
        success: token("success"),
        "success-soft": token("success-soft"),
        warning: token("warning"),
        "warning-soft": token("warning-soft"),
        danger: token("danger"),
        "danger-soft": token("danger-soft"),
        info: token("info"),
        "info-soft": token("info-soft"),

        // ---- Legacy aliases (used throughout existing pages) --------------
        "surface-card": token("surface"),
        ink: token("text"),
        "ink-2": token("text-secondary"),
        "ink-3": token("text-muted"),
        "ink-4": token("text-subtle"),
        inverse: token("text-inverse"),
        line: token("border"),
        "line-soft": token("border-soft"),
        maroon: token("brand-primary"),
        "maroon-dark": token("brand-primary-dark"),
        "maroon-deep": token("brand-primary-deep"),
        "maroon-soft": token("brand-primary-soft"),
        "maroon-ink": token("brand-primary-deep"),
        gold: token("brand-accent"),
        "gold-soft": token("brand-accent-soft"),
        accent: token("brand-accent"),
        "accent-soft": token("brand-accent-soft"),
      },
      // Brand / status colours used AS TEXT switch to their AA-contrast
      // "-text" variants (a pure #DA2627 on #0A0A0A is only ~4:1).
      textColor: {
        "brand-primary": token("brand-primary-text"),
        maroon: token("brand-primary-text"),
        "brand-accent": token("brand-accent-text"),
        gold: token("brand-accent-text"),
        success: token("success-text"),
        warning: token("warning-text"),
        danger: token("danger-text"),
        info: token("info-text"),
        "on-brand": token("brand-primary-contrast"),
        "on-accent": token("brand-accent-contrast"),
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-ui)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        glow: "var(--shadow-glow)",
        "glow-strong": "var(--shadow-glow-strong)",
        focus: "var(--focus-ring)",
        // legacy
        "glow-red": "var(--shadow-glow)",
        "glow-red-strong": "var(--shadow-glow-strong)",
        "ring-red": "var(--focus-ring)",
      },
      minHeight: { tap: "var(--tap-target)" },
      minWidth: { tap: "var(--tap-target)" },
      transitionTimingFunction: { "out-expo": "var(--ease-out)" },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-in-left": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fade-in 0.2s ease-out both",
        "slide-in-left": "slide-in-left 0.25s cubic-bezier(0.16, 1, 0.3, 1) both",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;
