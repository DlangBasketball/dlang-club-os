/**
 * Camp basket — pure model shared by the browser (basket state, kept in
 * localStorage until checkout), the server actions (quote + checkout) and the
 * unit tests. The server never trusts a basket: it reloads every camp, week,
 * option and discount, prices it with priceBasket() and register_camp_basket()
 * re-checks the result in one transaction.
 */
import { computeBatch, type BatchQuote, type DiscountDef } from "@/lib/pricing/discounts";
import { ageFits, ageOn, rowsForEdition, validDaySelection } from "./logic";
import type { CampAgeGroup, CampPriceOption, PublicCamp } from "./data";

export const BASKET_VERSION = 1;
export const MAX_BASKET_LINES = 40;
export const MAX_BASKET_CHILDREN = 10;

export type BasketLunch = "" | "yes" | "no";

/** A child of the basket: an existing athlete (parent / admin) or a new child (public). */
export type BasketChild = {
  ref: string;
  athleteId?: string | null;
  firstName: string;
  lastName: string;
  dob: string;
  gender?: string;
  allergies?: string;
  conditions?: string;
  medicalNotes?: string;
};

/** One child-week: the week (edition) of a camp + age group, days count, which days, lunch. */
export type BasketLine = {
  key: string;
  childRef: string;
  programId: string;
  editionId: string;
  ageGroupId: string;
  daysCount: number | null;
  lunch: BasketLunch;
  days: string[];
};

export type Basket = { v: number; children: BasketChild[]; lines: BasketLine[]; promo: string };

export const emptyBasket = (): Basket => ({ v: BASKET_VERSION, children: [], lines: [], promo: "" });

// ---------------------------------------------------------------------------
// Persistence (browser): localStorage can be missing, full or blocked.
// ---------------------------------------------------------------------------
export const basketStorageKey = (scope: string) => `clubos.campBasket.v${BASKET_VERSION}:${scope}`;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** Accepts only the expected shape (stored data is untrusted, too). */
export function sanitizeBasket(raw: unknown): Basket {
  const b = emptyBasket();
  if (!raw || typeof raw !== "object") return b;
  const r = raw as Partial<Basket>;
  if (Array.isArray(r.children)) {
    for (const c of r.children.slice(0, MAX_BASKET_CHILDREN)) {
      if (!c || typeof c !== "object" || !str(c.ref, 40)) continue;
      b.children.push({
        ref: str(c.ref, 40), athleteId: str(c.athleteId, 40) || null, firstName: str(c.firstName, 80), lastName: str(c.lastName, 80),
        dob: str(c.dob, 10), gender: str(c.gender, 20), allergies: str(c.allergies, 1000), conditions: str(c.conditions, 1000),
        medicalNotes: str(c.medicalNotes, 2000),
      });
    }
  }
  const refs = new Set(b.children.map((c) => c.ref));
  if (Array.isArray(r.lines)) {
    for (const l of r.lines.slice(0, MAX_BASKET_LINES)) {
      if (!l || typeof l !== "object" || !refs.has(str(l.childRef, 40)) || !str(l.key, 40)) continue;
      const n = Number(l.daysCount);
      b.lines.push({
        key: str(l.key, 40), childRef: str(l.childRef, 40), programId: str(l.programId, 40), editionId: str(l.editionId, 40),
        ageGroupId: str(l.ageGroupId, 40), daysCount: Number.isInteger(n) && n > 0 && n <= 63 ? n : null,
        lunch: l.lunch === "yes" || l.lunch === "no" ? l.lunch : "",
        days: Array.isArray(l.days) ? l.days.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 63) : [],
      });
    }
  }
  b.promo = str(r.promo, 40);
  return b;
}

export function loadBasket(scope: string): Basket {
  try {
    const raw = window.localStorage.getItem(basketStorageKey(scope));
    return raw ? sanitizeBasket(JSON.parse(raw)) : emptyBasket();
  } catch {
    return emptyBasket();
  }
}

/**
 * What is written to the device: the choices and the children's names / date
 * of birth only. Health notes (allergies, conditions, notes) stay in memory —
 * minors' sensitive data is never left in browser storage.
 */
export function storableBasket(basket: Basket): Basket {
  return {
    ...basket,
    children: basket.children.map((c) => ({ ref: c.ref, athleteId: c.athleteId ?? null, firstName: c.firstName, lastName: c.lastName, dob: c.dob, gender: c.gender })),
  };
}

export function saveBasket(scope: string, basket: Basket): void {
  try {
    if (!basket.lines.length && !basket.children.length && !basket.promo) window.localStorage.removeItem(basketStorageKey(scope));
    else window.localStorage.setItem(basketStorageKey(scope), JSON.stringify(storableBasket(basket)));
  } catch {
    /* storage unavailable: the basket lives for this page only */
  }
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------
/** A fresh line key ("l000", "l001", …): unique, ASCII, sortable the same way in JS and SQL ("C" collation). */
export function nextLineKey(lines: Pick<BasketLine, "key">[]): string {
  let max = -1;
  for (const l of lines) {
    const m = /^l(\d+)$/.exec(l.key);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `l${String(max + 1).padStart(3, "0")}`;
}

export function nextChildRef(children: Pick<BasketChild, "ref">[]): string {
  let max = 0;
  for (const c of children) {
    const m = /^c(\d+)$/.exec(c.ref);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `c${max + 1}`;
}

/** Adds a child (or returns the basket unchanged when that athlete is already in it). */
export function upsertChild(b: Basket, child: Omit<BasketChild, "ref"> & { ref?: string }): { basket: Basket; ref: string } {
  if (child.athleteId) {
    const found = b.children.find((c) => c.athleteId === child.athleteId);
    if (found) return { basket: b, ref: found.ref };
  }
  if (child.ref) {
    const found = b.children.find((c) => c.ref === child.ref);
    if (found) return { basket: { ...b, children: b.children.map((c) => (c.ref === child.ref ? { ...c, ...child, ref: c.ref } : c)) }, ref: found.ref };
  }
  if (b.children.length >= MAX_BASKET_CHILDREN) return { basket: b, ref: "" };
  const ref = nextChildRef(b.children);
  return { basket: { ...b, children: [...b.children, { ...child, ref }] }, ref };
}

export function hasLine(b: Basket, childRef: string, editionId: string): boolean {
  return b.lines.some((l) => l.childRef === childRef && l.editionId === editionId);
}

/** Adds one line per week for a child; weeks the child already has are skipped. */
export function addWeeks(b: Basket, childRef: string, weeks: { programId: string; editionId: string; days?: string[] }[],
  choice: { ageGroupId: string; daysCount: number | null; lunch: BasketLunch }): Basket {
  const lines = [...b.lines];
  for (const w of weeks) {
    if (lines.length >= MAX_BASKET_LINES) break;
    if (lines.some((l) => l.childRef === childRef && l.editionId === w.editionId)) continue;
    lines.push({ key: nextLineKey(lines), childRef, programId: w.programId, editionId: w.editionId, ...choice, days: w.days ?? [] });
  }
  return { ...b, lines };
}

export function updateLine(b: Basket, key: string, patch: Partial<Omit<BasketLine, "key">>): Basket {
  return { ...b, lines: b.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) };
}

export function removeLine(b: Basket, key: string): Basket {
  const lines = b.lines.filter((l) => l.key !== key);
  // A public child without any week left is dropped too (nothing to register).
  const used = new Set(lines.map((l) => l.childRef));
  return { ...b, lines, children: b.children.filter((c) => used.has(c.ref) || !!c.athleteId) };
}

/** "Copy to sibling": the same week and choices for another child (age group kept only when it is free to fit). */
export function copyLineToChild(b: Basket, key: string, childRef: string): Basket {
  const src = b.lines.find((l) => l.key === key);
  if (!src || src.childRef === childRef || hasLine(b, childRef, src.editionId) || b.lines.length >= MAX_BASKET_LINES) return b;
  return { ...b, lines: [...b.lines, { ...src, key: nextLineKey(b.lines), childRef }] };
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------
const yearOf = (day: string) => day.slice(0, 4);

/**
 * Week position of each line for its child (multi-week rule), exactly as
 * register_camp_basket() checks it: 1 + the child's active camp weeks already
 * booked that start in the same calendar year + the child's earlier basket
 * lines that year (by start date, then line key).
 * existingWeeks: `${childRef}|${year}` -> count.
 */
export function weekPositions(lines: { key: string; childRef: string; startsOn: string }[], existingWeeks: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) {
    const y = yearOf(l.startsOn);
    const before = lines.filter((o) => o.childRef === l.childRef && yearOf(o.startsOn) === y
      && (o.startsOn < l.startsOn || (o.startsOn === l.startsOn && o.key < l.key))).length;
    out[l.key] = 1 + (existingWeeks[`${l.childRef}|${y}`] ?? 0) + before;
  }
  return out;
}

/**
 * Sibling position of each child: the family's other children already booked
 * on a camp come first, then the basket's children in basket order.
 */
export function siblingPositions(childOrder: string[], existingSiblings = 0): Record<string, number> {
  const out: Record<string, number> = {};
  childOrder.forEach((ref, i) => { out[ref] = existingSiblings + i + 1; });
  return out;
}

export type PricedLine = { key: string; childRef: string; programId: string; startsOn: string; listAmount: number; currency: string };

/**
 * Prices a basket: one subject per child-week, with its sibling and week
 * positions; discounts apply per line on its list price with the shared
 * stacking rules (computeBatch), promo usage limits count earlier lines.
 */
export function priceBasket(args: {
  lines: PricedLine[];
  discounts: DiscountDef[];
  promoCode?: string | null;
  now?: Date;
  existingWeeks?: Record<string, number>;
  existingSiblings?: number;
}): BatchQuote {
  const order: string[] = [];
  for (const l of args.lines) if (!order.includes(l.childRef)) order.push(l.childRef);
  const sib = siblingPositions(order, args.existingSiblings ?? 0);
  const weeks = weekPositions(args.lines, args.existingWeeks);
  const items = args.lines.map((l) => ({
    key: l.key, kind: "camp" as const, programId: l.programId, currency: l.currency, listAmount: l.listAmount,
    startsOn: l.startsOn, siblingPosition: sib[l.childRef], weekPosition: weeks[l.key],
  }));
  return computeBatch(items, args.discounts, { now: args.now ?? new Date(), promoCode: args.promoCode ?? null });
}

// ---------------------------------------------------------------------------
// Validation + quote (server and client)
// ---------------------------------------------------------------------------
export type BasketLineCode =
  | "PROGRAM_NOT_FOUND" | "EDITION_NOT_FOUND" | "EDITION_NOT_OPEN" | "EDITION_FULL" | "CHILD_NOT_FOUND" | "DUPLICATE_LINE"
  | "AGE_GROUP_NOT_FOUND" | "AGE_OUT_OF_RANGE" | "PRICE_OPTION_NOT_FOUND" | "INVALID_DAYS" | "CURRENCY_MISMATCH" | "ALREADY_REGISTERED";

export type ResolvedLine = BasketLine & { optionId: string; option: CampPriceOption; group: CampAgeGroup | null; startsOn: string; listAmount: number; currency: string };

/** The price option a choice stands for (days count + lunch), among the week's options. */
export function resolveOption(camp: PublicCamp, editionId: string, daysCount: number | null, lunch: BasketLunch): CampPriceOption | undefined {
  if (!daysCount) return undefined;
  const opts = rowsForEdition(camp.options, editionId).filter((o) => o.daysCount === daysCount);
  const matches = opts.filter((o) => lunch === "" || o.includesLunch === (lunch === "yes"));
  return matches.length === 1 ? matches[0] : lunch ? matches[0] : undefined;
}

/** The camp's active age group that fits the child on the first day (by sort); "" when none / unknown. */
export function autoAgeGroup(camp: Pick<PublicCamp, "ageGroups">, startsOn: string, dob: string | null | undefined): string {
  const groups = [...camp.ageGroups].filter((g) => g.isActive).sort((a, b) => a.sort - b.sort);
  if (!dob) return groups.length === 1 ? groups[0].id : "";
  const age = ageOn(dob, startsOn);
  return groups.find((g) => ageFits(age, g.minAge, g.maxAge))?.id ?? "";
}

/** Day counts offered for a week, ascending. */
export function dayCountsFor(camp: Pick<PublicCamp, "options">, editionId: string): number[] {
  return Array.from(new Set(rowsForEdition(camp.options, editionId).map((o) => o.daysCount))).sort((a, b) => a - b);
}

export type BasketCheck = {
  lines: ResolvedLine[];
  errors: { key: string; code: BasketLineCode }[];
};

/**
 * Checks every line of a basket against the camps as loaded (open, capacity,
 * age group, option, days, duplicates). `strict` = checkout; otherwise
 * incomplete lines are left out of the price without an error.
 * already: `${childRef}|${editionId}` the child is already registered for.
 */
export function checkBasket(args: {
  basket: Pick<Basket, "children" | "lines">;
  camps: Map<string, PublicCamp>;
  strict: boolean;
  /** Admin booking on behalf of a family: a closed week (not a full one) may be booked. */
  ignoreWindow?: boolean;
  already?: Set<string>;
}): BasketCheck {
  const { basket, camps } = args;
  const kids = new Map(basket.children.map((c) => [c.ref, c]));
  const errors: BasketCheck["errors"] = [];
  const lines: ResolvedLine[] = [];
  const seen = new Set<string>();
  const perEdition = new Map<string, number>();
  for (const l of basket.lines) perEdition.set(l.editionId, (perEdition.get(l.editionId) ?? 0) + 1);
  let currency: string | null = null;

  for (const l of basket.lines) {
    const fail = (code: BasketLineCode) => { errors.push({ key: l.key, code }); };
    const camp = camps.get(l.programId);
    if (!camp) { fail("PROGRAM_NOT_FOUND"); continue; }
    const ed = camp.editions.find((e) => e.id === l.editionId);
    if (!ed) { fail("EDITION_NOT_FOUND"); continue; }
    const child = kids.get(l.childRef);
    if (!child) { fail("CHILD_NOT_FOUND"); continue; }
    const pair = `${l.childRef}|${l.editionId}`;
    if (seen.has(pair)) { fail("DUPLICATE_LINE"); continue; }
    seen.add(pair);
    if (args.already?.has(pair)) { fail("ALREADY_REGISTERED"); continue; }
    if (ed.spotsLeft !== null && (perEdition.get(ed.id) ?? 0) > ed.spotsLeft) { fail("EDITION_FULL"); continue; }
    const openNow = args.ignoreWindow ? ed.status === "published" : ed.open;
    if (!openNow) { fail("EDITION_NOT_OPEN"); continue; }
    const opt = resolveOption(camp, ed.id, l.daysCount, l.lunch);
    if (!opt) { if (args.strict) fail("PRICE_OPTION_NOT_FOUND"); continue; }
    const cur = (opt.currency ?? camp.program.currency).toUpperCase();
    if (cur !== camp.program.currency || (currency !== null && cur !== currency)) { fail("CURRENCY_MISMATCH"); continue; }
    currency = cur;
    const group = camp.ageGroups.find((g) => g.id === l.ageGroupId && g.isActive) ?? null;
    if (args.strict) {
      if (!group) { fail("AGE_GROUP_NOT_FOUND"); continue; }
      if (child.dob && !ageFits(ageOn(child.dob, ed.startsOn), group.minAge, group.maxAge)) { fail("AGE_OUT_OF_RANGE"); continue; }
      if (!validDaySelection(l.days, opt.daysCount, ed.startsOn, ed.endsOn)) { fail("INVALID_DAYS"); continue; }
    }
    lines.push({ ...l, optionId: opt.id, option: opt, group, startsOn: ed.startsOn, listAmount: opt.price, currency: cur });
  }
  return { lines, errors };
}
