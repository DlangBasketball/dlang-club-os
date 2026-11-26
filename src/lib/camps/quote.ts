import { computeBatch, type BatchQuote, type DiscountDef } from "@/lib/pricing/discounts";
import { ageFits, ageOn, rowsForEdition, validDaySelection } from "./logic";
import type { CampAgeGroup, CampPriceOption, PublicCamp } from "./data";

/**
 * Builds the price quote for a camp registration (pure; the server actions
 * load the camp + discounts and call this for both the live price breakdown
 * and the final submission, so what the family sees is what is invoiced).
 */
export type QuoteChild = {
  key: string;
  ageGroupId: string;
  priceOptionId: string;
  days: string[];
  /** Date of birth (public form) — for existing athletes the server loads it. */
  dob: string | null;
};

export type CampQuoteError =
  | "EDITION_NOT_FOUND" | "EDITION_NOT_OPEN" | "EDITION_FULL" | "PRICE_OPTION_NOT_FOUND"
  | "AGE_GROUP_NOT_FOUND" | "AGE_OUT_OF_RANGE" | "INVALID_DAYS" | "CURRENCY_MISMATCH";

export type CampQuote =
  | { ok: true; quote: BatchQuote; options: Record<string, CampPriceOption>; groups: Record<string, CampAgeGroup> }
  | { ok: false; error: CampQuoteError; childKey?: string };

export function buildCampQuote(args: {
  camp: PublicCamp;
  editionId: string;
  children: QuoteChild[];
  discounts: DiscountDef[];
  promoCode?: string | null;
  /** Siblings of this family already registered for the camp (parent app only). */
  existingSiblings?: number;
  now?: Date;
  /** Quotes for display may be built before days / age groups are complete. */
  partial?: boolean;
}): CampQuote {
  const { camp, editionId, children } = args;
  const edition = camp.editions.find((e) => e.id === editionId);
  if (!edition) return { ok: false, error: "EDITION_NOT_FOUND" };
  if (!args.partial) {
    if (!edition.open) return { ok: false, error: "EDITION_NOT_OPEN" };
    if (edition.spotsLeft !== null && children.length > edition.spotsLeft) return { ok: false, error: "EDITION_FULL" };
  }
  const options = rowsForEdition(camp.options, editionId);
  const optById = Object.fromEntries(options.map((o) => [o.id, o]));
  const groups = Object.fromEntries(camp.ageGroups.filter((g) => g.isActive).map((g) => [g.id, g]));

  const items = [];
  let position = (args.existingSiblings ?? 0);
  for (const c of children) {
    const opt = optById[c.priceOptionId];
    if (!opt) return { ok: false, error: "PRICE_OPTION_NOT_FOUND", childKey: c.key };
    const cur = (opt.currency ?? camp.program.currency).toUpperCase();
    if (cur !== camp.program.currency) return { ok: false, error: "CURRENCY_MISMATCH", childKey: c.key };
    if (!args.partial) {
      const g = groups[c.ageGroupId];
      if (!g) return { ok: false, error: "AGE_GROUP_NOT_FOUND", childKey: c.key };
      if (c.dob && !ageFits(ageOn(c.dob, edition.startsOn), g.minAge, g.maxAge)) return { ok: false, error: "AGE_OUT_OF_RANGE", childKey: c.key };
      if (!validDaySelection(c.days, opt.daysCount, edition.startsOn, edition.endsOn)) return { ok: false, error: "INVALID_DAYS", childKey: c.key };
    }
    position += 1;
    items.push({
      key: c.key, kind: "camp" as const, programId: camp.program.id, currency: camp.program.currency,
      listAmount: opt.price, startsOn: edition.startsOn, siblingPosition: position,
    });
  }
  const quote = computeBatch(items, args.discounts, { now: args.now ?? new Date(), promoCode: args.promoCode ?? null });
  return { ok: true, quote, options: optById, groups };
}
