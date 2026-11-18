import "server-only";
import { campsAdminDb } from "./db";
import { getCampForOrg, getPublicCamp, loadPricingDiscounts, type PublicCamp } from "./data";
import { checkBasket, priceBasket, type Basket, type BasketCheck } from "./basket";
import type { BatchQuote } from "@/lib/pricing/discounts";
import { getTenant, orgMatchesTenant } from "@/lib/tenant/server";

/**
 * Server side of the camp basket: org resolution, camp loading, what the
 * family already booked, and the quote. The org NEVER comes from the client:
 * the session (parent / admin) or the host / a public camp slug (public).
 */

/** Club of a public basket: the club host, else the club owning the camp slug the visitor came from. */
export async function publicBasketOrg(slug: string | null | undefined): Promise<string | null> {
  const t = await getTenant();
  if (t.id && t.source !== "default" && t.source !== "fallback") return t.id;
  if (!slug) return null;
  const camp = await getPublicCamp(slug);
  if (!camp || !orgMatchesTenant(camp.program.orgId, t)) return null;
  return camp.program.orgId;
}

/** Every camp of the basket, published (and public for a public basket), of THIS org only. */
export async function loadBasketCamps(orgId: string, programIds: string[], requirePublic: boolean): Promise<Map<string, PublicCamp>> {
  const ids = Array.from(new Set(programIds)).slice(0, 40);
  const camps = await Promise.all(ids.map((id) => getCampForOrg(orgId, id, requirePublic)));
  const map = new Map<string, PublicCamp>();
  for (const c of camps) if (c && c.program.orgId === orgId) map.set(c.program.id, c);
  return map;
}

export type BookedContext = {
  /** `${childRef}|${year}` -> the child's active camp weeks starting that year (multi-week rule). */
  existingWeeks: Record<string, number>;
  /** The family's other children already on a camp in the basket's years (sibling rule). */
  existingSiblings: number;
  /** `${childRef}|${editionId}` the child already holds. */
  already: Set<string>;
};

const ACTIVE = ["pending", "confirmed", "completed"];

/** What the family already booked (existing athletes only; a public basket has none). */
export async function bookedContext(orgId: string, familyId: string | null, refs: Map<string, string>, years: string[]): Promise<BookedContext> {
  const out: BookedContext = { existingWeeks: {}, existingSiblings: 0, already: new Set() };
  if (!familyId) return out;
  const db = campsAdminDb();
  const { data: kids } = await db.from("athletes").select("id").eq("org_id", orgId).eq("family_id", familyId);
  const kidIds = (kids ?? []).map((k) => k.id);
  if (!kidIds.length) return out;
  const { data: regs } = await db.from("registrations").select("athlete_id,camp_edition_id,status")
    .eq("org_id", orgId).in("athlete_id", kidIds).not("camp_edition_id", "is", null);
  const edIds = Array.from(new Set((regs ?? []).map((r) => r.camp_edition_id).filter((x): x is string => !!x)));
  const { data: eds } = edIds.length
    ? await db.from("camp_editions").select("id,starts_on").eq("org_id", orgId).in("id", edIds)
    : { data: [] as { id: string; starts_on: string }[] };
  const startOf = new Map((eds ?? []).map((e) => [e.id, e.starts_on]));
  const refOf = new Map(Array.from(refs.entries()).map(([ref, athleteId]) => [athleteId, ref]));
  const siblings = new Set<string>();
  for (const r of regs ?? []) {
    const ref = refOf.get(r.athlete_id);
    if (ref && r.status !== "cancelled" && r.camp_edition_id) out.already.add(`${ref}|${r.camp_edition_id}`);
    if (!ACTIVE.includes(r.status)) continue;
    const year = (startOf.get(r.camp_edition_id ?? "") ?? "").slice(0, 4);
    if (!year) continue;
    if (ref) out.existingWeeks[`${ref}|${year}`] = (out.existingWeeks[`${ref}|${year}`] ?? 0) + 1;
    else if (years.includes(year)) siblings.add(r.athlete_id);
  }
  out.existingSiblings = siblings.size;
  return out;
}

export type BasketQuoteResult = { check: BasketCheck; quote: BatchQuote | null; camps: Map<string, PublicCamp>; booked: BookedContext };

/** Loads, checks and prices a basket (strict = checkout). */
export async function quoteBasketServer(args: {
  orgId: string; basket: Pick<Basket, "children" | "lines">; promoCode: string; requirePublic: boolean;
  familyId: string | null; refs: Map<string, string>; strict: boolean; ignoreWindow?: boolean;
}): Promise<BasketQuoteResult> {
  const camps = await loadBasketCamps(args.orgId, args.basket.lines.map((l) => l.programId), args.requirePublic);
  const years = Array.from(new Set(args.basket.lines.map((l) => {
    const camp = camps.get(l.programId);
    return camp?.editions.find((e) => e.id === l.editionId)?.startsOn.slice(0, 4) ?? "";
  }).filter(Boolean)));
  const booked = await bookedContext(args.orgId, args.familyId, args.refs, years);
  const check = checkBasket({ basket: args.basket, camps, strict: args.strict, ignoreWindow: args.ignoreWindow, already: booked.already });
  if (!check.lines.length) return { check, quote: null, camps, booked };
  const discounts = await loadPricingDiscounts(args.orgId, args.familyId);
  const quote = priceBasket({
    lines: check.lines.map((l) => ({ key: l.key, childRef: l.childRef, programId: l.programId, startsOn: l.startsOn, listAmount: l.listAmount, currency: l.currency })),
    discounts, promoCode: args.promoCode, existingWeeks: booked.existingWeeks, existingSiblings: booked.existingSiblings,
  });
  return { check, quote, camps, booked };
}
