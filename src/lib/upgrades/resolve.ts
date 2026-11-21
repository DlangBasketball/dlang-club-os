import { FEATURE_CATALOG, getFeature, isCoreFeature, type AddonPrice } from "./catalog";

/**
 * Pure entitlement resolution (no I/O; shared by server code and tests).
 * Mirrors public.org_feature_enabled() in migration 20250420102100.
 *
 *   enabled = core
 *          OR ( NOT blocked AND (
 *                complimentary grant (per feature, founding, or complimentary_all)
 *             OR live subscription AND (plan includes it OR active add-on OR running trial) ))
 *          AND every required feature is enabled (recursively)
 *
 * A suspended club gets nothing but core. Downgrades never delete data: a
 * feature that resolves to "off" is only hidden / read-only.
 */

export type GrantKind = "addon" | "trial" | "complimentary" | "founding" | "complimentary_all" | "block";
export type GrantStatus = "pending" | "active" | "canceling" | "canceled" | "expired";

export type GrantRow = {
  id?: string;
  feature_key: string;
  kind: GrantKind | string;
  status: GrantStatus | string;
  starts_at: string | null;
  ends_at: string | null;
  stripe_subscription_item_id?: string | null;
};

export type PlanLite = {
  code: string;
  name?: string;
  sort_order: number;
  is_public?: boolean;
  is_active?: boolean;
  is_custom?: boolean;
  features: Record<string, boolean>;
};

export type FeatureState =
  | "core" // always on
  | "included" // in the club's plan
  | "addon" // paid add-on, active
  | "addon_canceling" // paid add-on, ends at period end
  | "trial" // free trial running
  | "complimentary" // granted by the platform (incl. complimentary_all, founding)
  | "pending" // purchase requested, waiting for the platform team
  | "blocked" // switched off by the platform
  | "requires" // would be on, but a required feature is off
  | "available" // can be bought as an add-on
  | "upgrade" // only in a higher plan
  | "unavailable"; // not sold to this club (no price in its currency, no plan)

export type FeatureAccess = {
  key: string;
  enabled: boolean;
  state: FeatureState;
  /** Trial end / add-on end date (ISO), when relevant. */
  endsAt: string | null;
  /** Missing required features (state "requires" or buy prerequisites). */
  missing: string[];
  /** Cheapest higher public plan that includes it (state "upgrade"). */
  upgradePlan: string | null;
  /** Monthly add-on price in the club's currency, if sold. */
  price: number | null;
  /** A trial was already used for this feature (one trial per feature). */
  trialUsed: boolean;
};

export type ResolveInput = {
  planCode: string | null;
  plans: readonly PlanLite[];
  /** Subscription live (trialing until trial end, active, past_due). */
  live: boolean;
  suspended: boolean;
  /** Legacy per-tenant overrides (subscriptions.feature_overrides): true grants, false blocks. */
  overrides?: Record<string, boolean> | null;
  grants: readonly GrantRow[];
  /** Club currency for add-on prices. */
  currency: string;
  /** feature_key -> price per currency (runtime prices); falls back to the catalog. */
  prices?: Record<string, Partial<Record<string, number | null>>> | null;
  /** Legacy AI add-on (public.ai_assistant_addons) entitlement source, if any. */
  legacyAi?: "paid_addon" | "complimentary" | null;
  now?: Date;
};

export type AccessMap = Record<string, FeatureAccess>;

function inWindow(g: GrantRow, t: number): boolean {
  if (g.starts_at && new Date(g.starts_at).getTime() > t) return false;
  if (g.ends_at && new Date(g.ends_at).getTime() <= t) return false;
  return true;
}

/** Grants that currently apply (status + time window). */
export function activeGrants(grants: readonly GrantRow[], now: Date = new Date()): GrantRow[] {
  const t = now.getTime();
  return grants.filter((g) => (g.status === "active" || g.status === "canceling") && inWindow(g, t));
}

export function addonPriceFor(
  key: string,
  currency: string,
  prices?: ResolveInput["prices"],
): number | null {
  const runtime = prices?.[key];
  if (runtime && Object.prototype.hasOwnProperty.call(runtime, currency)) {
    const v = runtime[currency];
    return typeof v === "number" && v >= 0 ? v : null;
  }
  if (prices && Object.keys(prices).length > 0 && runtime === undefined) return null;
  const cat = getFeature(key)?.addon;
  const v = cat ? cat[currency as keyof AddonPrice] : null;
  return typeof v === "number" ? v : null;
}

function cheapestHigherPlan(key: string, input: ResolveInput): string | null {
  const current = input.plans.find((pl) => pl.code === input.planCode);
  const rank = current?.sort_order ?? -Infinity;
  const candidates = input.plans
    .filter((pl) => pl.features?.[key] === true && pl.is_active !== false && pl.is_public !== false && pl.sort_order > rank)
    .sort((a, b) => a.sort_order - b.sort_order);
  return candidates[0]?.code ?? null;
}

export function resolveFeatures(input: ResolveInput): AccessMap {
  const now = input.now ?? new Date();
  const plan = input.plans.find((pl) => pl.code === input.planCode) ?? null;
  const planFeatures = plan?.features ?? {};
  const overrides = input.overrides ?? {};
  const live = input.live && !input.suspended;
  const current = activeGrants(input.grants, now);
  const compAll = current.some((g) => g.kind === "complimentary_all");
  const out: AccessMap = {};

  for (const f of FEATURE_CATALOG) {
    const key = f.key;
    const mine = current.filter((g) => g.feature_key === key);
    const all = input.grants.filter((g) => g.feature_key === key);
    const trialUsed = all.some((g) => g.kind === "trial");
    const price = f.core ? null : addonPriceFor(key, input.currency, input.prices);
    const base: FeatureAccess = { key, enabled: false, state: "unavailable", endsAt: null, missing: [], upgradePlan: null, price, trialUsed };

    if (f.core) {
      out[key] = { ...base, enabled: true, state: "core" };
      continue;
    }
    if (input.suspended) {
      out[key] = base;
      continue;
    }
    const blocked = mine.some((g) => g.kind === "block") || overrides[key] === false;
    if (blocked) {
      out[key] = { ...base, state: "blocked" };
      continue;
    }
    const comp = mine.find((g) => g.kind === "complimentary" || g.kind === "founding");
    if (comp || compAll || (key === "ai_assistant" && input.legacyAi === "complimentary")) {
      out[key] = { ...base, enabled: true, state: "complimentary", endsAt: comp?.ends_at ?? null };
      continue;
    }
    if (live && (planFeatures[key] === true || overrides[key] === true)) {
      out[key] = { ...base, enabled: true, state: "included" };
      continue;
    }
    const addon = mine.find((g) => g.kind === "addon");
    if (live && addon) {
      const canceling = addon.status === "canceling";
      out[key] = { ...base, enabled: true, state: canceling ? "addon_canceling" : "addon", endsAt: addon.ends_at };
      continue;
    }
    if (live && key === "ai_assistant" && input.legacyAi === "paid_addon") {
      out[key] = { ...base, enabled: true, state: "addon" };
      continue;
    }
    const trial = mine.find((g) => g.kind === "trial");
    if (live && trial) {
      out[key] = { ...base, enabled: true, state: "trial", endsAt: trial.ends_at };
      continue;
    }
    const pending = all.some((g) => g.kind === "addon" && g.status === "pending");
    if (pending) {
      out[key] = { ...base, state: "pending" };
      continue;
    }
    if (price !== null) {
      out[key] = { ...base, state: "available", upgradePlan: cheapestHigherPlan(key, input) };
      continue;
    }
    const up = cheapestHigherPlan(key, input);
    out[key] = { ...base, state: up ? "upgrade" : "unavailable", upgradePlan: up };
  }

  // Dependencies: switch off (state "requires") anything whose prerequisite is
  // off; repeat until stable so chains resolve (journey -> development).
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of FEATURE_CATALOG) {
      const a = out[f.key];
      const missing = (f.requires ?? []).filter((r) => !out[r]?.enabled);
      a.missing = missing;
      if (a.enabled && missing.length > 0) {
        out[f.key] = { ...a, enabled: false, state: "requires" };
        changed = true;
      }
    }
  }
  return out;
}

export function isEnabled(map: AccessMap, key: string): boolean {
  if (isCoreFeature(key)) return true;
  return map[key]?.enabled === true;
}

/** States in which an admin may switch the add-on on (buy). */
export function canPurchase(a: FeatureAccess | undefined): boolean {
  return Boolean(a && a.price !== null && a.state === "available");
}

/** States in which an admin may start a free trial. */
export function canStartTrial(a: FeatureAccess | undefined): boolean {
  return Boolean(a && !a.trialUsed && (a.state === "available" || a.state === "upgrade"));
}

// ---------------------------------------------------------------------------
// Plan changes
// ---------------------------------------------------------------------------

export type DowngradePreview = {
  /** Features on today that would lock on the target plan. */
  lose: string[];
  /** Features off today that the target plan includes. */
  gain: string[];
  /** Paid add-ons that become redundant (now included) and can be removed. */
  redundantAddons: string[];
};

/**
 * What changes when moving from the current state to `targetPlan`:
 * grants (complimentary, add-ons, trials) and blocks are kept; only the plan
 * part changes. Used for the confirmation dialog before a plan change.
 */
export function previewPlanChange(input: ResolveInput, targetPlan: string): DowngradePreview {
  const before = resolveFeatures(input);
  const after = resolveFeatures({ ...input, planCode: targetPlan });
  const lose: string[] = [];
  const gain: string[] = [];
  const redundantAddons: string[] = [];
  for (const f of FEATURE_CATALOG) {
    const b = before[f.key];
    const a = after[f.key];
    if (b.enabled && !a.enabled) lose.push(f.key);
    if (!b.enabled && a.enabled) gain.push(f.key);
    if ((b.state === "addon" || b.state === "addon_canceling") && a.state === "included") redundantAddons.push(f.key);
  }
  return { lose, gain, redundantAddons };
}

/** "upgrade" when the target plan sorts above the current one, else "downgrade". */
export function planChangeDirection(
  plans: readonly PlanLite[],
  from: string | null,
  to: string,
): "upgrade" | "downgrade" | "same" {
  if (from === to) return "same";
  const a = plans.find((pl) => pl.code === from)?.sort_order ?? -Infinity;
  const b = plans.find((pl) => pl.code === to)?.sort_order ?? -Infinity;
  return b > a ? "upgrade" : "downgrade";
}

/**
 * Estimated proration for switching an add-on on today (or changing the plan
 * price) mid-period: the unused share of the period at the new monthly price.
 * Stripe computes the exact amount; this is the estimate shown beforehand.
 */
export function estimateProration(monthly: number, periodEnd: string | null, now: Date = new Date(), periodDays = 30): number {
  if (!periodEnd || !Number.isFinite(monthly) || monthly <= 0) return 0;
  const left = (new Date(periodEnd).getTime() - now.getTime()) / 86_400_000;
  if (left <= 0) return 0;
  const share = Math.min(1, left / periodDays);
  return Math.round(monthly * share * 100) / 100;
}

/**
 * Monthly price formatted for the club's currency and locale.
 * Example: formatAddonPrice(29, "CHF", "de-CH") -> "CHF 29"
 */
export function formatAddonPrice(amount: number, currency: string, locale: string): string {
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })
    .format(amount)
    .replace(/ | /g, " ");
}

/** Nav hrefs whose features are ALL off (an href shared by modules locks only when every one is off). */
export function lockedHrefs(
  routeMap: Map<string, string[]>,
  map: AccessMap,
): string[] {
  const out: string[] = [];
  for (const [href, keys] of routeMap) {
    if (keys.length > 0 && keys.every((k) => !isEnabled(map, k))) out.push(href);
  }
  return out;
}
