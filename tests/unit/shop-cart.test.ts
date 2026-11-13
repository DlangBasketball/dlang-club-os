import { describe, expect, it } from "vitest";
import {
  addToCart, cartTotals, fulfillmentOptions, isLowStock, MAX_QTY_PER_LINE, parseCart, removeLine, setQuantity,
  stockAfterMovement, stockAfterReservation, type CatalogVariant,
} from "@/lib/shop/cart";
import { nextStatuses, promoErrorKey, shopErrorKey, stockSchema, checkoutSchema } from "@/lib/shop/validation";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const catalog: CatalogVariant[] = [
  { variantId: A, productId: "p1", name: "Tee", label: "S", price: 30, stock: 5, shippingAvailable: true, pickupAvailable: true, shippingFee: 8, pickupVenueId: null },
  { variantId: B, productId: "p2", name: "Hoodie", label: "M", price: 59.95, stock: 2, shippingAvailable: true, pickupAvailable: true, shippingFee: 12.5, pickupVenueId: "v1" },
  { variantId: C, productId: "p3", name: "Ball", label: null, price: 0.1, stock: 100, shippingAvailable: false, pickupAvailable: true, shippingFee: 0, pickupVenueId: null },
];

describe("cart math", () => {
  it("adds, merges and caps lines at stock and the per-line maximum", () => {
    let cart = addToCart([], A, 2, 5);
    cart = addToCart(cart, A, 10, 5);
    expect(cart).toEqual([{ variantId: A, quantity: 5 }]);
    expect(addToCart([], C, 500)).toEqual([{ variantId: C, quantity: MAX_QTY_PER_LINE }]);
    expect(addToCart([], A, 1, 0)).toEqual([]);
  });

  it("sets and removes quantities", () => {
    let cart = addToCart([], A, 2, 5);
    cart = setQuantity(cart, A, 4, 5);
    expect(cart[0].quantity).toBe(4);
    expect(setQuantity(cart, A, 0, 5)).toEqual([]);
    expect(removeLine(cart, A)).toEqual([]);
    expect(setQuantity(cart, A, 1.7, 5)[0].quantity).toBe(1);
  });

  it("sums in minor units (no float drift) and adds one parcel fee when shipping", () => {
    const cart = [{ variantId: C, quantity: 3 }, { variantId: B, quantity: 1 }, { variantId: A, quantity: 2 }];
    const pickup = cartTotals(cart, catalog, "CHF", "pickup");
    expect(pickup.subtotal).toBe(120.25);
    expect(pickup.shipping).toBe(0);
    expect(pickup.total).toBe(120.25);
    expect(pickup.itemCount).toBe(6);
    const ship = cartTotals([{ variantId: A, quantity: 2 }, { variantId: B, quantity: 1 }], catalog, "CHF", "shipping");
    expect(ship.shipping).toBe(12.5);
    expect(ship.total).toBe(132.45);
  });

  it("reports lines above stock or unknown variants and leaves them out", () => {
    const t = cartTotals([{ variantId: B, quantity: 3 }, { variantId: "44444444-4444-4444-8444-444444444444", quantity: 1 }, { variantId: A, quantity: 1 }], catalog, "CHF", "pickup");
    expect(t.problems).toHaveLength(2);
    expect(t.subtotal).toBe(30);
  });

  it("knows which delivery options every item allows", () => {
    expect(fulfillmentOptions([{ variantId: A, quantity: 1 }, { variantId: C, quantity: 1 }], catalog)).toEqual({ pickup: true, shipping: false, venueIds: [] });
    expect(fulfillmentOptions([{ variantId: A, quantity: 1 }, { variantId: B, quantity: 1 }], catalog)).toEqual({ pickup: true, shipping: true, venueIds: ["v1"] });
    expect(fulfillmentOptions([], catalog)).toEqual({ pickup: false, shipping: false, venueIds: [] });
  });

  it("parses a stored cart defensively", () => {
    expect(parseCart(null)).toEqual([]);
    expect(parseCart("not json")).toEqual([]);
    expect(parseCart(JSON.stringify({ variantId: A }))).toEqual([]);
    expect(parseCart(JSON.stringify([{ variantId: A, quantity: 2 }, { variantId: A, quantity: 3 }, { variantId: "x", quantity: 1 }, { variantId: B, quantity: 0 }])))
      .toEqual([{ variantId: A, quantity: 2 }]);
  });
});

describe("stock math", () => {
  it("never reserves or adjusts below zero", () => {
    expect(stockAfterReservation(5, 2)).toBe(3);
    expect(stockAfterReservation(2, 3)).toBeNull();
    expect(stockAfterReservation(5, 0)).toBeNull();
    expect(stockAfterMovement(5, -5, "adjustment")).toBe(0);
    expect(stockAfterMovement(5, -6, "adjustment")).toBeNull();
    expect(stockAfterMovement(5, -1, "restock")).toBeNull();
    expect(stockAfterMovement(5, 0, "restock")).toBeNull();
    expect(stockAfterMovement(5, 10, "restock")).toBe(15);
  });

  it("flags low stock at or under the threshold", () => {
    expect(isLowStock(3, 3)).toBe(true);
    expect(isLowStock(4, 3)).toBe(false);
    expect(isLowStock(0, 0)).toBe(true);
  });

  it("validates stock movements (adjustments need a reason, restocks are positive)", () => {
    expect(stockSchema.safeParse({ variantId: A, delta: 3, kind: "restock" }).success).toBe(true);
    expect(stockSchema.safeParse({ variantId: A, delta: -3, kind: "restock" }).success).toBe(false);
    expect(stockSchema.safeParse({ variantId: A, delta: -3, kind: "adjustment" }).success).toBe(false);
    expect(stockSchema.safeParse({ variantId: A, delta: -3, kind: "adjustment", reason: "damaged" }).success).toBe(true);
    expect(stockSchema.safeParse({ variantId: A, delta: 0, kind: "adjustment", reason: "x" }).success).toBe(false);
  });
});

describe("orders", () => {
  it("offers the admin transitions the database allows", () => {
    expect(nextStatuses("pending_payment", "pickup")).toEqual(["cancelled"]);
    expect(nextStatuses("paid", "pickup")).toEqual(["ready_for_pickup", "fulfilled", "refunded"]);
    expect(nextStatuses("paid", "shipping")).toEqual(["fulfilled", "refunded"]);
    expect(nextStatuses("fulfilled", "pickup")).toEqual(["refunded"]);
    expect(nextStatuses("cancelled", "pickup")).toEqual([]);
  });

  it("requires an address for shipping and a non-empty cart", () => {
    const base = { items: [{ variantId: A, quantity: 1 }], buyer: { name: "Guest", email: "guest@example.test" } };
    expect(checkoutSchema.safeParse(base).success).toBe(true);
    expect(checkoutSchema.safeParse({ ...base, fulfillment: "shipping" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, buyer: { name: "x", email: "nope" } }).success).toBe(false);
  });

  it("maps database errors to translated keys", () => {
    expect(shopErrorKey("OUT_OF_STOCK")).toBe("shop.errors.outOfStock");
    expect(shopErrorKey('new row violates check constraint "shop_variants_stock_nonneg"')).toBe("shop.errors.stockNegative");
    expect(shopErrorKey("PROMO_LIMIT_REACHED")).toBe("shop.promo.LIMIT_REACHED");
    expect(promoErrorKey("PROMO_SOMETHING_NEW")).toBe("shop.promo.UNKNOWN_CODE");
    expect(promoErrorKey("OUT_OF_STOCK")).toBeNull();
    expect(shopErrorKey("weird")).toBe("shop.errors.generic");
  });
});
