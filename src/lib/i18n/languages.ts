/**
 * Language registry: the single source of truth for every UI language.
 *
 * Zero dependencies and no path aliases, so it runs in server, client and
 * edge code, in vitest, and directly in the Node scripts under scripts/
 * (Node strips the types).
 *
 * Adding a language (see docs/i18n/ADDING_A_LANGUAGE.md):
 *   1. add src/messages/<tag>.json (or an overlay for a regional variant),
 *   2. add (or update) one entry below,
 *   3. run `npm run i18n:sync` (regenerates overlays + src/messages/index.ts).
 * No other code changes: LOCALES, the type `Locale`, the settings picker,
 * the language switcher, negotiation and the coverage report derive from it.
 */

export type TextDirection = "ltr" | "rtl";

/**
 * complete: every key translated and reviewed by a native speaker; the
 *           checker fails on any missing key.
 * partial:  beta; missing keys fall back along the chain (finally English).
 *           Machine drafts always start here.
 * none:     planned; no catalog yet, not selectable.
 */
export type CatalogStatus = "complete" | "partial" | "none";

/**
 * Generated regional overlays (scripts/i18n-sync.mjs):
 *   swiss-german:    "ß" -> "ss" over the whole base catalog + Swiss terms.
 *   british-english: US -> British spelling word map + British terms.
 *   none:            hand-written overlay (only the keys that differ).
 */
export type OverlayTransform = "swiss-german" | "british-english" | "none";

export type LanguageEntry = {
  /** BCP 47 tag: language[-Script][-REGION]. */
  tag: string;
  /** English name (admin UI, reports). */
  englishName: string;
  /** Endonym, used when Intl.DisplayNames is unavailable. */
  nativeName: string;
  dir: TextDirection;
  status: CatalogStatus;
  /**
   * Lookup order after the tag itself. English is always the implicit last
   * step, so a missing key never renders as a raw key.
   */
  fallback: readonly string[];
  /** Default formatting region (Intl) when the tenant hasn't chosen one. */
  region: string;
  /** Regional variant: a thin overlay on top of `base`. */
  overlay?: { base: string; transform: OverlayTransform };
  /**
   * Regional variants only: tenant regions in which choosing the base
   * language automatically uses this variant (a Swiss club that enables
   * "Deutsch" gets Swiss spelling without picking "de-CH").
   */
  autoForRegions?: readonly string[];
};

export const SOURCE_LOCALE = "en" as const;

// Europe + Commonwealth use British English; the Americas keep US English.
const BRITISH_ENGLISH_REGIONS = [
  "GB", "IE", "MT", "CY", "GI", "IM", "JE", "GG", "AU", "NZ", "ZA", "IN", "SG", "HK",
  "CH", "LI", "AT", "DE", "FR", "BE", "LU", "NL", "IT", "ES", "PT", "DK", "SE", "NO", "FI", "IS", "PL", "CZ", "SK", "HU", "SI", "HR", "GR", "EE", "LV", "LT", "RO", "BG",
] as const;

export const LANGUAGES = [
  // ---- complete (launch: Switzerland) -----------------------------------
  { tag: "en", englishName: "English", nativeName: "English", dir: "ltr", status: "complete", fallback: [], region: "US" },
  { tag: "en-GB", englishName: "English (UK)", nativeName: "English (UK)", dir: "ltr", status: "complete", fallback: ["en"], region: "GB", overlay: { base: "en", transform: "british-english" }, autoForRegions: BRITISH_ENGLISH_REGIONS },
  { tag: "de", englishName: "German", nativeName: "Deutsch", dir: "ltr", status: "complete", fallback: ["en"], region: "DE" },
  { tag: "de-CH", englishName: "German (Switzerland)", nativeName: "Deutsch (Schweiz)", dir: "ltr", status: "complete", fallback: ["de", "en"], region: "CH", overlay: { base: "de", transform: "swiss-german" }, autoForRegions: ["CH", "LI"] },
  { tag: "fr", englishName: "French", nativeName: "Français", dir: "ltr", status: "complete", fallback: ["en"], region: "FR" },
  { tag: "fr-CH", englishName: "French (Switzerland)", nativeName: "Français (Suisse)", dir: "ltr", status: "complete", fallback: ["fr", "en"], region: "CH", overlay: { base: "fr", transform: "none" }, autoForRegions: ["CH"] },
  { tag: "it", englishName: "Italian", nativeName: "Italiano", dir: "ltr", status: "complete", fallback: ["en"], region: "IT" },
  { tag: "it-CH", englishName: "Italian (Switzerland)", nativeName: "Italiano (Svizzera)", dir: "ltr", status: "complete", fallback: ["it", "en"], region: "CH", overlay: { base: "it", transform: "none" }, autoForRegions: ["CH"] },
  // ---- beta ------------------------------------------------------------------
  // Spanish: full key coverage, pending native-speaker review (see ADDING_A_LANGUAGE.md).
  { tag: "es", englishName: "Spanish", nativeName: "Español", dir: "ltr", status: "partial", fallback: ["en"], region: "ES" },
  // ---- planned (EU track, then more markets) ---------------------------------
  { tag: "nl", englishName: "Dutch", nativeName: "Nederlands", dir: "ltr", status: "none", fallback: ["en"], region: "NL" },
  { tag: "pt", englishName: "Portuguese", nativeName: "Português", dir: "ltr", status: "none", fallback: ["en"], region: "PT" },
  { tag: "pt-BR", englishName: "Portuguese (Brazil)", nativeName: "Português (Brasil)", dir: "ltr", status: "none", fallback: ["pt", "en"], region: "BR", overlay: { base: "pt", transform: "none" }, autoForRegions: ["BR"] },
  { tag: "pl", englishName: "Polish", nativeName: "Polski", dir: "ltr", status: "none", fallback: ["en"], region: "PL" },
  { tag: "sv", englishName: "Swedish", nativeName: "Svenska", dir: "ltr", status: "none", fallback: ["en"], region: "SE" },
  { tag: "da", englishName: "Danish", nativeName: "Dansk", dir: "ltr", status: "none", fallback: ["en"], region: "DK" },
  { tag: "ar", englishName: "Arabic", nativeName: "العربية", dir: "rtl", status: "none", fallback: ["en"], region: "AE" },
] as const satisfies readonly LanguageEntry[];

type Entry = (typeof LANGUAGES)[number];

/** A language with a catalog (complete or partial): what the UI can render. */
export type Locale = Extract<Entry, { status: "complete" | "partial" }>["tag"];

/** Every UI language that has a catalog, in registry order. */
export const LOCALES = LANGUAGES.filter((l) => l.status !== "none").map((l) => l.tag) as readonly Locale[] as readonly [Locale, ...Locale[]];

const BY_TAG = new Map<string, LanguageEntry>(LANGUAGES.map((l) => [l.tag.toLowerCase(), l]));

/**
 * BCP 47 subset accepted everywhere (DB constraints use the same pattern):
 * language (2-3 letters), optional Script (4), optional REGION (2 letters or
 * 3 digits). "de", "de-CH", "zh-Hant-TW", "es-419".
 */
export const BCP47_PATTERN = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$/;

export function isBcp47Tag(value: unknown): value is string {
  return typeof value === "string" && BCP47_PATTERN.test(value);
}

/**
 * Canonical casing for a loosely written tag: "DE_ch" -> "de-CH",
 * "zh-hant-tw" -> "zh-Hant-TW". Returns null when it isn't a tag of the
 * accepted shape (extensions and variants are dropped: "de-CH-u-nu-latn" -> "de-CH").
 */
export function canonicalizeTag(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const parts = input.trim().replace(/_/g, "-").split("-").filter(Boolean);
  if (!parts.length) return null;
  const lang = parts[0].toLowerCase();
  if (!/^[a-z]{2,3}$/.test(lang)) return null;
  let i = 1;
  let script = "";
  if (parts[i] && /^[a-z]{4}$/i.test(parts[i])) {
    script = parts[i][0].toUpperCase() + parts[i].slice(1).toLowerCase();
    i++;
  }
  let region = "";
  if (parts[i] && /^([a-z]{2}|[0-9]{3})$/i.test(parts[i])) {
    region = parts[i].toUpperCase();
    i++;
  }
  const tag = [lang, script, region].filter(Boolean).join("-");
  return isBcp47Tag(tag) ? tag : null;
}

/** Split a tag into its parts ("zh-Hant-TW" -> { language: "zh", script: "Hant", region: "TW" }). */
export function parseTag(tag: string): { language: string; script: string | null; region: string | null } | null {
  const c = canonicalizeTag(tag);
  if (!c) return null;
  const [language, ...rest] = c.split("-");
  const script = rest.find((p) => p.length === 4) ?? null;
  const region = rest.find((p) => p.length !== 4) ?? null;
  return { language, script, region };
}

/** "de-CH" -> "de". */
export function baseLanguage(tag: string): string {
  return parseTag(tag)?.language ?? tag.toLowerCase().split(/[-_]/)[0];
}

export function getLanguage(tag: string | null | undefined): LanguageEntry | undefined {
  const c = canonicalizeTag(tag);
  return c ? BY_TAG.get(c.toLowerCase()) : undefined;
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Catalog status of a tag ("none" for anything not in the registry). */
export function catalogStatus(tag: string): CatalogStatus {
  return getLanguage(tag)?.status ?? "none";
}

/**
 * Lookup chain for a tag, most specific first, English last.
 *   de-CH -> [de-CH, de, en]      pt-BR -> [pt-BR, pt, en]
 *   en-GB -> [en-GB, en]          de-AT -> [de-AT, de, en]   (truncation for unregistered tags)
 *   zh-Hant-TW -> [zh-Hant-TW, zh-Hant, zh, en]
 */
export function fallbackChain(tag: string): string[] {
  const c = canonicalizeTag(tag);
  if (!c) return [SOURCE_LOCALE];
  const chain: string[] = [];
  const push = (t: string) => {
    if (!chain.includes(t)) chain.push(t);
  };
  push(c);
  const entry = BY_TAG.get(c.toLowerCase());
  if (entry) {
    for (const f of entry.fallback) for (const t of fallbackChain(f)) if (t !== SOURCE_LOCALE) push(t);
  } else {
    const parts = c.split("-");
    for (let n = parts.length - 1; n >= 1; n--) {
      const t = parts.slice(0, n).join("-");
      const e = BY_TAG.get(t.toLowerCase());
      push(t);
      if (e) for (const f of e.fallback) for (const x of fallbackChain(f)) if (x !== SOURCE_LOCALE) push(x);
    }
  }
  push(SOURCE_LOCALE);
  return chain;
}

/** The chain restricted to languages that have a catalog: what the loader merges. */
export function catalogChain(tag: string): Locale[] {
  return fallbackChain(tag).filter(isLocale);
}

/**
 * Best renderable UI language for an arbitrary tag, or null if none of its
 * chain (English aside) has a catalog. "de-AT" -> "de", "fr-CH" -> "fr-CH",
 * "en-US" -> "en", "pt-BR" -> null (no Portuguese catalog yet).
 */
export function matchLocale(tag: string | null | undefined): Locale | null {
  const c = canonicalizeTag(tag);
  if (!c) return null;
  const chain = fallbackChain(c);
  const wantsEnglish = baseLanguage(c) === SOURCE_LOCALE;
  for (const t of chain) {
    if (t === SOURCE_LOCALE && !wantsEnglish) break;
    if (isLocale(t)) return t;
  }
  return null;
}

/**
 * Catalog variant for a UI language in a tenant region:
 *   ("de", "CH") -> "de-CH"   ("en", "CH") -> "en-GB"   ("en", "US") -> "en"
 *   ("de", "DE") -> "de"      ("de-CH", "DE") -> "de-CH" (explicit variant wins)
 */
export function catalogLocaleFor(locale: string, region?: string | null): Locale {
  const matched = matchLocale(locale) ?? SOURCE_LOCALE;
  const p = parseTag(matched);
  if (!p || p.region || !region) return matched;
  const r = region.toUpperCase();
  const exact = `${p.language}-${r}`;
  if (isLocale(exact)) return exact;
  for (const l of LANGUAGES) {
    if (l.status === "none" || !("overlay" in l) || l.overlay.base !== matched) continue;
    if ("autoForRegions" in l && (l.autoForRegions as readonly string[]).includes(r)) return l.tag as Locale;
  }
  return matched;
}

/** Text direction from the registry; unknown tags by language/script. */
const RTL_LANGUAGES = new Set(["ar", "he", "iw", "fa", "ur", "ps", "sd", "yi", "dv", "ug", "ckb", "ku", "syr", "nqo"]);
const RTL_SCRIPTS = new Set(["Arab", "Hebr", "Thaa", "Syrc", "Nkoo", "Adlm", "Rohg", "Mand", "Samr"]);
export function directionOf(tag: string | null | undefined): TextDirection {
  const entry = getLanguage(tag);
  if (entry) return entry.dir;
  const p = tag ? parseTag(tag) : null;
  if (!p) return "ltr";
  if (p.script) return RTL_SCRIPTS.has(p.script) ? "rtl" : "ltr";
  return RTL_LANGUAGES.has(p.language) ? "rtl" : "ltr";
}

function capitalize(s: string, locale: string): string {
  return s ? s.charAt(0).toLocaleUpperCase(locale) + s.slice(1) : s;
}

/**
 * Endonym for the switcher ("Deutsch", "Français", "Deutsch (Schweiz)").
 * `withRegion: false` shows only the language ("de-CH" -> "Deutsch").
 */
export function nativeName(tag: string, opts: { withRegion?: boolean } = {}): string {
  const c = canonicalizeTag(tag) ?? tag;
  const show = opts.withRegion === false ? baseLanguage(c) : c;
  try {
    const dn = new Intl.DisplayNames([show], { type: "language", languageDisplay: "standard", fallback: "none" });
    const name = dn.of(show);
    if (name) return capitalize(name, show);
  } catch {
    // older runtimes: fall through
  }
  const entry = getLanguage(show);
  return entry?.nativeName ?? show;
}

/** Language name in another language ("de-CH" in "fr" -> "allemand (Suisse)"). */
export function languageNameIn(tag: string, displayLocale: string): string {
  try {
    const name = new Intl.DisplayNames([displayLocale], { type: "language", languageDisplay: "standard", fallback: "none" }).of(tag);
    if (name) return capitalize(name, displayLocale);
  } catch {
    // fall through
  }
  return getLanguage(tag)?.englishName ?? tag;
}

/** Region name in a display language ("CH" in "de" -> "Schweiz"). */
export function regionNameIn(region: string, displayLocale: string): string {
  try {
    return new Intl.DisplayNames([displayLocale], { type: "region", fallback: "code" }).of(region.toUpperCase()) ?? region;
  } catch {
    return region;
  }
}

/**
 * Intl tag used to format numbers, dates and money: the UI language with the
 * tenant's formatting region ("de" + "CH" -> "de-CH", "en" + "CH" -> "en-CH",
 * "en-GB" + "CH" -> "en-CH"). Falls back to the language's default region.
 */
export function intlTagFor(locale: string, region?: string | null): string {
  const p = parseTag(locale);
  if (!p) return "en-US";
  const r = (region || p.region || getLanguage(locale)?.region || getLanguage(p.language)?.region || "").toUpperCase();
  const tag = [p.language, p.script, r].filter(Boolean).join("-");
  try {
    if (Intl.NumberFormat.supportedLocalesOf([tag]).length) return tag;
    const fallback = [p.language, p.script, getLanguage(p.language)?.region].filter(Boolean).join("-");
    return Intl.NumberFormat.supportedLocalesOf([fallback]).length ? fallback : p.language;
  } catch {
    return p.language;
  }
}

/** Registry entries grouped for pickers: languages with catalogs first, then planned ones. */
export function selectableLanguages(): LanguageEntry[] {
  return LANGUAGES.filter((l) => l.status !== "none");
}
