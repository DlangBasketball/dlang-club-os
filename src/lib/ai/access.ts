import type { AppRole } from "@/lib/auth/roles";

/**
 * AI assistant access rules (pure; no I/O, shared by server code and tests).
 *
 * The assistant is usable only when ALL of these hold:
 *   1. configured — the platform has its API key AND model in the env;
 *   2. entitled   — the club holds the AI assistant ADD-ON (it is not part of
 *                   any plan price): an active scope-'org' row in
 *                   public.ai_assistant_addons, either 'complimentary' or a
 *                   'paid_addon' on a live subscription. Mirrors
 *                   public.org_ai_assistant_entitled();
 *   3. enabled    — an admin of the club opted in (app_settings.settings.
 *                   ai_assistant_enabled === true; unset means OFF);
 *   4. role       — the user is club staff allowed to use it (admin, finance).
 */

/** Staff roles that may use the assistant once the club enabled it. */
export const AI_ASSISTANT_ROLES: readonly AppRole[] = ["admin", "finance"] as const;

export type AssistantDenyReason = "unconfigured" | "not_entitled" | "disabled" | "role";

export type AssistantState = {
  configured: boolean;
  entitled: boolean;
  enabled: boolean;
  /** How the club is entitled (null when it is not). Display only. */
  addonSource?: AddonSource | null;
};

/** Where an add-on entitlement comes from (public.ai_assistant_addons.source). */
export type AddonSource = "paid_addon" | "complimentary";
export type AddonStatus = "active" | "paused" | "canceled";
/** 'org' = the club's staff assistant. 'family' is reserved (future parent add-on) and grants nothing yet. */
export type AddonScope = "org" | "family";

export type AddonRow = {
  scope: AddonScope | string;
  source: AddonSource | string;
  status: AddonStatus | string;
  starts_at: string | null;
  ends_at: string | null;
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
 * Add-on entitlement. Mirrors public.org_ai_assistant_entitled():
 * club not suspended AND an active scope-'org' add-on whose period covers
 * `now` AND (complimentary OR the club's platform subscription is live).
 * Plan features are deliberately ignored: no plan includes the assistant.
 * Returns the source of the first matching row, or null.
 */
export function addonEntitlement(
  rows: readonly AddonRow[] | null | undefined,
  sub: { live: boolean; suspended: boolean },
  now: Date = new Date(),
): AddonSource | null {
  if (sub.suspended || !rows) return null;
  const t = now.getTime();
  for (const r of rows) {
    if (r.scope !== "org" || r.status !== "active") continue;
    if (r.source !== "complimentary" && r.source !== "paid_addon") continue;
    if (r.starts_at && new Date(r.starts_at).getTime() > t) continue;
    if (r.ends_at && new Date(r.ends_at).getTime() <= t) continue;
    if (r.source === "paid_addon" && !sub.live) continue;
    return r.source;
  }
  return null;
}

export function addonEntitlesAssistant(
  rows: readonly AddonRow[] | null | undefined,
  sub: { live: boolean; suspended: boolean },
  now: Date = new Date(),
): boolean {
  return addonEntitlement(rows, sub, now) !== null;
}

export function evaluateAssistantAccess(state: AssistantState, roles: readonly AppRole[]): AssistantAccess {
  if (!state.configured) return { allowed: false, reason: "unconfigured" };
  if (!state.entitled) return { allowed: false, reason: "not_entitled" };
  if (!state.enabled) return { allowed: false, reason: "disabled" };
  if (!roles.some((r) => AI_ASSISTANT_ROLES.includes(r))) return { allowed: false, reason: "role" };
  return { allowed: true, reason: null };
}

/** Effective club-level state (what legal pages / sub-processor lists use). */
export function assistantActiveForClub(state: AssistantState): boolean {
  return state.configured && state.entitled && state.enabled;
}
