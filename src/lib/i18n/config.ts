/**
 * i18n configuration — zero-dependency, safe to import from server, client
 * and edge code (no "server-only", no React).
 *
 * The list of languages lives in ./languages.ts (the registry); everything
 * here derives from it. Launch order: Switzerland (de, fr, it, en), then the
 * EU track, then the USA (docs/i18n/ADDING_A_LANGUAGE.md).
 */
import {
  LANGUAGES,
  LOCALES,
  SOURCE_LOCALE,
  baseLanguage,
  catalogLocaleFor,
  intlTagFor,
  matchLocale,
  nativeName,
  type Locale,
  type TextDirection,
} from "./languages";

export {
  LANGUAGES,
  LOCALES,
  BCP47_PATTERN,
  SOURCE_LOCALE,
  baseLanguage,
  canonicalizeTag,
  catalogChain,
  catalogLocaleFor,
  catalogStatus,
  directionOf,
  fallbackChain,
  getLanguage,
  intlTagFor,
  isBcp47Tag,
  isLocale,
  languageNameIn,
  matchLocale,
  nativeName,
  parseTag,
  regionNameIn,
  selectableLanguages,
  type CatalogStatus,
  type LanguageEntry,
  type Locale,
  type OverlayTransform,
  type TextDirection,
} from "./languages";

export const DEFAULT_LOCALE: Locale = SOURCE_LOCALE;

/** Home market: used for formatting when a tenant's country is unknown. */
export const HOME_REGION = "CH";

/** Base languages (no regional overlays): the default switcher list without a tenant. */
export const BASE_LOCALES: readonly Locale[] = LANGUAGES.filter((l) => l.status !== "none" && !("overlay" in l)).map((l) => l.tag as Locale);

/** Cookie that stores an explicit language choice (also for signed-out visitors). */
export const LOCALE_COOKIE = "locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** Endonyms — always shown in their own language in the switcher. */
export const LOCALE_NAMES = Object.fromEntries(LOCALES.map((l) => [l, nativeName(l)])) as Record<Locale, string>;

/** Short labels for compact switchers ("DE", "EN-GB"). */
export const LOCALE_SHORT = Object.fromEntries(LOCALES.map((l) => [l, l.toUpperCase()])) as Record<Locale, string>;

/**
 * Normalise any BCP-47-ish tag ("de-CH", "fr_ch", "ES", "de-AT") to the best
 * UI language with a catalog, or null when unsupported.
 */
export function normalizeLocale(tag: string | null | undefined): Locale | null {
  return matchLocale(tag);
}

/** Supported currencies (ISO 4217). Extend here when a new market launches. */
export const CURRENCIES = ["CHF", "EUR", "USD", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

/** Sensible IANA time zone per country (tenant can override). */
export const COUNTRY_TIMEZONE: Record<string, string> = {
  CH: "Europe/Zurich",
  LI: "Europe/Vaduz",
  DE: "Europe/Berlin",
  AT: "Europe/Vienna",
  FR: "Europe/Paris",
  BE: "Europe/Brussels",
  LU: "Europe/Luxembourg",
  NL: "Europe/Amsterdam",
  IT: "Europe/Rome",
  ES: "Europe/Madrid",
  PT: "Europe/Lisbon",
  IE: "Europe/Dublin",
  GB: "Europe/London",
  DK: "Europe/Copenhagen",
  SE: "Europe/Stockholm",
  NO: "Europe/Oslo",
  FI: "Europe/Helsinki",
  PL: "Europe/Warsaw",
  US: "America/New_York",
  CA: "America/Toronto",
  MX: "America/Mexico_City",
  BR: "America/Sao_Paulo",
  AU: "Australia/Sydney",
  AE: "Asia/Dubai",
};

/** Default currency per country (tenant can override). */
const COUNTRY_CURRENCY: Record<string, Currency> = {
  CH: "CHF",
  LI: "CHF",
  US: "USD",
  GB: "GBP",
};

/** CHF for CH/LI, USD for US, GBP for GB, EUR for the rest of Europe. */
export function currencyForCountry(country: string | null | undefined): Currency {
  const c = (country ?? "").toUpperCase();
  return COUNTRY_CURRENCY[c] ?? (c ? "EUR" : "CHF");
}

export function timezoneForCountry(country: string | null | undefined): string {
  return COUNTRY_TIMEZONE[(country ?? "").toUpperCase()] ?? "Europe/Zurich";
}

/** Default UI language for a newly created tenant in a given country. */
export function defaultLocaleForCountry(country: string | null | undefined): Locale {
  switch ((country ?? "").toUpperCase()) {
    case "DE":
    case "AT":
    case "LI":
    case "CH":
      return "de";
    case "FR":
    case "BE":
    case "LU":
      return "fr";
    case "IT":
      return "it";
    case "ES":
    case "MX":
      return "es";
    default:
      return "en";
  }
}

/** Languages a new tenant in a given country starts with (Switzerland: all four). */
export function defaultLanguagesForCountry(country: string | null | undefined): Locale[] {
  switch ((country ?? "").toUpperCase()) {
    case "CH":
      return ["de", "fr", "it", "en"];
    case "LI":
    case "DE":
    case "AT":
      return ["de", "en"];
    case "FR":
    case "LU":
      return ["fr", "en"];
    case "BE":
      return ["fr", "en"];
    case "IT":
      return ["it", "en"];
    case "ES":
      return ["es", "en"];
    default:
      return ["en"];
  }
}

/**
 * Formatting region for a UI language in a tenant: the tenant's per-language
 * choice, else the tag's own region ("en-GB" -> GB), else the tenant country.
 */
export function regionFor(
  locale: string,
  regions: Record<string, string> | null | undefined,
  country: string | null | undefined,
): string {
  const r = regions?.[locale] ?? regions?.[baseLanguage(locale)];
  if (r && /^([A-Z]{2}|[0-9]{3})$/.test(r.toUpperCase())) return r.toUpperCase();
  const own = locale.split("-").find((p, i) => i > 0 && (p.length === 2 || /^[0-9]{3}$/.test(p)));
  return (own ?? country ?? HOME_REGION).toUpperCase();
}

/**
 * Build the Intl locale tag used for number/date formatting from the UI
 * language and the tenant's country/region: ("de","CH") -> "de-CH",
 * ("en","US") -> "en-US", ("es","US") -> "es-US". Unknown country -> CH
 * (home market), matching currencyForCountry / timezoneForCountry.
 */
export function intlLocaleFor(locale: string, country?: string | null): string {
  return intlTagFor(locale, country || (locale.includes("-") ? null : HOME_REGION));
}

/** Catalog + formatting tags for a UI language in a region. */
export function localeTagsFor(
  locale: Locale,
  region: string,
): { catalogLocale: Locale; intlLocale: string; dir: TextDirection } {
  const catalogLocale = catalogLocaleFor(locale, region);
  const dir = LANGUAGES.find((l) => l.tag === catalogLocale)?.dir ?? "ltr";
  return { catalogLocale, intlLocale: intlTagFor(locale, region), dir };
}

/**
 * Everything a request needs to render localised UI. Serialisable, so it can
 * be handed to <I18nProvider> for client components.
 */
export type LocaleContext = {
  /** UI language the user/tenant chose, e.g. "de" (one of `languages`). */
  locale: Locale;
  /** Catalog actually rendered: the regional variant for the tenant, e.g. "de-CH". Use for <html lang>. */
  catalogLocale: Locale;
  /** Text direction of the catalog language. */
  dir: TextDirection;
  /** Intl tag used for numbers/dates, e.g. "de-CH", "en-US". */
  intlLocale: string;
  /** Tenant currency (ISO 4217). */
  currency: string;
  /** Tenant IANA time zone. */
  timeZone: string;
  /** Tenant country (ISO 3166-1 alpha-2). */
  country: string;
  /** Languages the tenant enables (switcher options). */
  languages: Locale[];
  /** Tenant the settings came from, if any. */
  orgId: string | null;
};
