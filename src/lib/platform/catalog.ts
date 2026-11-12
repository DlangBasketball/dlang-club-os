import type { BillingInterval, Currency } from "./types";
import { PLATFORM_NAME } from "@/lib/brand";

/**
 * Static catalogue for the SaaS layer: product name, sellable currencies,
 * sports, launch countries and the feature keys plans can switch on.
 * Safe to import from client and server code (no secrets).
 */

export { PLATFORM_NAME };

export const CURRENCIES: Currency[] = ["CHF", "EUR", "USD"];
export const INTERVALS: BillingInterval[] = ["month", "year"];

export const TRIAL_DAYS = 14;

export const SPORTS: { value: string; label: string }[] = [
  { value: "basketball", label: "Basketball" },
  { value: "football", label: "Football / Soccer" },
  { value: "volleyball", label: "Volleyball" },
  { value: "handball", label: "Handball" },
  { value: "ice_hockey", label: "Ice hockey" },
  { value: "field_hockey", label: "Field hockey" },
  { value: "floorball", label: "Floorball" },
  { value: "tennis", label: "Tennis" },
  { value: "swimming", label: "Swimming" },
  { value: "athletics", label: "Athletics / Track" },
  { value: "gymnastics", label: "Gymnastics" },
  { value: "rugby", label: "Rugby" },
  { value: "baseball", label: "Baseball / Softball" },
  { value: "lacrosse", label: "Lacrosse" },
  { value: "american_football", label: "American football" },
  { value: "martial_arts", label: "Martial arts" },
  { value: "multi_sport", label: "Multi-sport" },
  { value: "other", label: "Other" },
];

/** Launch markets: Switzerland, the EU/EEA, the UK and North America. */
export const COUNTRIES: { code: string; name: string; currency: Currency; locale: string }[] = [
  { code: "CH", name: "Switzerland", currency: "CHF", locale: "de" },
  { code: "LI", name: "Liechtenstein", currency: "CHF", locale: "de" },
  { code: "AT", name: "Austria", currency: "EUR", locale: "de" },
  { code: "BE", name: "Belgium", currency: "EUR", locale: "fr" },
  { code: "DE", name: "Germany", currency: "EUR", locale: "de" },
  { code: "DK", name: "Denmark", currency: "EUR", locale: "en" },
  { code: "ES", name: "Spain", currency: "EUR", locale: "es" },
  { code: "FI", name: "Finland", currency: "EUR", locale: "en" },
  { code: "FR", name: "France", currency: "EUR", locale: "fr" },
  { code: "GR", name: "Greece", currency: "EUR", locale: "en" },
  { code: "IE", name: "Ireland", currency: "EUR", locale: "en" },
  { code: "IT", name: "Italy", currency: "EUR", locale: "it" },
  { code: "LU", name: "Luxembourg", currency: "EUR", locale: "fr" },
  { code: "NL", name: "Netherlands", currency: "EUR", locale: "nl" },
  { code: "PL", name: "Poland", currency: "EUR", locale: "en" },
  { code: "PT", name: "Portugal", currency: "EUR", locale: "pt" },
  { code: "SE", name: "Sweden", currency: "EUR", locale: "en" },
  { code: "GB", name: "United Kingdom", currency: "EUR", locale: "en" },
  { code: "US", name: "United States", currency: "USD", locale: "en" },
  { code: "CA", name: "Canada", currency: "USD", locale: "en" },
];

export const LOCALES: { value: string; label: string }[] = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "it", label: "Italiano" },
  { value: "es", label: "Español" },
  { value: "nl", label: "Nederlands" },
  { value: "pt", label: "Português" },
];

export function defaultsForCountry(code: string): { currency: Currency; locale: string } {
  const c = COUNTRIES.find((x) => x.code === code);
  return { currency: c?.currency ?? "USD", locale: c?.locale ?? "en" };
}

/**
 * Feature keys a plan can grant. Keep in sync with plans.features in SQL.
 * The AI assistant is NOT a plan feature: it is a separate add-on
 * (public.ai_assistant_addons, see src/lib/ai/access.ts).
 */
export const FEATURES = {
  registration: "Online registration",
  invoicing: "Invoicing",
  qr_bill: "Swiss QR-bill",
  online_payments: "Online card payments",
  attendance: "Attendance",
  messaging: "Messaging & notifications",
  documents_consent: "Documents & consents",
  bookings: "Player-development bookings",
  custom_branding: "Custom branding",
  custom_domain: "Custom domain",
  white_label: "Full white-label",
  multi_location: "Multiple teams & locations",
  reports_advanced: "Advanced reports",
  api_access: "API access",
  sso: "Single sign-on",
  federation_rollup: "Federation / school roll-up",
  priority_support: "Priority support",
} as const;

export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

export function isFeatureKey(v: string): v is FeatureKey {
  return Object.prototype.hasOwnProperty.call(FEATURES, v);
}

export function formatMoney(amount: number, currency: string, opts: { compact?: boolean } = {}) {
  const locale = currency === "CHF" ? "de-CH" : currency === "EUR" ? "de-DE" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: opts.compact || Number.isInteger(amount) ? 0 : 2,
    minimumFractionDigits: opts.compact || Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}
