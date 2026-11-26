import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPaymentSettings } from "@/lib/data/payment-settings";
import type { PaymentSettings as SwissPaymentSettings } from "@/lib/swiss-payments";
import { normalizeCurrency } from "./currency";
import {
  availableMethods,
  defaultEnabledMethods,
  regionForCountry,
  type AvailableMethod,
  type PaymentRegion,
} from "./methods";
import { defaultTaxProfile } from "./tax";

/** Shape of organizations.payment_settings (snake_case, as stored). */
export type StoredPaymentSettings = {
  enabled_methods?: string[];
  creditor?: { name?: string; street?: string; building?: string; zip?: string; city?: string; country?: string };
  iban?: string;
  qr_iban?: string;
  bic?: string;
  twint_number?: string;
  reference_type?: "QRR" | "SCOR" | "NON";
  reference_prefix?: string;
  sepa_enabled?: boolean;
  us_ach_enabled?: boolean;
  epc_qr_enabled?: boolean;
  plan_code?: string;
  tax?: { label?: string; rate?: number; inclusive?: boolean; registration_number?: string };
  stripe?: {
    account_id?: string;
    account_type?: "standard" | "express";
    charges_enabled?: boolean;
    payouts_enabled?: boolean;
    details_submitted?: boolean;
    updated_at?: string;
  };
};

export type OrgPaymentProfile = {
  orgId: string;
  name: string;
  country: string;
  region: PaymentRegion;
  currency: string;
  settings: StoredPaymentSettings;
  stripeAccountId: string | null;
  stripeReady: boolean;
  taxLabel: string;
  /** Legacy Swiss QR-bill settings (creditor, IBAN/QR-IBAN, reference type). */
  swiss: SwissPaymentSettings;
};

/**
 * Loads the org's payment profile via the service-role RPC (falls back to the
 * legacy app_settings reader if the regional-payments migration isn't applied).
 */
export async function getOrgPaymentProfile(orgId: string): Promise<OrgPaymentProfile> {
  const supabase = createAdminClient();
  const [{ data }, swiss] = await Promise.all([
    supabase.rpc("get_org_payment_profile", { p_org: orgId }),
    getPaymentSettings(orgId),
  ]);
  const p = (data ?? null) as null | {
    name?: string; country?: string; currency?: string; settings?: StoredPaymentSettings; stripe_connected?: boolean;
  };

  const country = (p?.country ?? swiss.creditorCountry ?? "CH").toUpperCase();
  const settings: StoredPaymentSettings = p?.settings ?? {};
  const accountId = settings.stripe?.account_id ?? null;
  // Legacy single-account mode: no connected account but the platform key is
  // set -> charges go to the platform account (founding-club setup).
  const legacyPlatform = !accountId && Boolean(process.env.STRIPE_SECRET_KEY) && process.env.STRIPE_CONNECT_REQUIRED !== "true";

  return {
    orgId,
    name: p?.name ?? swiss.creditorName,
    country,
    region: regionForCountry(country),
    currency: normalizeCurrency(p?.currency ?? "CHF"),
    settings,
    stripeAccountId: accountId,
    stripeReady: Boolean(accountId && settings.stripe?.charges_enabled) || legacyPlatform,
    taxLabel: settings.tax?.label || defaultTaxProfile(country).label,
    swiss,
  };
}

/** Methods a payer can use for an invoice in `currency` right now. */
export function methodsForInvoice(profile: OrgPaymentProfile, currency: string): AvailableMethod[] {
  const s = profile.settings;
  return availableMethods({
    country: profile.country,
    currency,
    enabled: s.enabled_methods?.length ? s.enabled_methods : defaultEnabledMethods(profile.country),
    stripeReady: profile.stripeReady,
    sepaEnabled: s.sepa_enabled,
    achEnabled: s.us_ach_enabled,
    twintOnline: Boolean(profile.stripeAccountId && s.stripe?.charges_enabled),
    iban: s.iban || profile.swiss.iban,
    qrIban: s.qr_iban || profile.swiss.qrIban,
    twintNumber: s.twint_number || profile.swiss.twintNumber,
  });
}
