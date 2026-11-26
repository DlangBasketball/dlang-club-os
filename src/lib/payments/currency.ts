/**
 * Currency helpers — pure, framework-free (unit-tested in __tests__).
 * Mirrors public.currency_exponent() in migration 20250420091800.
 */

/** ISO 4217 currencies whose minor-unit exponent is not 2. */
const EXPONENT_OVERRIDES: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, JOD: 3, KWD: 3, OMR: 3, TND: 3,
};

/** Currencies the platform actively supports for club fees at launch. */
export const SUPPORTED_CURRENCIES = ["CHF", "EUR", "USD", "GBP", "SEK", "DKK", "NOK", "PLN", "CZK", "CAD", "AUD"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/** Normalises "chf" / " Chf " to "CHF". Throws on anything that isn't 3 letters. */
export function normalizeCurrency(code: string | null | undefined, fallback = "CHF"): string {
  const c = (code ?? "").trim().toUpperCase() || fallback.toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw new Error(`Invalid currency code: ${code}`);
  return c;
}

export function isSupportedCurrency(code: string): code is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(code.toUpperCase());
}

/** Number of decimal places in the currency's minor unit (CHF 2, JPY 0, KWD 3). */
export function currencyExponent(code: string): number {
  return EXPONENT_OVERRIDES[normalizeCurrency(code)] ?? 2;
}

/**
 * Converts a major-unit amount (e.g. 12.5 CHF) to integer minor units (1250),
 * the representation Stripe expects. Rounds half away from zero, after first
 * snapping to 6 decimals to absorb binary float noise (0.1 + 0.2).
 */
export function toMinorUnits(amount: number, currency: string): number {
  if (!Number.isFinite(amount)) throw new Error(`Invalid amount: ${amount}`);
  const scale = 10 ** currencyExponent(currency);
  const snapped = Math.round(amount * scale * 1e6) / 1e6;
  return Math.sign(snapped) * Math.round(Math.abs(snapped));
}

/** Converts integer minor units back to a major-unit number. */
export function fromMinorUnits(minor: number, currency: string): number {
  if (!Number.isInteger(minor)) throw new Error(`Minor units must be an integer: ${minor}`);
  const exp = currencyExponent(currency);
  return Number((minor / 10 ** exp).toFixed(exp));
}

/** Rounds a major-unit amount to the currency's precision. */
export function roundMoney(amount: number, currency: string): number {
  return fromMinorUnits(toMinorUnits(amount, currency), currency);
}

/** Default display locale per currency when the tenant has none configured. */
const DEFAULT_LOCALE: Record<string, string> = {
  CHF: "de-CH", EUR: "de-DE", USD: "en-US", GBP: "en-GB", SEK: "sv-SE", DKK: "da-DK",
  NOK: "nb-NO", PLN: "pl-PL", CZK: "cs-CZ", CAD: "en-CA", AUD: "en-AU",
};

/** Locale-aware money formatting: formatMoney(1234.5, "EUR", "fr-FR") -> "1 234,50 €". */
export function formatMoney(amount: number | string | null | undefined, currency: string, locale?: string): string {
  const cur = normalizeCurrency(currency);
  const n = typeof amount === "string" ? Number(amount) : amount ?? 0;
  const exp = currencyExponent(cur);
  return new Intl.NumberFormat(locale ?? DEFAULT_LOCALE[cur] ?? "en-US", {
    style: "currency",
    currency: cur,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(Number.isFinite(n) ? n : 0);
}
