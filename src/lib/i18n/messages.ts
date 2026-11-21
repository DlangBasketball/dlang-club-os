import {
  DEFAULT_LOCALE,
  HOME_REGION,
  LOCALES,
  SOURCE_LOCALE,
  catalogChain,
  currencyForCountry,
  directionOf,
  intlLocaleFor,
  localeTagsFor,
  normalizeLocale,
  timezoneForCountry,
  type Locale,
  type TextDirection,
} from "./config";
import { createTranslator, mergeCatalogs, type Messages, type PartialMessages, type Translator } from "./translator";
import { createFormatter, type Formatter } from "@/lib/format";
import { CATALOG_SOURCES } from "@/messages";

/**
 * Message loading. Import this module only from server code (layouts, server
 * components, actions, email/PDF rendering) — client components get the
 * active catalog through <I18nProvider>, so the browser never downloads every
 * language.
 *
 * A catalog is the merge of its fallback chain, most general first:
 *   de-CH = en <- de <- de-CH overlay      fr-CH = en <- fr <- fr-CH overlay
 * so a key missing in an overlay or a partial catalog always resolves.
 */

/** English source catalog (complete by definition). */
export const SOURCE_MESSAGES = CATALOG_SOURCES[SOURCE_LOCALE] as Messages;

const merged = new Map<string, Messages>();

/** Raw (unmerged) catalog layers, for tooling and tests. */
export function catalogLayers(locale: string): { tag: Locale; messages: PartialMessages }[] {
  return catalogChain(locale)
    .reverse()
    .map((tag) => ({ tag, messages: CATALOG_SOURCES[tag] ?? {} }));
}

/** Fully merged catalog for any tag ("de-CH", "de-AT" -> de, "pt-BR" -> en). */
export function getMessages(locale: string): Messages {
  const key = catalogChain(locale)[0] ?? SOURCE_LOCALE;
  let m = merged.get(key);
  if (!m) {
    m = mergeCatalogs(...catalogLayers(key).map((l) => l.messages));
    merged.set(key, m);
  }
  return m;
}

/** Every renderable language, fully merged (lazy per language). */
export const CATALOGS = Object.defineProperties(
  {} as Record<Locale, Messages>,
  Object.fromEntries(LOCALES.map((l) => [l, { enumerable: true, get: () => getMessages(l) }])),
);

/**
 * Translator for code that runs outside a request (emails, PDFs, cron jobs,
 * webhooks): pass the recipient's locale explicitly.
 */
export function getTranslator(locale: string, intlLocale?: string): Translator {
  const tag = normalizeLocale(locale) ?? DEFAULT_LOCALE;
  return createTranslator(tag, getMessages(tag), SOURCE_MESSAGES, intlLocale);
}

/**
 * Translator + formatter for out-of-request rendering (emails, PDFs, cron):
 *
 *   const { t, f } = getStandaloneI18n({ locale: profile.locale, country: org.country, currency: org.currency });
 *   subject = t("email.invoiceIssued.subject", { invoice: inv.number, amount: f.money(inv.total) });
 *
 * The recipient's language picks the catalog; the club's country picks the
 * regional variant and number/date formats (a Swiss club's German email uses
 * Swiss spelling and CHF 1'234.50).
 */
export function getStandaloneI18n(opts: {
  locale?: string | null;
  country?: string | null;
  currency?: string | null;
  timeZone?: string | null;
  /** Per-language formatting region chosen by the club, e.g. { en: "CH" }. */
  region?: string | null;
}): { t: Translator; f: Formatter; locale: Locale; catalogLocale: Locale; intlLocale: string; dir: TextDirection } {
  const locale = normalizeLocale(opts.locale) ?? DEFAULT_LOCALE;
  const region = (opts.region || (locale.includes("-") ? locale.split("-").pop() : null) || opts.country || HOME_REGION).toUpperCase();
  const { catalogLocale } = localeTagsFor(locale, region);
  const intl = opts.region ? localeTagsFor(locale, region).intlLocale : intlLocaleFor(locale, opts.country);
  return {
    locale,
    catalogLocale,
    intlLocale: intl,
    dir: directionOf(catalogLocale),
    t: createTranslator(catalogLocale, getMessages(catalogLocale), SOURCE_MESSAGES, intl),
    f: createFormatter({
      locale: intl,
      currency: opts.currency ?? currencyForCountry(opts.country),
      timeZone: opts.timeZone ?? timezoneForCountry(opts.country),
    }),
  };
}
