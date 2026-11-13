/**
 * Shop cart + stock math — pure, shared by the shop page (client), the
 * checkout server action and the unit tests. Money is summed in integer
 * minor units of the club's currency; the database re-prices every order
 * (public.shop_place_order), so these numbers only explain the cart.
 */
import { fromMinorUnits, toMinorUnits } from "@/lib/payments/currency";

export const MAX_QTY_PER_LINE = 100;
export const MAX_CART_LINES = 50;

export type CartLine = { variantId: string; quantity: number };

/** What the cart needs to know about a variant (from the catalogue). */
export type CatalogVariant = {
  variantId: string;
  productId: string;
  name: string;
  label: string | null;
  price: number;
  stock: number;
  shippingAvailable: boolean;
  pickupAvailable: boolean;
  shippingFee: number;
  pickupVenueId: string | null;
};

export type CartTotals = {
  currency: string;
  lines: (CartLine & { item: CatalogVariant | null; lineTotal: number; available: boolean })[];
  itemCount: number;
  subtotal: number;
  shipping: number;
  total: number;
  /** Lines whose variant is gone or has less stock than asked. */
  problems: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clampQty(q: number): number {
  if (!Number.isFinite(q)) return 0;
  return Math.max(0, Math.min(MAX_QTY_PER_LINE, Math.trunc(q)));
}

/** Add (or increase) a line, never above the stock (when known) or the per-line cap. */
export function addToCart(cart: CartLine[], variantId: string, quantity = 1, stock?: number): CartLine[] {
  const cap = stock === undefined ? MAX_QTY_PER_LINE : Math.min(MAX_QTY_PER_LINE, Math.max(0, stock));
  const existing = cart.find((l) => l.variantId === variantId);
  if (!existing) {
    if (cart.length >= MAX_CART_LINES) return cart;
    const q = Math.min(cap, clampQty(quantity));
    return q > 0 ? [...cart, { variantId, quantity: q }] : cart;
  }
  return cart.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.min(cap, clampQty(l.quantity + quantity)) } : l));
}

/** Set a line's quantity; 0 removes it. */
export function setQuantity(cart: CartLine[], variantId: string, quantity: number, stock?: number): CartLine[] {
  const cap = stock === undefined ? MAX_QTY_PER_LINE : Math.min(MAX_QTY_PER_LINE, Math.max(0, stock));
  const q = Math.min(cap, clampQty(quantity));
  if (q <= 0) return cart.filter((l) => l.variantId !== variantId);
  return cart.map((l) => (l.variantId === variantId ? { ...l, quantity: q } : l));
}

export function removeLine(cart: CartLine[], variantId: string): CartLine[] {
  return cart.filter((l) => l.variantId !== variantId);
}

/**
 * Totals for a cart. Shipping is one parcel: the highest shipping fee of the
 * items (mirrors shop_place_order). Unknown variants and lines above the
 * stock are reported in `problems` and left out of the totals.
 */
export function cartTotals(cart: CartLine[], catalog: CatalogVariant[], currency: string, fulfillment: "pickup" | "shipping"): CartTotals {
  const byId = new Map(catalog.map((v) => [v.variantId, v]));
  let sub = 0;
  let ship = 0;
  let count = 0;
  const problems: string[] = [];
  const lines = cart.map((l) => {
    const item = byId.get(l.variantId) ?? null;
    const available = !!item && item.stock >= l.quantity && l.quantity > 0;
    if (!available) problems.push(l.variantId);
    const lineMinor = item && available ? toMinorUnits(item.price, currency) * l.quantity : 0;
    if (item && available) {
      sub += lineMinor;
      count += l.quantity;
      if (fulfillment === "shipping") ship = Math.max(ship, toMinorUnits(item.shippingFee, currency));
    }
    return { ...l, item, lineTotal: fromMinorUnits(lineMinor, currency), available };
  });
  return {
    currency,
    lines,
    itemCount: count,
    subtotal: fromMinorUnits(sub, currency),
    shipping: fromMinorUnits(ship, currency),
    total: fromMinorUnits(sub + ship, currency),
    problems,
  };
}

/** Which ways of getting the order are possible for every item in the cart. */
export function fulfillmentOptions(cart: CartLine[], catalog: CatalogVariant[]): { pickup: boolean; shipping: boolean; venueIds: string[] } {
  const byId = new Map(catalog.map((v) => [v.variantId, v]));
  const items = cart.map((l) => byId.get(l.variantId)).filter((v): v is CatalogVariant => !!v);
  const venues = new Set(items.map((i) => i.pickupVenueId).filter((v): v is string => !!v));
  return {
    pickup: items.length > 0 && items.every((i) => i.pickupAvailable) && venues.size <= 1,
    shipping: items.length > 0 && items.every((i) => i.shippingAvailable),
    venueIds: Array.from(venues),
  };
}

/** Stock left after reserving `quantity` (never below zero; null when not enough). */
export function stockAfterReservation(stock: number, quantity: number): number | null {
  if (!Number.isInteger(quantity) || quantity < 1) return null;
  return stock >= quantity ? stock - quantity : null;
}

/** Stock after an admin movement; null when it would go negative. */
export function stockAfterMovement(stock: number, delta: number, kind: "restock" | "adjustment"): number | null {
  if (!Number.isInteger(delta) || delta === 0) return null;
  if (kind === "restock" && delta < 0) return null;
  const next = stock + delta;
  return next < 0 ? null : next;
}

export function isLowStock(stock: number, threshold: number): boolean {
  return stock <= Math.max(0, threshold);
}

/** Parse a cart read from localStorage; anything malformed is dropped. */
export function parseCart(raw: string | null | undefined): CartLine[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: CartLine[] = [];
    for (const x of data) {
      if (!x || typeof x !== "object") continue;
      const { variantId, quantity } = x as Record<string, unknown>;
      if (typeof variantId !== "string" || !UUID_RE.test(variantId)) continue;
      const q = clampQty(Number(quantity));
      if (q < 1 || out.some((l) => l.variantId === variantId)) continue;
      out.push({ variantId, quantity: q });
      if (out.length >= MAX_CART_LINES) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** localStorage key per club (carts never mix clubs on a shared device). */
export function cartStorageKey(orgId: string): string {
  return `shop-cart:${orgId}`;
}
