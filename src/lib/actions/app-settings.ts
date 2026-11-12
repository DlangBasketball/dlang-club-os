"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTranslations } from "@/lib/i18n/server";
import { invalidateTenantCache, tenantMatchesOrg } from "@/lib/tenant/server";
import { APP_NAME_MAX, appNameError, appNameFromBranding, sanitizeAppName } from "@/lib/tenant/app-name";
import { getAssistantState } from "@/lib/ai/settings";

export type AppSettingsResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Club admin settings for the white-label app name and the AI assistant
 * opt-in. The org is ALWAYS the signed-in admin's own org (never taken from
 * the client), and the request host must belong to that org.
 */
async function requireOwnAdmin(): Promise<{ id: string; orgId: string } | { error: string }> {
  const t = await getTranslations();
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return { error: t("appSettings.errors.forbidden") };
  if (!(await tenantMatchesOrg(me.orgId))) return { error: t("appSettings.errors.wrongOrg") };
  return { id: me.id, orgId: me.orgId };
}

/** Set (or clear, with "") the club's app display name. */
export async function saveAppDisplayName(input: string): Promise<AppSettingsResult> {
  const t = await getTranslations();
  const me = await requireOwnAdmin();
  if ("error" in me) return { ok: false, error: me.error };

  const raw = typeof input === "string" ? input : "";
  const problem = appNameError(raw);
  if (problem === "tooLong") return { ok: false, error: t("appSettings.appName.errorTooLong", { max: APP_NAME_MAX }) };
  if (problem === "invalidChars") return { ok: false, error: t("appSettings.appName.errorInvalidChars") };
  const next = sanitizeAppName(raw); // null = fall back to the organization name

  const admin = createAdminClient();
  const { data: org, error: readError } = await admin.from("organizations").select("branding").eq("id", me.orgId).maybeSingle();
  if (readError || !org) return { ok: false, error: t("appSettings.errors.generic") };
  const branding = (org.branding && typeof org.branding === "object" && !Array.isArray(org.branding) ? org.branding : {}) as Record<string, unknown>;
  const previous = appNameFromBranding(branding);
  if (previous === next) return { ok: true, message: t("appSettings.appName.saved") };

  const { error } = await admin
    .from("organizations")
    .update({ branding: { ...branding, app_name: next } })
    .eq("id", me.orgId);
  if (error) return { ok: false, error: t("appSettings.errors.generic") };

  await admin.from("audit_logs").insert({
    org_id: me.orgId,
    actor_id: me.id,
    action: "settings.app_name",
    target_table: "organizations",
    target_id: me.orgId,
    old_data: { app_name: previous },
    new_data: { app_name: next },
  });

  invalidateTenantCache();
  revalidatePath("/", "layout");
  return { ok: true, message: t("appSettings.appName.saved") };
}

/**
 * Switch the AI assistant on/off for the admin's own club. Goes through the
 * RLS-scoped session client and the admin-only RPC, so the database checks
 * the role and plan again and the audit trigger records the acting user.
 */
export async function setAiAssistantEnabled(enabled: boolean): Promise<AppSettingsResult> {
  const t = await getTranslations();
  const me = await requireOwnAdmin();
  if ("error" in me) return { ok: false, error: me.error };
  if (typeof enabled !== "boolean") return { ok: false, error: t("appSettings.errors.generic") };

  if (enabled) {
    const state = await getAssistantState(me.orgId);
    if (!state.configured) return { ok: false, error: t("appSettings.ai.unconfigured") };
    if (!state.entitled) return { ok: false, error: t("appSettings.errors.notInPlan") };
  }

  const sb = await createClient();
  const { error } = await sb.rpc("set_org_ai_assistant", { p_enabled: enabled });
  if (error) {
    if (/AI_ASSISTANT_NOT_IN_PLAN/.test(error.message)) return { ok: false, error: t("appSettings.errors.notInPlan") };
    if (/FORBIDDEN/.test(error.message)) return { ok: false, error: t("appSettings.errors.forbidden") };
    return { ok: false, error: t("appSettings.errors.generic") };
  }

  revalidatePath("/admin", "layout");
  return { ok: true, message: enabled ? t("appSettings.ai.enabled") : t("appSettings.ai.disabled") };
}
