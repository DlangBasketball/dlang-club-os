import "server-only";
import { cache } from "react";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEntitlements } from "@/lib/platform/features";
import type { SessionUser } from "@/lib/auth/get-user";
import {
  clubOptedIn,
  evaluateAssistantAccess,
  isAssistantConfigured,
  planEntitlesAssistant,
  type AssistantAccess,
  type AssistantState,
} from "./access";

/** Platform-level switch: API key and model must both be set. */
export function assistantConfigured(): boolean {
  return isAssistantConfigured(env.anthropicApiKey(), env.anthropicModel());
}

/**
 * The club's assistant state, resolved server-side for ONE org (the caller's
 * own org id, never a client-supplied one). Service-role reads, filtered by
 * org_id. Memoised per request.
 */
export const getAssistantState = cache(async (orgId: string): Promise<AssistantState> => {
  const configured = assistantConfigured();
  const admin = createAdminClient();
  const [ent, { data: org }, { data: settings }] = await Promise.all([
    getEntitlements(orgId),
    admin.from("organizations").select("plan").eq("id", orgId).maybeSingle(),
    admin.from("app_settings").select("settings").eq("org_id", orgId).maybeSingle(),
  ]);
  return {
    configured,
    entitled: planEntitlesAssistant(ent, (org as { plan?: string | null } | null)?.plan ?? null),
    enabled: clubOptedIn(settings?.settings),
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
