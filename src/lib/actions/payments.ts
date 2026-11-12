"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { isKnownMethod } from "@/lib/payments/methods";
import type { Json } from "@/types/database";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Admin: save regional payment settings (enabled methods, SEPA / ACH / EPC
 * toggles, BIC, tax defaults). Goes through public.update_payment_settings,
 * which strips platform-controlled keys (Stripe account, plan, fee).
 */
export async function savePaymentSettings(form: FormData): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!me?.roles.includes("admin")) return { ok: false, error: "Only club admins can change payment settings" };

  const methods = form.getAll("enabled_methods").map(String).filter(isKnownMethod);
  if (!methods.length) return { ok: false, error: "Enable at least one payment method" };
  const rate = Number(form.get("tax_rate") ?? 0);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return { ok: false, error: "Tax rate must be between 0 and 100" };
  const bic = String(form.get("bic") ?? "").replace(/\s/g, "").toUpperCase();
  if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) return { ok: false, error: "BIC must be 8 or 11 characters" };

  const patch = {
    enabled_methods: methods,
    sepa_enabled: form.get("sepa_enabled") === "on",
    us_ach_enabled: form.get("us_ach_enabled") === "on",
    epc_qr_enabled: form.get("epc_qr_enabled") === "on",
    ...(bic ? { bic } : {}),
    tax: {
      rate,
      inclusive: form.get("tax_inclusive") === "on",
      label: String(form.get("tax_label") ?? "").trim() || undefined,
      registration_number: String(form.get("tax_registration") ?? "").trim() || undefined,
    },
  };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_payment_settings", { p_patch: patch as unknown as Json });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/settings/payments");
  return { ok: true };
}

/** Form-action wrapper: redirects back with ?saved=1 or ?error=… */
export async function savePaymentSettingsForm(form: FormData): Promise<void> {
  const res = await savePaymentSettings(form);
  redirect(res.ok ? "/admin/settings/payments?saved=1" : `/admin/settings/payments?error=${encodeURIComponent(res.error)}`);
}
