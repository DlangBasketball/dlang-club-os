/**
 * Curated site fonts (pure; browser + server). These are self-hosted through
 * next/font (src/components/site/site-fonts.ts), so a club picks a sporty
 * look without a third-party font request. Each font exposes a CSS variable
 * (--site-font-<id>); the site wrapper maps --font-display / --font-ui onto
 * it (theme tokens stay the single source of truth).
 *
 * The WordPress importer detects the old theme's fonts and preselects the
 * closest catalog font (closestSiteFont).
 */

export type SiteFontRole = "display" | "body";
export type SiteFontDef = { family: string; id: string; roles: readonly SiteFontRole[]; condensed: boolean; fallback: string };

const COND = '"Arial Narrow", "Roboto Condensed", Impact, sans-serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const SITE_FONTS: readonly SiteFontDef[] = [
  { family: "Oswald", id: "oswald", roles: ["display"], condensed: true, fallback: COND },
  { family: "Bebas Neue", id: "bebas-neue", roles: ["display"], condensed: true, fallback: COND },
  { family: "Barlow Condensed", id: "barlow-condensed", roles: ["display"], condensed: true, fallback: COND },
  { family: "Anton", id: "anton", roles: ["display"], condensed: true, fallback: COND },
  { family: "Antonio", id: "antonio", roles: ["display"], condensed: true, fallback: COND },
  { family: "Teko", id: "teko", roles: ["display"], condensed: true, fallback: COND },
  { family: "Montserrat", id: "montserrat", roles: ["display", "body"], condensed: false, fallback: SANS },
  { family: "Exo 2", id: "exo-2", roles: ["display", "body"], condensed: false, fallback: SANS },
  { family: "Inter", id: "inter", roles: ["body"], condensed: false, fallback: SANS },
  { family: "Roboto", id: "roboto", roles: ["body"], condensed: false, fallback: SANS },
  { family: "Open Sans", id: "open-sans", roles: ["body"], condensed: false, fallback: SANS },
  { family: "Barlow", id: "barlow", roles: ["body"], condensed: false, fallback: SANS },
];

export function siteFontByFamily(family: string | null | undefined): SiteFontDef | null {
  if (!family) return null;
  const k = family.trim().toLowerCase();
  return SITE_FONTS.find((f) => f.family.toLowerCase() === k) ?? null;
}

export function siteFontsFor(role: SiteFontRole): SiteFontDef[] {
  return SITE_FONTS.filter((f) => f.roles.includes(role));
}

/** CSS variable next/font defines for a catalog font. */
export const siteFontVar = (f: SiteFontDef) => `--site-font-${f.id}`;

// Closest catalog font for common theme / Google fonts.
const ALIASES: Record<string, string> = {
  exo: "Exo 2", "exo 2": "Exo 2", "titillium web": "Exo 2", orbitron: "Exo 2", "saira": "Exo 2", "chakra petch": "Exo 2",
  "league gothic": "Oswald", "fjalla one": "Oswald", kanit: "Oswald", "pathway gothic one": "Oswald", "francois one": "Oswald", "news cycle": "Oswald",
  bebas: "Bebas Neue", "bebas neue": "Bebas Neue", staatliches: "Bebas Neue", "big shoulders display": "Bebas Neue", "league spartan": "Montserrat",
  "roboto condensed": "Barlow Condensed", "saira condensed": "Barlow Condensed", "saira extra condensed": "Barlow Condensed",
  "archivo narrow": "Barlow Condensed", "pt sans narrow": "Barlow Condensed", "encode sans condensed": "Barlow Condensed", "sofia sans condensed": "Barlow Condensed",
  "alumni sans": "Antonio", "six caps": "Antonio", "anton sc": "Anton", "passion one": "Anton", "squada one": "Anton", impact: "Anton",
  khand: "Teko", rajdhani: "Teko", "russo one": "Teko",
  poppins: "Montserrat", raleway: "Montserrat", "work sans": "Montserrat", outfit: "Montserrat", urbanist: "Montserrat",
  lato: "Open Sans", "source sans pro": "Open Sans", "source sans 3": "Open Sans", "noto sans": "Open Sans", "pt sans": "Open Sans", ubuntu: "Open Sans",
  nunito: "Inter", "nunito sans": "Inter", "dm sans": "Inter", rubik: "Inter", "manrope": "Inter", helvetica: "Inter", "helvetica neue": "Inter", arial: "Inter", "plus jakarta sans": "Inter",
  heebo: "Roboto", "roboto flex": "Roboto", mulish: "Barlow", "public sans": "Barlow", archivo: "Barlow",
};

/** Closest catalog font for a detected family (null = keep the template default). */
export function closestSiteFont(family: string | null | undefined, role: SiteFontRole): SiteFontDef | null {
  if (!family) return null;
  const k = family.trim().replace(/^["']|["']$/g, "").toLowerCase().replace(/\s+/g, " ");
  if (!k) return null;
  const exact = siteFontByFamily(k);
  if (exact && exact.roles.includes(role)) return exact;
  const alias = ALIASES[k];
  if (alias) {
    const f = siteFontByFamily(alias);
    if (f && f.roles.includes(role)) return f;
    // A condensed display font asked for as body text: keep the default body font.
    if (f && role === "body") return null;
  }
  if (/condensed|narrow|compressed|gothic/.test(k)) return role === "display" ? siteFontByFamily("Barlow Condensed") : null;
  if (/serif|slab|garamond|playfair|merriweather|lora|times/.test(k) && !/sans/.test(k)) return null;
  if (role === "body" && /sans|grotesk|grotesque/.test(k)) return siteFontByFamily("Inter");
  return null;
}
