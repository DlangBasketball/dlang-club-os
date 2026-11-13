/**
 * Tax helpers — pure. Mirrors public.tax_breakdown() and the
 * invoices_currency_tax trigger in migration 20250420091800.
 *
 * Rates below are the STANDARD national rates and are defaults only: many
 * sports-club membership/tuition fees are exempt (e.g. CH MWSTG art. 21
 * "sport" exemption, EU VAT Directive art. 132(1)(m)), and US sales tax on club
 * dues depends on the state. A club must confirm with its tax adviser; the
 * default profile therefore ships with `applies: false`.
 */
import { toMinorUnits, fromMinorUnits } from "./currency";

export type TaxProfile = {
  /** Label printed on invoices: MWST, TVA, IVA, USt, BTW, VAT, Sales tax… */
  label: string;
  /** Standard rate in percent (8.1 = 8.1%). */
  standardRate: number;
  /** Whether prices are usually quoted tax-inclusive in this market. */
  inclusiveByDefault: boolean;
  /** Whether the club should charge tax by default (false: most club fees exempt). */
  applies: boolean;
};

const EU_STANDARD_RATES: Record<string, { rate: number; label: string }> = {
  AT: { rate: 20, label: "USt" }, BE: { rate: 21, label: "BTW/TVA" }, BG: { rate: 20, label: "ДДС" },
  CY: { rate: 19, label: "ΦΠΑ" }, CZ: { rate: 21, label: "DPH" }, DE: { rate: 19, label: "USt" },
  DK: { rate: 25, label: "moms" }, EE: { rate: 24, label: "km" }, ES: { rate: 21, label: "IVA" },
  FI: { rate: 25.5, label: "ALV" }, FR: { rate: 20, label: "TVA" }, GR: { rate: 24, label: "ΦΠΑ" },
  HR: { rate: 25, label: "PDV" }, HU: { rate: 27, label: "ÁFA" }, IE: { rate: 23, label: "VAT" },
  IT: { rate: 22, label: "IVA" }, LT: { rate: 21, label: "PVM" }, LU: { rate: 17, label: "TVA" },
  LV: { rate: 21, label: "PVN" }, MT: { rate: 18, label: "VAT" }, NL: { rate: 21, label: "BTW" },
  PL: { rate: 23, label: "VAT" }, PT: { rate: 23, label: "IVA" }, RO: { rate: 21, label: "TVA" },
  SE: { rate: 25, label: "moms" }, SI: { rate: 22, label: "DDV" }, SK: { rate: 23, label: "DPH" },
};

/** Swiss label follows the club's language: MWST (de) / TVA (fr) / IVA (it) / VAT (en). */
function swissLabel(locale?: string): string {
  const lang = (locale ?? "de").slice(0, 2).toLowerCase();
  return lang === "fr" ? "TVA" : lang === "it" ? "IVA" : lang === "en" ? "VAT" : "MWST";
}

/** Default tax profile for a country (ISO 3166-1 alpha-2). */
export function defaultTaxProfile(country: string, locale?: string): TaxProfile {
  const cc = country.trim().toUpperCase();
  if (cc === "CH" || cc === "LI") return { label: swissLabel(locale), standardRate: 8.1, inclusiveByDefault: true, applies: false };
  if (cc === "US") return { label: "Sales tax", standardRate: 0, inclusiveByDefault: false, applies: false };
  if (cc === "GB") return { label: "VAT", standardRate: 20, inclusiveByDefault: true, applies: false };
  const eu = EU_STANDARD_RATES[cc];
  if (eu) return { label: eu.label, standardRate: eu.rate, inclusiveByDefault: true, applies: false };
  return { label: "Tax", standardRate: 0, inclusiveByDefault: true, applies: false };
}

export type TaxInput = {
  /** Sum of line amounts (gross if inclusive, net if exclusive), major units. */
  base: number;
  /** Percent, e.g. 8.1. */
  rate: number;
  inclusive: boolean;
  /** EU B2B reverse charge: tax is accounted for by the buyer; we charge 0. */
  reverseCharge?: boolean;
  currency: string;
};

export type TaxBreakdown = { net: number; tax: number; gross: number; effectiveRate: number };

/**
 * Splits an amount into net / tax / gross, rounded to the currency's minor
 * unit. net + tax === gross always holds exactly (computed in minor units).
 */
export function computeTax({ base, rate, inclusive, reverseCharge = false, currency }: TaxInput): TaxBreakdown {
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error(`Invalid tax rate: ${rate}`);
  const r = reverseCharge ? 0 : rate;
  const baseMinor = toMinorUnits(base, currency);
  // Work at minor-unit scale; round half away from zero like Postgres round().
  const roundHalfAway = (x: number) => Math.sign(x) * Math.round(Math.abs(x) + 1e-9);
  let netMinor: number;
  let taxMinor: number;
  if (inclusive) {
    taxMinor = roundHalfAway((baseMinor * r) / (100 + r));
    netMinor = baseMinor - taxMinor;
  } else {
    netMinor = baseMinor;
    taxMinor = roundHalfAway((baseMinor * r) / 100);
  }
  return {
    net: fromMinorUnits(netMinor, currency),
    tax: fromMinorUnits(taxMinor, currency),
    gross: fromMinorUnits(netMinor + taxMinor, currency),
    effectiveRate: r,
  };
}

/** Footer note required on reverse-charge / exempt invoices. */
export function taxNote(opts: { reverseCharge?: boolean; exemptReason?: string | null; country: string }): string | null {
  if (opts.reverseCharge) return "Reverse charge — VAT to be accounted for by the recipient (Art. 196 Directive 2006/112/EC).";
  if (opts.exemptReason) return opts.exemptReason;
  return null;
}
