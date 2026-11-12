/**
 * Price + discount computation — pure, framework-free, shared by every module
 * that sells something (camps now, training packages / services later).
 *
 * Money is computed in integer minor units (src/lib/payments/currency) so
 * percent discounts round once, per line, half away from zero, in the
 * currency's own precision (CHF 2 decimals, JPY 0, KWD 3).
 *
 * Rules (mirrored by the checks in public.register_camp):
 *   - a discount applies when it is active, inside valid_from / valid_until,
 *     in scope for the subject (all | camps | training | program | service),
 *     and its rule matches:
 *       promo_code  the entered code equals the discount code (case-insensitive)
 *                   and the total / per-family usage limits are not reached
 *       sibling     the child is the nth child (siblingPosition >= sibling_min_position)
 *       early_bird  now <= valid_until and (if set) now <= start - N days
 *       manual      only when an admin picks it (manualDiscountIds)
 *   - fixed amounts only apply in their own currency
 *   - every amount is computed on the LIST price (no compounding)
 *   - stackable discounts add up; a non-stackable one is used alone, and only
 *     when it is worth more than all stackable ones together
 *   - the total discount never exceeds the list price
 */
import { fromMinorUnits, normalizeCurrency, toMinorUnits } from "@/lib/payments/currency";

export const DISCOUNT_KINDS = ["percent", "fixed_amount"] as const;
export const DISCOUNT_RULES = ["promo_code", "sibling", "early_bird", "manual"] as const;
export const DISCOUNT_SCOPES = ["all", "camps", "training", "program", "service"] as const;

export type DiscountKind = (typeof DISCOUNT_KINDS)[number];
export type DiscountRule = (typeof DISCOUNT_RULES)[number];
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number];

export type DiscountDef = {
  id: string;
  name: string;
  kind: DiscountKind;
  value: number;
  currency: string | null;
  scope: DiscountScope;
  scopeProgramId?: string | null;
  scopeServiceId?: string | null;
  rule: DiscountRule;
  code?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  siblingMinPosition?: number | null;
  earlyBirdDaysBefore?: number | null;
  maxRedemptions?: number | null;
  maxRedemptionsPerFamily?: number | null;
  stackable?: boolean;
  active: boolean;
  /** Non-voided uses so far (all families). */
  redemptions?: number;
  /** Non-voided uses so far by the family being priced. */
  familyRedemptions?: number;
};

export type PricingSubject = {
  /** What is sold: "camp" (programme of kind camp), "training" (service / package), "program" (other programmes). */
  kind: "camp" | "training" | "program";
  programId?: string | null;
  serviceId?: string | null;
  currency: string;
  listAmount: number;
  /** First day of what is sold (YYYY-MM-DD), for early-bird "N days before". */
  startsOn?: string | null;
  /** 1-based position of this child among the family's children (sibling rule). */
  siblingPosition?: number;
};

export type PricingContext = {
  now: Date;
  promoCode?: string | null;
  /** Manual discounts an admin chose for this subject. */
  manualDiscountIds?: string[];
  /** Promo uses already taken by earlier items of the same batch: discountId -> count. */
  batchUses?: Record<string, number>;
};

export type DiscountRejection =
  | "INACTIVE" | "NOT_YET_VALID" | "EXPIRED" | "OUT_OF_SCOPE" | "CURRENCY_MISMATCH"
  | "CODE_MISMATCH" | "LIMIT_REACHED" | "FAMILY_LIMIT_REACHED" | "NOT_A_SIBLING" | "NOT_SELECTED" | "NOT_COMBINABLE";

export type AppliedDiscountLine = {
  discountId: string;
  name: string;
  rule: DiscountRule;
  code: string | null;
  kind: DiscountKind;
  value: number;
  /** Positive amount taken off the list price, in the subject's currency. */
  amount: number;
  stackable: boolean;
};

export type PriceQuote = {
  currency: string;
  listAmount: number;
  discounts: AppliedDiscountLine[];
  discountTotal: number;
  total: number;
  /** The entered promo code, when it did not apply (and why). */
  promoRejection: DiscountRejection | "UNKNOWN_CODE" | null;
};

const RULE_ORDER: Record<DiscountRule, number> = { early_bird: 0, sibling: 1, promo_code: 2, manual: 3 };

export function normalizePromoCode(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? null : n;
}

/** "YYYY-MM-DD" minus N days, as the UTC midnight of that calendar day + 1 day (inclusive day). */
function earlyBirdDeadline(startsOn: string, daysBefore: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startsOn);
  if (!m) return null;
  // Booking is allowed until the END of the day (start - N days).
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - daysBefore + 1);
}

/** Whether the discount is in scope for what is being sold. */
export function inScope(d: Pick<DiscountDef, "scope" | "scopeProgramId" | "scopeServiceId">, s: PricingSubject): boolean {
  switch (d.scope) {
    case "all": return true;
    case "camps": return s.kind === "camp";
    case "training": return s.kind === "training";
    case "program": return !!d.scopeProgramId && d.scopeProgramId === s.programId;
    case "service": return !!d.scopeServiceId && d.scopeServiceId === s.serviceId;
    default: return false;
  }
}

/**
 * Why a discount does not apply to this subject now, or null when it does.
 * Usage limits count the batch's earlier uses (ctx.batchUses).
 */
export function discountRejection(d: DiscountDef, s: PricingSubject, ctx: PricingContext): DiscountRejection | null {
  if (!d.active) return "INACTIVE";
  const now = ctx.now.getTime();
  const from = ms(d.validFrom);
  const until = ms(d.validUntil);
  if (from !== null && now < from) return "NOT_YET_VALID";
  if (until !== null && now > until) return "EXPIRED";
  if (!inScope(d, s)) return "OUT_OF_SCOPE";
  if (d.kind === "fixed_amount" && normalizeCurrency(d.currency ?? "", s.currency) !== normalizeCurrency(s.currency)) {
    return "CURRENCY_MISMATCH";
  }
  switch (d.rule) {
    case "promo_code": {
      const entered = normalizePromoCode(ctx.promoCode);
      if (!entered || entered !== normalizePromoCode(d.code)) return "CODE_MISMATCH";
      const batch = ctx.batchUses?.[d.id] ?? 0;
      if (d.maxRedemptions != null && (d.redemptions ?? 0) + batch >= d.maxRedemptions) return "LIMIT_REACHED";
      if (d.maxRedemptionsPerFamily != null && (d.familyRedemptions ?? 0) + batch >= d.maxRedemptionsPerFamily) return "FAMILY_LIMIT_REACHED";
      return null;
    }
    case "sibling": {
      const min = Math.max(2, d.siblingMinPosition ?? 2);
      return (s.siblingPosition ?? 1) >= min ? null : "NOT_A_SIBLING";
    }
    case "early_bird": {
      if (d.earlyBirdDaysBefore != null) {
        if (!s.startsOn) return "OUT_OF_SCOPE";
        const deadline = earlyBirdDeadline(s.startsOn, d.earlyBirdDaysBefore);
        if (deadline === null || now >= deadline) return "EXPIRED";
      }
      return null;
    }
    case "manual":
      return ctx.manualDiscountIds?.includes(d.id) ? null : "NOT_SELECTED";
    default:
      return "OUT_OF_SCOPE";
  }
}

/** Nominal amount of a discount on a list price (minor units), never above the list price. */
export function discountAmountMinor(d: Pick<DiscountDef, "kind" | "value">, listMinor: number, currency: string): number {
  if (listMinor <= 0) return 0;
  if (d.kind === "percent") {
    const pct = Math.min(Math.max(d.value, 0), 100);
    // percent of minor units, rounded half away from zero (after float snap)
    const raw = Math.round(((listMinor * pct) / 100) * 1e6) / 1e6;
    return Math.min(listMinor, Math.round(raw));
  }
  return Math.min(listMinor, Math.max(0, toMinorUnits(d.value, currency)));
}

/** Major-unit convenience wrapper of discountAmountMinor. */
export function discountAmount(d: Pick<DiscountDef, "kind" | "value">, listAmount: number, currency: string): number {
  return fromMinorUnits(discountAmountMinor(d, toMinorUnits(listAmount, currency), currency), currency);
}

/** Price one subject: list price, the discounts that apply, total. */
export function computePrice(subject: PricingSubject, discounts: DiscountDef[], ctx: PricingContext): PriceQuote {
  const currency = normalizeCurrency(subject.currency);
  const listMinor = Math.max(0, toMinorUnits(subject.listAmount, currency));
  const entered = normalizePromoCode(ctx.promoCode);

  type Cand = { d: DiscountDef; minor: number };
  const cands: Cand[] = [];
  let promoRejection: PriceQuote["promoRejection"] = entered ? "UNKNOWN_CODE" : null;

  for (const d of discounts) {
    const why = discountRejection(d, subject, ctx);
    const isEnteredPromo = d.rule === "promo_code" && !!entered && normalizePromoCode(d.code) === entered;
    if (why) {
      if (isEnteredPromo) promoRejection = why;
      continue;
    }
    if (isEnteredPromo) promoRejection = null;
    const minor = discountAmountMinor(d, listMinor, currency);
    if (minor > 0) cands.push({ d, minor });
  }

  const stackable = cands.filter((c) => c.d.stackable !== false);
  const solo = cands.filter((c) => c.d.stackable === false).sort((a, b) => b.minor - a.minor)[0];
  const stackSum = stackable.reduce((s, c) => s + c.minor, 0);
  let chosen: Cand[] = stackable;
  if (solo && solo.minor > stackSum) chosen = [solo];

  // An entered promo code that lost to a better combination is reported, not silently dropped.
  if (entered && promoRejection === null && !chosen.some((c) => c.d.rule === "promo_code")) promoRejection = "NOT_COMBINABLE";

  chosen = [...chosen].sort((a, b) => RULE_ORDER[a.d.rule] - RULE_ORDER[b.d.rule] || a.d.name.localeCompare(b.d.name) || a.d.id.localeCompare(b.d.id));

  // Cap: the total discount never exceeds the list price (later lines shrink).
  let left = listMinor;
  const lines: AppliedDiscountLine[] = [];
  for (const c of chosen) {
    const take = Math.min(c.minor, left);
    if (take <= 0) continue;
    left -= take;
    lines.push({
      discountId: c.d.id, name: c.d.name, rule: c.d.rule, code: c.d.rule === "promo_code" ? normalizePromoCode(c.d.code) : null,
      kind: c.d.kind, value: c.d.value, amount: fromMinorUnits(take, currency), stackable: c.d.stackable !== false,
    });
  }
  const discountMinor = listMinor - left;
  return {
    currency,
    listAmount: fromMinorUnits(listMinor, currency),
    discounts: lines,
    discountTotal: fromMinorUnits(discountMinor, currency),
    total: fromMinorUnits(left, currency),
    promoRejection,
  };
}

export type BatchItem = PricingSubject & { key: string };
export type BatchQuote = { items: (PriceQuote & { key: string })[]; currency: string; listTotal: number; discountTotal: number; total: number; promoRejection: PriceQuote["promoRejection"] };

/**
 * Price several items bought together (e.g. siblings registering for a camp).
 * Promo usage limits count the uses of earlier items in the batch; the batch
 * reports a promo problem only when the code applied to none of the items.
 */
export function computeBatch(items: BatchItem[], discounts: DiscountDef[], ctx: PricingContext): BatchQuote {
  const uses: Record<string, number> = { ...(ctx.batchUses ?? {}) };
  const out: BatchQuote["items"] = [];
  let currency = items[0] ? normalizeCurrency(items[0].currency) : "CHF";
  let listMinor = 0;
  let discMinor = 0;
  let anyPromo = false;
  let lastRejection: PriceQuote["promoRejection"] = null;
  for (const it of items) {
    const q = computePrice(it, discounts, { ...ctx, batchUses: uses });
    currency = q.currency;
    for (const l of q.discounts) if (l.rule === "promo_code") { uses[l.discountId] = (uses[l.discountId] ?? 0) + 1; anyPromo = true; }
    if (q.promoRejection) lastRejection = q.promoRejection;
    listMinor += toMinorUnits(q.listAmount, q.currency);
    discMinor += toMinorUnits(q.discountTotal, q.currency);
    out.push({ ...q, key: it.key });
  }
  return {
    items: out,
    currency,
    listTotal: fromMinorUnits(listMinor, currency),
    discountTotal: fromMinorUnits(discMinor, currency),
    total: fromMinorUnits(listMinor - discMinor, currency),
    promoRejection: anyPromo ? null : lastRejection,
  };
}
