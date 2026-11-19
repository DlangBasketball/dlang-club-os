import "server-only";
import { cache } from "react";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEntitlements } from "@/lib/platform/features";
import type { SessionUser } from "@/lib/auth/get-user";
import {
  addonEntitlement,
  clubOptedIn,
  evaluateAssistantAccess,
  isAssistantConfigured,
  type AddonRow,
  type AddonSource,
  type AssistantAccess,
  type AssistantState,
} from "./access";

/** Platform-level switch: API key and model must both be set. */
export function assistantConfigured(): boolean {
  return isAssistantConfigured(env.anthropicApiKey(), env.anthropicModel());
}

/**
 * The club's AI assistant add-on entitlement (complimentary or paid), or null.
 * Service-role read filtered by the given org id, which callers resolve
 * server-side (session user's org, or the org that owns a public slug).
 * Memoised per request.
 */
export const getAssistantAddonSource = cache(async (orgId: string): Promise<AddonSource | null> => {
  const admin = createAdminClient();
  const [ent, { data: rows }] = await Promise.all([
    getEntitlements(orgId),
    admin
      .from("ai_assistant_addons")
      .select("scope,source,status,starts_at,ends_at")
      .eq("org_id", orgId)
      .eq("scope", "org"),
  ]);
  return addonEntitlement((rows ?? []) as AddonRow[], { live: ent.live, suspended: ent.suspended });
});

/**
 * The club's assistant state, resolved server-side for ONE org (the caller's
 * own org id, never a client-supplied one). Service-role reads, filtered by
 * org_id. Memoised per request.
 */
export const getAssistantState = cache(async (orgId: string): Promise<AssistantState> => {
  const configured = assistantConfigured();
  const admin = createAdminClient();
  const [addonSource, { data: settings }] = await Promise.all([
    getAssistantAddonSource(orgId),
    admin.from("app_settings").select("settings").eq("org_id", orgId).maybeSingle(),
  ]);
  return {
    configured,
    entitled: addonSource !== null,
    enabled: clubOptedIn(settings?.settings),
    addonSource,
  };
});

/** Can this signed-in user use the assistant right now? */
export async function getAssistantAccess(user: Pick<SessionUser, "orgId" | "roles"> | null): Promise<AssistantAccess & { state: AssistantState | null }> {
  if (!user?.orgId) {
    return { allowed: false, reason: "disabled", state: null };
  }
  const state = await getAssistantState(user.orgId);
  return { ...evaluateAssistantAccess(state, user.roles), state };
}
