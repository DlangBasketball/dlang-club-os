import type { FeatureKey } from "./catalog";
import type { PlanRow, SubscriptionRow, SubscriptionStatus } from "./types";

/**
 * Pure entitlement logic (no I/O) — shared by server helpers and tests.
 * Mirrors public.org_subscription_is_live / org_has_feature in SQL.
 */

export type LimitResource = "athletes" | "staff";

export type Entitlements = {
  orgId: string;
  planCode: string | null;
  planName: string | null;
  status: SubscriptionStatus | null;
  suspended: boolean;
  /** Access is granted (trial running, active, or in dunning grace). */
  live: boolean;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  features: Record<string, boolean>;
  limits: Record<LimitResource, number | null>;
};

const LIVE_STATUSES: SubscriptionStatus[] = ["active", "past_due"];

export function isSubscriptionLive(
  sub: Pick<SubscriptionRow, "status" | "trial_ends_at"> | null,
  suspended: boolean,
  now: Date = new Date(),
): boolean {
  if (!sub || suspended) return false;
  if (LIVE_STATUSES.includes(sub.status)) return true;
  if (sub.status === "trialing") {
    return !sub.trial_ends_at || new Date(sub.trial_ends_at).getTime() > now.getTime();
  }
  return false;
}

export function resolveEntitlements(
  orgId: string,
  sub: SubscriptionRow | null,
  plan: PlanRow | null,
  suspended: boolean,
  now: Date = new Date(),
): Entitlements {
  const live = isSubscriptionLive(sub, suspended, now);
  const base = (plan?.features ?? {}) as Record<string, boolean>;
  const overrides = (sub?.feature_overrides ?? {}) as Record<string, boolean>;
  const merged: Record<string, boolean> = {};
  for (const [k, v] of Object.entries({ ...base, ...overrides })) merged[k] = live && v === true;

  const lo = (sub?.limit_overrides ?? {}) as Record<string, number | null>;
  const pick = (k: LimitResource, planVal: number | null | undefined) =>
    Object.prototype.hasOwnProperty.call(lo, k) ? (lo[k] ?? null) : (planVal ?? null);

  const trialEndsAt = sub?.status === "trialing" ? sub.trial_ends_at : null;
  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - now.getTime()) / 86_400_000))
    : null;

  return {
    orgId,
    planCode: sub?.plan_code ?? null,
    planName: plan?.name ?? null,
    status: sub?.status ?? null,
    suspended,
    live,
    trialEndsAt,
    trialDaysLeft,
    features: merged,
    limits: {
      athletes: plan || sub ? pick("athletes", plan?.max_athletes) : 0,
      staff: plan || sub ? pick("staff", plan?.max_staff) : 0,
    },
  };
}

export function entitlementAllows(ent: Entitlements, feature: FeatureKey | string): boolean {
  return ent.live && ent.features[feature] === true;
}

export type LimitCheck = {
  allowed: boolean;
  used: number;
  limit: number | null;
  remaining: number | null;
};

export function evaluateLimit(ent: Entitlements, resource: LimitResource, used: number, adding = 1): LimitCheck {
  const limit = ent.limits[resource];
  if (!ent.live) return { allowed: false, used, limit, remaining: limit === null ? null : Math.max(0, limit - used) };
  if (limit === null) return { allowed: true, used, limit, remaining: null };
  return { allowed: used + Math.max(0, adding) <= limit, used, limit, remaining: Math.max(0, limit - used) };
}
