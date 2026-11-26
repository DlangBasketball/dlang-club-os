/**
 * Payment-method matrix per country — pure (unit-tested in __tests__).
 *
 *   CH / LI -> card, TWINT, Swiss QR-bill, bank transfer (+ Apple/Google Pay via card)
 *   EU/EEA  -> card, SEPA Direct Debit, iDEAL (NL), Bancontact (BE), bank transfer
 *              (SEPA credit transfer, optional EPC QR) (+ wallets via card)
 *   US      -> card, ACH Direct Debit (Stripe us_bank_account) (+ wallets via card)
 *   other   -> card, bank transfer
 * "manual" (cash / cheque / office) is always available to finance staff.
 *
 * Keep PAYMENT_METHOD_KEYS in sync with public.is_known_payment_method() and
 * the payment_method enum (migration 20250420091800).
 */
import { normalizeCurrency } from "./currency";

export const PAYMENT_METHOD_KEYS = [
  "card", "twint", "bank_transfer", "qr_bill", "manual",
  "sepa_debit", "ach", "ideal", "bancontact", "apple_pay", "google_pay",
] as const;
export type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];

export type PaymentRegion = "CH" | "EU" | "US" | "INTL";

/** Stripe PaymentMethod types we create intents/sessions with. */
export type StripeMethodType = "card" | "twint" | "sepa_debit" | "ideal" | "bancontact" | "us_bank_account";

type MethodInfo = {
  label: string;
  /** stripe: collected online via the club's connected Stripe account.
   *  offline: payer pays outside the app; finance reconciles.
   *  hybrid: online through Stripe when available, else offline instructions. */
  rail: "stripe" | "offline" | "hybrid";
  stripeType?: StripeMethodType;
  /** Currencies the rail can settle in (undefined = any). */
  currencies?: readonly string[];
  /** Funds confirm after days (debits) rather than instantly. */
  delayedSettlement?: boolean;
};

export const METHOD_INFO: Record<PaymentMethodKey, MethodInfo> = {
  card:          { label: "Card",                rail: "stripe",  stripeType: "card" },
  apple_pay:     { label: "Apple Pay",           rail: "stripe",  stripeType: "card" },
  google_pay:    { label: "Google Pay",          rail: "stripe",  stripeType: "card" },
  twint:         { label: "TWINT",               rail: "hybrid",  stripeType: "twint", currencies: ["CHF"] },
  qr_bill:       { label: "QR-bill",             rail: "offline", currencies: ["CHF", "EUR"] },
  bank_transfer: { label: "Bank transfer",       rail: "offline" },
  manual:        { label: "Cash / manual",       rail: "offline" },
  sepa_debit:    { label: "SEPA Direct Debit",   rail: "stripe",  stripeType: "sepa_debit", currencies: ["EUR"], delayedSettlement: true },
  ideal:         { label: "iDEAL",               rail: "stripe",  stripeType: "ideal", currencies: ["EUR"] },
  bancontact:    { label: "Bancontact",          rail: "stripe",  stripeType: "bancontact", currencies: ["EUR"] },
  ach:           { label: "ACH bank debit",      rail: "stripe",  stripeType: "us_bank_account", currencies: ["USD"], delayedSettlement: true },
};

/** EU member states + EEA (IS, LI handled as CH, NO) — the SEPA debit area we sell into. */
const EU_EEA = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT",
  "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "IS", "NO",
]);

export function isKnownMethod(key: string): key is PaymentMethodKey {
  return (PAYMENT_METHOD_KEYS as readonly string[]).includes(key);
}

export function regionForCountry(country: string | null | undefined): PaymentRegion {
  const cc = (country ?? "").trim().toUpperCase();
  if (cc === "CH" || cc === "LI") return "CH";
  if (cc === "US") return "US";
  if (EU_EEA.has(cc)) return "EU";
  return "INTL";
}

const COUNTRY_CURRENCY: Record<string, string> = {
  CH: "CHF", LI: "CHF", US: "USD", GB: "GBP", SE: "SEK", DK: "DKK", NO: "NOK", PL: "PLN", CZ: "CZK",
  HU: "HUF", RO: "RON", BG: "BGN", IS: "ISK", CA: "CAD", AU: "AUD",
};

/** Default fee currency for a new club in `country`. */
export function defaultCurrencyForCountry(country: string): string {
  const cc = country.trim().toUpperCase();
  return COUNTRY_CURRENCY[cc] ?? (EU_EEA.has(cc) ? "EUR" : "USD");
}

/** Every method the platform supports for a club in `country` (before club choice). */
export function supportedMethodsForCountry(country: string): PaymentMethodKey[] {
  const cc = country.trim().toUpperCase();
  switch (regionForCountry(cc)) {
    case "CH":
      return ["card", "twint", "qr_bill", "bank_transfer", "apple_pay", "google_pay", "manual"];
    case "EU": {
      const m: PaymentMethodKey[] = ["card", "sepa_debit"];
      if (cc === "NL") m.push("ideal");
      if (cc === "BE") m.push("bancontact");
      m.push("bank_transfer", "apple_pay", "google_pay", "manual");
      return m;
    }
    case "US":
      return ["card", "ach", "apple_pay", "google_pay", "manual"];
    default:
      return ["card", "bank_transfer", "apple_pay", "google_pay", "manual"];
  }
}

/** Sensible defaults when a club is created (wallets ride on card automatically). */
export function defaultEnabledMethods(country: string): PaymentMethodKey[] {
  switch (regionForCountry(country)) {
    case "CH": return ["card", "twint", "qr_bill", "bank_transfer", "manual"];
    case "EU": return supportedMethodsForCountry(country).filter((m) => m !== "apple_pay" && m !== "google_pay");
    case "US": return ["card", "ach", "manual"];
    default:   return ["card", "bank_transfer", "manual"];
  }
}

export type MethodContext = {
  country: string;
  currency: string;
  /** Methods the club switched on (organizations.payment_settings.enabled_methods). */
  enabled?: readonly string[] | null;
  /** Connected Stripe account can take charges. */
  stripeReady: boolean;
  sepaEnabled?: boolean;
  achEnabled?: boolean;
  /** Collect TWINT through Stripe (needs a connected CH account with TWINT
   *  activated). false/undefined -> manual TWINT to the club's number. */
  twintOnline?: boolean;
  iban?: string | null;
  qrIban?: string | null;
  twintNumber?: string | null;
};

export type AvailableMethod = {
  key: PaymentMethodKey;
  label: string;
  /** How THIS payer would pay right now. */
  via: "stripe" | "offline";
  stripeType?: StripeMethodType;
  delayedSettlement: boolean;
};

/**
 * Methods a payer can actually use for an invoice: intersection of the country
 * matrix, the club's enabled list, the invoice currency, and what's configured
 * (Stripe account, IBAN, TWINT number, SEPA/ACH toggles).
 */
export function availableMethods(ctx: MethodContext): AvailableMethod[] {
  const currency = normalizeCurrency(ctx.currency);
  const enabled = ctx.enabled && ctx.enabled.length ? new Set(ctx.enabled) : null;
  const out: AvailableMethod[] = [];

  for (const key of supportedMethodsForCountry(ctx.country)) {
    const info = METHOD_INFO[key];
    // Wallets ride on card: enabled whenever card is.
    const enabledKey = key === "apple_pay" || key === "google_pay" ? "card" : key;
    if (enabled && !enabled.has(enabledKey)) continue;
    if (info.currencies && !info.currencies.includes(currency)) continue;

    let via: "stripe" | "offline" | null = null;
    switch (key) {
      case "sepa_debit": via = ctx.stripeReady && ctx.sepaEnabled ? "stripe" : null; break;
      case "ach":        via = ctx.stripeReady && ctx.achEnabled ? "stripe" : null; break;
      case "twint":      via = ctx.stripeReady && ctx.twintOnline ? "stripe" : ctx.twintNumber ? "offline" : null; break;
      case "qr_bill":    via = ctx.qrIban || ctx.iban ? "offline" : null; break;
      case "bank_transfer": via = ctx.iban ? "offline" : null; break;
      case "manual":     via = "offline"; break;
      default:           via = info.rail === "stripe" && ctx.stripeReady ? "stripe" : null;
    }
    if (!via) continue;
    out.push({
      key,
      label: info.label,
      via,
      stripeType: via === "stripe" ? info.stripeType : undefined,
      delayedSettlement: Boolean(info.delayedSettlement),
    });
  }
  return out;
}

/** Distinct Stripe payment_method_types for a Checkout Session / PaymentIntent. */
export function stripeMethodTypes(methods: readonly AvailableMethod[]): StripeMethodType[] {
  const types = new Set<StripeMethodType>();
  for (const m of methods) if (m.via === "stripe" && m.stripeType) types.add(m.stripeType);
  return Array.from(types);
}

/** Maps a Stripe charge's payment_method_details to our method key. */
export function methodFromStripe(type: string | null | undefined, walletType?: string | null): PaymentMethodKey {
  switch (type) {
    case "card":
      if (walletType === "apple_pay") return "apple_pay";
      if (walletType === "google_pay") return "google_pay";
      return "card";
    case "twint": return "twint";
    case "sepa_debit": return "sepa_debit";
    case "ideal": return "ideal";
    case "bancontact": return "bancontact";
    case "us_bank_account": return "ach";
    default: return "card";
  }
}

export function methodLabel(key: string): string {
  return isKnownMethod(key) ? METHOD_INFO[key].label : key;
}
