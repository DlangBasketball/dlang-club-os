import type { AppRole } from "@/lib/auth/roles";

/**
 * AI assistant access rules (pure; no I/O, shared by server code and tests).
 *
 * The assistant is usable only when ALL of these hold:
 *   1. configured — the platform has its API key AND model in the env;
 *   2. entitled   — the club's plan includes "ai_assistant" (or it is a
 *                   founding club), mirrored from public.org_ai_assistant_entitled();
 *   3. enabled    — an admin of the club opted in (app_settings.settings.
 *                   ai_assistant_enabled === true; unset means OFF);
 *   4. role       — the user is club staff allowed to use it (admin, finance).
 */

/** Staff roles that may use the assistant once the club enabled it. */
export const AI_ASSISTANT_ROLES: readonly AppRole[] = ["admin", "finance"] as const;

export type AssistantDenyReason = "unconfigured" | "not_in_plan" | "disabled" | "role";

export type AssistantState = {
  configured: boolean;
  entitled: boolean;
  enabled: boolean;
};

export type AssistantAccess = { allowed: true; reason: null } | { allowed: false; reason: AssistantDenyReason };

/** Platform switch: both the key and the model must be set (non-blank). */
export function isAssistantConfigured(apiKey: string | undefined | null, model: string | undefined | null): boolean {
  return Boolean(apiKey && apiKey.trim() && model && model.trim());
}

/** The club's opt-in flag. Anything but an explicit `true` is OFF. */
export function clubOptedIn(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false;
  return (settings as Record<string, unknown>).ai_assistant_enabled === true;
}

/**
 * Plan entitlement. Mirrors public.org_ai_assistant_entitled():
 * not suspended AND (live subscription granting the feature OR founding club
 * whose subscription, if it has one, is live).
 */
export function planEntitlesAssistant(
  ent: { planCode: string | null; live: boolean; suspended: boolean; features: Record<string, boolean> },
  orgPlan: string | null | undefined,
): boolean {
  if (ent.suspended) return false;
  if (ent.live && ent.features.ai_assistant === true) return true;
  return orgPlan === "founding" && (ent.planCode === null || ent.live);
}

export function evaluateAssistantAccess(state: AssistantState, roles: readonly AppRole[]): AssistantAccess {
  if (!state.configured) return { allowed: false, reason: "unconfigured" };
  if (!state.entitled) return { allowed: false, reason: "not_in_plan" };
  if (!state.enabled) return { allowed: false, reason: "disabled" };
  if (!roles.some((r) => AI_ASSISTANT_ROLES.includes(r))) return { allowed: false, reason: "role" };
  return { allowed: true, reason: null };
}

/** Effective club-level state (what legal pages / sub-processor lists use). */
export function assistantActiveForClub(state: AssistantState): boolean {
  return state.configured && state.entitled && state.enabled;
}
