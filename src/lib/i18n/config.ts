/**
 * i18n configuration — zero-dependency, safe to import from server, client
 * and edge code (no "server-only", no React).
 *
 * Supported UI languages:
 *   - Switzerland: de, fr, it (+ en)
 *   - EU:          en, de, fr, it, es
 *   - USA:         en, es
 */
export const LOCALES = ["en", "de", "fr", "it", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Cookie that stores an explicit language choice (also for signed-out visitors). */
export const LOCALE_COOKIE = "locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** Endonyms — always shown in their own language in the switcher. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  it: "Italiano",
  es: "Español",
};

/** Short labels for compact switchers. */
export const LOCALE_SHORT: Record<Locale, string> = {
  en: "EN",
  de: "DE",
  fr: "FR",
  it: "IT",
  es: "ES",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Normalise any BCP-47-ish tag ("de-CH", "fr_ch", "ES") to a supported
 * UI locale, or null when unsupported.
 */
export function normalizeLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const base = tag.trim().toLowerCase().replace("_", "-").split("-")[0];
  return isLocale(base) ? base : null;
}

/** Supported currencies (ISO 4217). Extend here when a new market launches. */
export const CURRENCIES = ["CHF", "EUR", "USD", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

/** Default region per locale when the tenant country is unknown. */
const DEFAULT_REGION: Record<Locale, string> = {
  en: "CH",
  de: "CH",
  fr: "CH",
  it: "CH",
  es: "ES",
};

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
  US: "America/New_York",
  CA: "America/Toronto",
  MX: "America/Mexico_City",
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
    case "CH":
      return "de";
    default:
      return "en";
  }
}

/**
 * Build the Intl locale tag used for number/date formatting from the UI
 * language and the tenant's country: ("de","CH") -> "de-CH",
 * ("en","US") -> "en-US", ("es","US") -> "es-US".
 */
export function intlLocaleFor(locale: Locale, country?: string | null): string {
  const region = (country || DEFAULT_REGION[locale]).toUpperCase();
  const tag = `${locale}-${region}`;
  try {
    return Intl.NumberFormat.supportedLocalesOf([tag]).length ? tag : `${locale}-${DEFAULT_REGION[locale]}`;
  } catch {
    return locale;
  }
}

/**
 * Everything a request needs to render localised UI. Serialisable, so it can
 * be handed to <I18nProvider> for client components.
 */
export type LocaleContext = {
  /** UI language. */
  locale: Locale;
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
