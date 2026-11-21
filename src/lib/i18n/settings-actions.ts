"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateTenantCache, tenantMatchesOrg } from "@/lib/tenant/server";
import { isLocale } from "./languages";
import { getTranslations } from "./server";

export type LanguageSettingsResult = { ok: true } | { ok: false; error: string };

const Schema = z
  .object({
    languages: z.array(z.string().refine(isLocale)).min(1).max(20),
    defaultLocale: z.string().refine(isLocale),
    regions: z.record(z.string().refine(isLocale), z.string().regex(/^([A-Z]{2}|[0-9]{3})$/)),
  })
  .refine((v) => v.languages.includes(v.defaultLocale), { path: ["defaultLocale"] });

export type LanguageSettingsInput = z.input<typeof Schema>;

/**
 * Save the club's languages (admin only, own org resolved server-side):
 * enabled languages + default on the organisation and its app settings, and
 * the per-language formatting region in app_settings.settings.localization.
 */
export async function saveLanguageSettings(input: LanguageSettingsInput): Promise<LanguageSettingsResult> {
  const t = await getTranslations();
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return { ok: false, error: t("languageSettings.errors.adminOnly") };
  if (!(await tenantMatchesOrg(me.orgId))) return { ok: false, error: t("appSettings.errors.wrongOrg") };

  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    const empty = Array.isArray(input?.languages) && input.languages.length === 0;
    return { ok: false, error: t(empty ? "languageSettings.errors.noLanguage" : "languageSettings.errors.invalid") };
  }
  const languages = Array.from(new Set(parsed.data.languages));
  const { defaultLocale } = parsed.data;
  const regions = Object.fromEntries(Object.entries(parsed.data.regions).filter(([k]) => (languages as string[]).includes(k)));

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ default_locale: defaultLocale, supported_locales: languages })
    .eq("id", me.orgId);
  if (error) return { ok: false, error: t("languageSettings.errors.invalid") };

  const { data: row } = await admin.from("app_settings").select("settings").eq("org_id", me.orgId).maybeSingle();
  const settings = ((row?.settings ?? {}) as Record<string, unknown>) || {};
  const localization = (settings.localization && typeof settings.localization === "object" ? settings.localization : {}) as Record<string, unknown>;
  const { error: e2 } = await admin
    .from("app_settings")
    .update({
      default_locale: defaultLocale,
      enabled_locales: languages,
      settings: { ...settings, languages, localization: { ...localization, regions } },
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", me.orgId);
  if (e2) return { ok: false, error: t("languageSettings.errors.invalid") };

  await admin.from("audit_logs").insert({
    org_id: me.orgId,
    actor_id: me.id,
    action: "settings.languages",
    target_table: "app_settings",
    target_id: me.orgId,
    new_data: { languages, default_locale: defaultLocale, regions },
  });

  invalidateTenantCache();
  revalidatePath("/", "layout");
  return { ok: true };
}
