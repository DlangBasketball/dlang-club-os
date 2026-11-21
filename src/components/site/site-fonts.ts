import { Anton, Antonio, Barlow, Barlow_Condensed, Bebas_Neue, Exo_2, Inter, Montserrat, Open_Sans, Oswald, Roboto, Teko } from "next/font/google";
import { siteFontByFamily } from "@/lib/site/fonts";
import type { SiteFonts } from "@/lib/site/theme";

/**
 * The curated site fonts (src/lib/site/fonts.ts), self-hosted by next/font.
 * Not preloaded: a page only downloads the font files its wrapper uses.
 * Each one defines a CSS variable (--site-font-<id>) on the element carrying
 * its `variable` class; the theme maps --font-display / --font-ui onto it.
 */
const base = { subsets: ["latin", "latin-ext"] as ("latin" | "latin-ext")[], display: "swap" as const, preload: false };

const oswald = Oswald({ ...base, variable: "--site-font-oswald" });
const bebas = Bebas_Neue({ ...base, weight: "400", variable: "--site-font-bebas-neue" });
const barlowCondensed = Barlow_Condensed({ ...base, weight: ["500", "600", "700"], variable: "--site-font-barlow-condensed" });
const anton = Anton({ ...base, weight: "400", variable: "--site-font-anton" });
const antonio = Antonio({ ...base, variable: "--site-font-antonio" });
const teko = Teko({ ...base, variable: "--site-font-teko" });
const montserrat = Montserrat({ ...base, variable: "--site-font-montserrat" });
const exo2 = Exo_2({ ...base, variable: "--site-font-exo-2" });
const inter = Inter({ ...base, variable: "--site-font-inter" });
const roboto = Roboto({ ...base, variable: "--site-font-roboto" });
const openSans = Open_Sans({ ...base, variable: "--site-font-open-sans" });
const barlow = Barlow({ ...base, weight: ["400", "500", "600", "700"], variable: "--site-font-barlow" });

const BY_ID: Record<string, { variable: string }> = {
  oswald, "bebas-neue": bebas, "barlow-condensed": barlowCondensed, anton, antonio, teko, montserrat, "exo-2": exo2, inter, roboto, "open-sans": openSans, barlow,
};

/** Classes defining the CSS variables of the catalog fonts a site uses. */
export function siteFontClasses(fonts: SiteFonts): string {
  const out = new Set<string>();
  for (const fam of [fonts.display, fonts.ui]) {
    const f = siteFontByFamily(fam);
    const loaded = f ? BY_ID[f.id] : undefined;
    if (loaded) out.add(loaded.variable);
  }
  return Array.from(out).join(" ");
}
