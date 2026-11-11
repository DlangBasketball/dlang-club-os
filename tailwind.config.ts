import type { Config } from "tailwindcss";

/**
 * DLang Basketball — Tailwind theme.
 * Colors map to the CSS variables defined in globals.css (sourced verbatim
 * from the prototype), so utilities like `bg-surface`, `text-ink`,
 * `border-line`, `text-maroon` stay in sync with the single token source.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Backgrounds & surfaces
        bg: "var(--bg-main)",
        "bg-secondary": "var(--bg-secondary)",
        surface: "var(--surface-card)",
        "surface-elevated": "var(--surface-elevated)",
        "surface-input": "var(--surface-input)",
        // Ink (text)
        ink: "var(--text-primary)",
        "ink-2": "var(--text-secondary)",
        "ink-3": "var(--text-muted)",
        "ink-4": "var(--ink-4)",
        inverse: "var(--text-inverse)",
        // Lines
        line: "var(--border)",
        "line-soft": "var(--border-soft)",
        // Brand maroon
        maroon: "var(--red-primary)",
        "maroon-dark": "var(--red-dark)",
        "maroon-deep": "var(--red-deep)",
        "maroon-soft": "var(--maroon-soft)",
        "maroon-ink": "var(--burgundy-glow)",
        // Tenant accent (white-label)
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        "on-accent": "var(--text-on-accent)",
        // Semantic
        success: "var(--success)",
        "success-soft": "var(--success-soft)",
        warning: "var(--warning)",
        "warning-soft": "var(--warning-soft)",
        danger: "var(--danger)",
        "danger-soft": "var(--danger-soft)",
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        sans: ["var(--font-ui)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        "glow-red": "var(--glow-red)",
        "glow-red-strong": "var(--glow-red-strong)",
        "ring-red": "var(--shadow-red)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
export default config;
