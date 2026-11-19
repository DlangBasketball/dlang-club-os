/**
 * Platform application fee (Stripe Connect) — pure. Mirrors
 * public.resolve_application_fee(); the DB function is authoritative at
 * charge time, this is for previews and tests.
 */

export type FeeRule = { bps: number; fixedMinor?: number };

/** Defaults mirror the seed rows in public.platform_fee_schedules. */
export const DEFAULT_PLAN_FEES: Record<string, FeeRule> = {
  founding: { bps: 0 },
  starter: { bps: 150 },
  club: { bps: 100 },
  pro: { bps: 50 },
  academy: { bps: 50 },
  federation: { bps: 50 },
  default: { bps: 100 },
};

/** floor(amount * bps / 10000) + fixed, never more than the amount itself. */
export function applicationFeeMinor(amountMinor: number, rule: FeeRule): number {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return 0;
  if (!Number.isInteger(rule.bps) || rule.bps < 0 || rule.bps > 2000) throw new Error(`Invalid fee bps: ${rule.bps}`);
  const fee = Math.floor((amountMinor * rule.bps) / 10_000) + (rule.fixedMinor ?? 0);
  return Math.min(amountMinor, fee);
}

export function feeRuleForPlan(planCode: string | null | undefined, overrideBps?: number | null): FeeRule {
  const base = DEFAULT_PLAN_FEES[planCode ?? "default"] ?? DEFAULT_PLAN_FEES.default;
  return overrideBps == null ? base : { ...base, bps: overrideBps };
}
