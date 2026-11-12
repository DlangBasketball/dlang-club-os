"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function getAdmin() {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return null;
  return me as typeof me & { orgId: string };
}

type Json = Record<string, unknown>;

/** Shallow-merge top-level keys into app_settings.settings, then persist. */
async function patchSettings(orgId: string, patch: Json): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { data } = await admin.from("app_settings").select("settings").eq("org_id", orgId).maybeSingle();
  const current = (data?.settings ?? {}) as Json;
  const next: Json = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v) && current[k] && typeof current[k] === "object" && !Array.isArray(current[k])) {
      next[k] = { ...(current[k] as Json), ...(v as Json) };
    } else {
      next[k] = v;
    }
  }
  const { error } = await admin.from("app_settings").update({ settings: next, updated_at: new Date().toISOString() }).eq("org_id", orgId);
  return { error: error?.message };
}

async function audit(orgId: string, actorId: string, action: string, newData: Json) {
  const admin = createAdminClient();
  await admin.from("audit_logs").insert({ org_id: orgId, actor_id: actorId, action, target_table: "app_settings", target_id: orgId, new_data: newData });
}

export async function updateClubProfile(input: { name: string; legalName: string; address: string; contactEmail: string; contactPhone: string; website: string; country: string }): Promise<ActionResult> {
  const me = await getAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  if (!input.name.trim()) return { ok: false, error: "Club name is required" };
  const admin = createAdminClient();
  const { error: oErr } = await admin.from("organizations").update({ name: input.name.trim(), country: input.country || null }).eq("id", me.orgId);
  if (oErr) return { ok: false, error: oErr.message };
  const { error } = await patchSettings(me.orgId, { profile: { legal_name: input.legalName, address: input.address, contact_email: input.contactEmail, contact_phone: input.contactPhone, website: input.website } });
  if (error) return { ok: false, error };
  await audit(me.orgId, me.id, "settings.profile", { name: input.name });
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function updateBranding(input: { primaryColor: string; logoUrl: string }): Promise<ActionResult> {
  const me = await getAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  if (!/^#[0-9a-fA-F]{6}$/.test(input.primaryColor)) return { ok: false, error: "Primary color must be a hex value like #DA2627" };
  const { error } = await patchSettings(me.orgId, { brand: { primary_color: input.primaryColor, logo_url: input.logoUrl } });
  if (error) return { ok: false, error };
  await audit(me.orgId, me.id, "settings.brand", { primaryColor: input.primaryColor });
  revalidatePath("/admin/settings/branding");
  return { ok: true };
}

export async function updateVenues(venues: { name: string; address: string }[]): Promise<ActionResult> {
  const me = await getAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  const clean = venues.filter((v) => v.name.trim()).map((v) => ({ name: v.name.trim(), address: v.address.trim() }));
  const { error } = await patchSettings(me.orgId, { venues: clean });
  if (error) return { ok: false, error };
  revalidatePath("/admin/settings/branding");
  return { ok: true };
}

export async function updateLocalization(input: { currency: string; defaultLocale: string; languages: string[] }): Promise<ActionResult> {
  const me = await getAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  const admin = createAdminClient();
  await admin.from("app_settings").update({ currency: input.currency, default_locale: input.defaultLocale }).eq("org_id", me.orgId);
  await admin.from("organizations").update({ currency: input.currency }).eq("id", me.orgId);
  // Typed column from the i18n migration; ignored if the migration isn't applied yet.
  await admin.from("app_settings").update({ enabled_locales: input.languages }).eq("org_id", me.orgId);
  const { error } = await patchSettings(me.orgId, { languages: input.languages });
  if (error) return { ok: false, error };
  revalidatePath("/", "layout");
  revalidatePath("/admin/settings/branding");
  return { ok: true };
}

export async function updatePaymentInstructions(input: { creditor: string; iban: string; qrIban: string; twint: string; referenceType: string; referencePrefix: string }): Promise<ActionResult> {
  const me = await getAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  const { error } = await patchSettings(me.orgId, { payments: { creditor: input.creditor, iban: input.iban, qr_iban: input.qrIban, twint: input.twint, reference_type: input.referenceType, reference_prefix: input.referencePrefix } });
  if (error) return { ok: false, error };
  await audit(me.orgId, me.id, "settings.payments", { creditor: input.creditor });
  revalidatePath("/admin/settings/billing");
  return { ok: true };
}

export async function updateInvoiceSettings(input: { pattern: string; nextCounter: number; acceptedMethods: string[] }): Promise<ActionResult> {
  const me = await getAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  const admin = createAdminClient();
  const counter = Math.max(0, Math.floor(input.nextCounter) - 1); // next issued invoice will be counter+1
  const { error } = await admin.from("app_settings").update({ invoice_pattern: input.pattern, invoice_counter: counter, payment_methods: input.acceptedMethods }).eq("org_id", me.orgId);
  if (error) return { ok: false, error: error.message };
  await audit(me.orgId, me.id, "settings.invoicing", { pattern: input.pattern, nextCounter: input.nextCounter });
  revalidatePath("/admin/settings/billing");
  return { ok: true };
}

export async function updateTax(input: { vatRate: number; vatNumber: string; inclusive: boolean }): Promise<ActionResult> {
  const me = await getAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  if (input.vatRate < 0 || input.vatRate > 100) return { ok: false, error: "VAT rate must be between 0 and 100" };
  const { error } = await patchSettings(me.orgId, { tax: { vat_rate: input.vatRate, vat_number: input.vatNumber, inclusive: input.inclusive } });
  if (error) return { ok: false, error };
  revalidatePath("/admin/settings/billing");
  return { ok: true };
}

export async function updatePrivacy(input: { parentAttendanceVisible: boolean; shareMediaInternally: boolean }): Promise<ActionResult> {
  const me = await getAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  const { error } = await patchSettings(me.orgId, { parent_attendance_visible: input.parentAttendanceVisible, privacy: { share_media_internally: input.shareMediaInternally } });
  if (error) return { ok: false, error };
  await audit(me.orgId, me.id, "settings.privacy", { ...input });
  revalidatePath("/admin/settings/privacy");
  return { ok: true };
}

export async function updateRetention(months: number): Promise<ActionResult> {
  const me = await getAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  if (months < 1) return { ok: false, error: "Retention must be at least 1 month" };
  const { error } = await patchSettings(me.orgId, { retention: { months: Math.floor(months) } });
  if (error) return { ok: false, error };
  await audit(me.orgId, me.id, "settings.retention", { months });
  revalidatePath("/admin/settings/privacy");
  return { ok: true };
}

export async function updateNotificationTemplate(type: string, subject: string, body: string): Promise<ActionResult> {
  const me = await getAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  const admin = createAdminClient();
  const { data } = await admin.from("app_settings").select("settings").eq("org_id", me.orgId).maybeSingle();
  const current = (data?.settings ?? {}) as Json;
  const templates = { ...((current.notification_templates as Json) ?? {}) };
  templates[type] = { subject, body };
  const { error } = await admin.from("app_settings").update({ settings: { ...current, notification_templates: templates }, updated_at: new Date().toISOString() }).eq("org_id", me.orgId);
  if (error) return { ok: false, error: error.message };
  await audit(me.orgId, me.id, "settings.notification_template", { type });
  revalidatePath("/admin/settings/notifications");
  return { ok: true };
}

export async function exportClubData(): Promise<{ ok: true; json: string } | { ok: false; error: string }> {
  const me = await getAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  const admin = createAdminClient();
  const [org, settings, counts] = await Promise.all([
    admin.from("organizations").select("*").eq("id", me.orgId).maybeSingle(),
    admin.from("app_settings").select("*").eq("org_id", me.orgId).maybeSingle(),
    (async () => {
      const tables = ["families", "athletes", "registrations", "invoices", "payments", "consent_acceptances", "documents", "training_bookings", "notifications"] as const;
      const out: Record<string, number> = {};
      for (const t of tables) { const { count } = await admin.from(t).select("id", { count: "exact", head: true }).eq("org_id", me.orgId); out[t] = count ?? 0; }
      return out;
    })(),
  ]);
  const payload = { exportedAt: new Date().toISOString(), organization: org.data, settings: settings.data, recordCounts: counts };
  return { ok: true, json: JSON.stringify(payload, null, 2) };
}
