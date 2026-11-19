import { intlLocaleFor, normalizeLocale, currencyForCountry, timezoneForCountry, DEFAULT_LOCALE, type Locale } from "./config";
import { createTranslator, type Messages, type Translator } from "./translator";
import { createFormatter, type Formatter } from "@/lib/format";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import fr from "@/messages/fr.json";
import it from "@/messages/it.json";
import es from "@/messages/es.json";

/**
 * All catalogs, type-checked against en.json: if a key is missing in any
 * locale, `tsc` fails here. Import this module only from server code (layouts,
 * server components, actions, email/PDF rendering) — client components get the
 * active locale's catalog through <I18nProvider>, so the browser never
 * downloads all five languages.
 */
export const CATALOGS: Record<Locale, Messages> = { en, de, fr, it, es };

export function getMessages(locale: Locale): Messages {
  return CATALOGS[locale] ?? CATALOGS.en;
}

/**
 * Translator for code that runs outside a request (emails, PDFs, cron jobs,
 * webhooks): pass the recipient's locale explicitly.
 */
export function getTranslator(locale: Locale, intlLocale?: string): Translator {
  return createTranslator(locale, getMessages(locale), CATALOGS.en, intlLocale);
}

/**
 * Translator + formatter for out-of-request rendering (emails, PDFs, cron):
 *
 *   const { t, f } = getStandaloneI18n({ locale: profile.locale, country: org.country, currency: org.currency });
 *   subject = t("email.invoiceIssued.subject", { invoice: inv.number, amount: f.money(inv.total) });
 */
export function getStandaloneI18n(opts: {
  locale?: string | null;
  country?: string | null;
  currency?: string | null;
  timeZone?: string | null;
}): { t: Translator; f: Formatter; locale: Locale } {
  const locale = normalizeLocale(opts.locale) ?? DEFAULT_LOCALE;
  const intl = intlLocaleFor(locale, opts.country);
  return {
    locale,
    t: getTranslator(locale, intl),
    f: createFormatter({
      locale: intl,
      currency: opts.currency ?? currencyForCountry(opts.country),
      timeZone: opts.timeZone ?? timezoneForCountry(opts.country),
    }),
  };
}
