import { createAdminClient } from "@/lib/supabase/admin";
import type { PaymentSettings } from "@/lib/swiss-payments";

const DEFAULTS: PaymentSettings = {
  creditorName: "",
  creditorStreet: "",
  creditorBuilding: "",
  creditorZip: "",
  creditorCity: "",
  creditorCountry: "CH",
  iban: "",
  qrIban: "",
  twintNumber: "",
  referenceType: "QRR",
  referencePrefix: "21",
};

/**
 * Reads the club's creditor / payment display settings. These (IBAN, TWINT
 * number, creditor address) are meant to be shown to payers, so we read them
 * server-side with the admin client and return only the display fields.
 */
export async function getPaymentSettings(orgId: string): Promise<PaymentSettings> {
  const supabase = createAdminClient();
  const [{ data }, { data: org }] = await Promise.all([
    supabase.from("app_settings").select("settings").eq("org_id", orgId).maybeSingle(),
    supabase.from("organizations").select("name, country").eq("id", orgId).maybeSingle(),
  ]);
  const p = ((data?.settings ?? {}) as { payments?: Record<string, string> }).payments ?? {};
  // Creditor falls back to the tenant's own name/country, never another club's.
  return {
    creditorName: p.creditor_name || org?.name || DEFAULTS.creditorName,
    creditorStreet: p.creditor_street ?? "",
    creditorBuilding: p.creditor_building ?? "",
    creditorZip: p.creditor_zip ?? "",
    creditorCity: p.creditor_city ?? DEFAULTS.creditorCity,
    creditorCountry: p.creditor_country ?? org?.country ?? "CH",
    iban: p.iban ?? "",
    qrIban: p.qr_iban ?? "",
    twintNumber: p.twint_number ?? "",
    referenceType: (p.reference_type as PaymentSettings["referenceType"]) ?? "QRR",
    referencePrefix: p.reference_prefix ?? "21",
  };
}

const METHOD_LABELS: Record<string, string> = {
  card: "Card", twint: "TWINT", bank_transfer: "Bank transfer", manual: "Cash / manual", qr_bill: "QR-bill",
};

export async function getAcceptedMethods(orgId: string): Promise<{ key: string; label: string }[]> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("app_settings").select("payment_methods").eq("org_id", orgId).maybeSingle();
  const methods = (data?.payment_methods as string[] | null) ?? ["card", "twint", "bank_transfer"];
  return methods.map((m) => ({ key: m, label: METHOD_LABELS[m] ?? m }));
}
