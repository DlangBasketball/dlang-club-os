import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";

export type Venue = { name: string; address: string };
export type ClubSettings = {
  orgId: string;
  profile: { name: string; legalName: string; address: string; contactEmail: string; contactPhone: string; website: string; country: string };
  brand: { primaryColor: string; logoUrl: string };
  venues: Venue[];
  payments: { creditor: string; iban: string; qrIban: string; twint: string; referenceType: string; referencePrefix: string };
  invoicing: { pattern: string; nextCounter: number };
  tax: { vatRate: number; vatNumber: string; inclusive: boolean };
  localization: { currency: string; defaultLocale: string; languages: string[] };
  privacy: { parentAttendanceVisible: boolean; shareMediaInternally: boolean };
  retention: { months: number };
  acceptedMethods: string[];
};

type S = Record<string, unknown>;
const obj = (v: unknown): S => (v && typeof v === "object" ? (v as S) : {});
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);

export async function getClubSettings(): Promise<ClubSettings | null> {
  const me = await getSessionUser();
  if (!me?.orgId) return null;
  const admin = createAdminClient();
  const [{ data: org }, { data: as }] = await Promise.all([
    admin.from("organizations").select("name,country,currency").eq("id", me.orgId).maybeSingle(),
    admin.from("app_settings").select("invoice_pattern,invoice_counter,currency,default_locale,payment_methods,settings").eq("org_id", me.orgId).maybeSingle(),
  ]);
  const s = obj(as?.settings);
  const profile = obj(s.profile), brand = obj(s.brand), pay = obj(s.payments), tax = obj(s.tax), privacy = obj(s.privacy), retention = obj(s.retention);
  const venues = Array.isArray(s.venues) ? (s.venues as Venue[]) : [];
  const languages = Array.isArray(s.languages) ? (s.languages as string[]) : ["en", "fr"];
  const methods = Array.isArray(as?.payment_methods) ? (as!.payment_methods as string[]) : [];
  return {
    orgId: me.orgId,
    profile: { name: org?.name ?? "", legalName: str(profile.legal_name), address: str(profile.address), contactEmail: str(profile.contact_email), contactPhone: str(profile.contact_phone), website: str(profile.website), country: org?.country ?? "" },
    brand: { primaryColor: str(brand.primary_color, "#DA2627"), logoUrl: str(brand.logo_url) },
    venues,
    payments: { creditor: str(pay.creditor), iban: str(pay.iban), qrIban: str(pay.qr_iban), twint: str(pay.twint), referenceType: str(pay.reference_type, "QRR"), referencePrefix: str(pay.reference_prefix) },
    invoicing: { pattern: as?.invoice_pattern ?? "INV-{YYYY}-{####}", nextCounter: (as?.invoice_counter ?? 0) + 1 },
    tax: { vatRate: typeof tax.vat_rate === "number" ? tax.vat_rate : 0, vatNumber: str(tax.vat_number), inclusive: Boolean(tax.inclusive) },
    localization: { currency: as?.currency ?? org?.currency ?? "CHF", defaultLocale: as?.default_locale ?? "en", languages },
    privacy: { parentAttendanceVisible: s.parent_attendance_visible !== false, shareMediaInternally: Boolean(privacy.share_media_internally) },
    retention: { months: typeof retention.months === "number" ? retention.months : 60 },
    acceptedMethods: methods,
  };
}

/** Stored notification template overrides (subject/body per type). */
export async function getTemplateOverrides(): Promise<Record<string, { subject?: string; body?: string }>> {
  const me = await getSessionUser();
  if (!me?.orgId) return {};
  const admin = createAdminClient();
  const { data } = await admin.from("app_settings").select("settings").eq("org_id", me.orgId).maybeSingle();
  const s = obj(data?.settings);
  return obj(s.notification_templates) as Record<string, { subject?: string; body?: string }>;
}

/** The signed-in user's club contact email (Settings → Profile), or null. */
export async function getClubContactEmail(): Promise<string | null> {
  const me = await getSessionUser();
  if (!me?.orgId) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("app_settings").select("settings").eq("org_id", me.orgId).maybeSingle();
  const email = str(obj(obj(data?.settings).profile).contact_email).trim();
  return email || null;
}
