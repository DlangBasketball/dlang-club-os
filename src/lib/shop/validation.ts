import { z } from "zod";

/** Shop input validation (zod) + database error -> i18n key mapping. Keys live under "shop.". */
const E = (k: string) => `shop.errors.${k}`;

export const ORDER_STATUSES = ["pending_payment", "paid", "ready_for_pickup", "fulfilled", "cancelled", "refunded"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ADMIN_TRANSITIONS = ["ready_for_pickup", "fulfilled", "cancelled", "refunded"] as const;
export type AdminTransition = (typeof ADMIN_TRANSITIONS)[number];

/** Which admin actions an order offers in its current state (mirrors shop_set_order_status). */
export function nextStatuses(status: OrderStatus, fulfillment: "pickup" | "shipping"): AdminTransition[] {
  switch (status) {
    case "pending_payment": return ["cancelled"];
    case "paid": return fulfillment === "pickup" ? ["ready_for_pickup", "fulfilled", "refunded"] : ["fulfilled", "refunded"];
    case "ready_for_pickup": return ["fulfilled", "refunded"];
    case "fulfilled": return ["refunded"];
    default: return [];
  }
}

const uuid = z.string().uuid(E("invalidRequest"));
const optUuid = z.union([z.string().uuid(), z.literal(""), z.null()]).optional().transform((v) => (v ? v : null));
const money = z.coerce.number({ invalid_type_error: E("price") }).min(0, E("price")).max(1_000_000, E("price"));

export const productSchema = z.object({
  name: z.string().trim().min(1, E("nameRequired")).max(120, E("tooLong")),
  description: z.string().trim().max(4000, E("tooLong")).optional().default(""),
  category: z.string().trim().max(60, E("tooLong")).optional().default(""),
  price: money,
  visibility: z.enum(["public", "members"]).default("public"),
  isActive: z.boolean().default(true),
  pickupAvailable: z.boolean().default(true),
  pickupVenueId: optUuid,
  shippingAvailable: z.boolean().default(false),
  shippingFee: z.coerce.number().min(0, E("price")).max(10_000, E("price")).default(0),
  lowStockThreshold: z.coerce.number().int().min(0).max(100_000).default(3),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
}).refine((v) => v.pickupAvailable || v.shippingAvailable, { message: E("fulfillmentRequired"), path: ["pickupAvailable"] });
export type ProductInput = z.input<typeof productSchema>;

export const variantSchema = z.object({
  id: optUuid,
  sku: z.string().trim().max(40, E("tooLong")).regex(/^[A-Za-z0-9._/-]*$/, E("sku")).optional().default(""),
  size: z.string().trim().max(30, E("tooLong")).optional().default(""),
  color: z.string().trim().max(30, E("tooLong")).optional().default(""),
  price: z.union([money, z.literal(""), z.null()]).optional().transform((v) => (v === "" || v === undefined || v === null ? null : v)),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type VariantInput = z.input<typeof variantSchema>;

export const stockSchema = z.object({
  variantId: uuid,
  delta: z.coerce.number().int(E("quantity")).min(-100_000, E("quantity")).max(100_000, E("quantity"))
    .refine((n) => n !== 0, E("quantity")),
  kind: z.enum(["restock", "adjustment"]),
  reason: z.string().trim().max(500, E("tooLong")).optional().default(""),
}).refine((v) => v.kind !== "restock" || v.delta > 0, { message: E("quantity"), path: ["delta"] })
  .refine((v) => v.kind !== "adjustment" || v.reason.length > 0, { message: E("reasonRequired"), path: ["reason"] });
export type StockInput = z.input<typeof stockSchema>;

export const checkoutSchema = z.object({
  items: z.array(z.object({ variantId: uuid, quantity: z.coerce.number().int().min(1, E("quantity")).max(100, E("quantity")) }))
    .min(1, E("cartEmpty")).max(50, E("cartTooLarge")),
  buyer: z.object({
    name: z.string().trim().min(1, E("nameRequired")).max(120, E("tooLong")),
    email: z.string().trim().toLowerCase().email(E("email")).max(254, E("tooLong")),
    phone: z.string().trim().max(40, E("tooLong")).optional().default(""),
  }),
  fulfillment: z.enum(["pickup", "shipping"]).default("pickup"),
  pickupVenueId: optUuid,
  shippingAddress: z.string().trim().max(500, E("tooLong")).optional().default(""),
  promoCode: z.string().trim().max(40, E("tooLong")).optional().default(""),
  notes: z.string().trim().max(1000, E("tooLong")).optional().default(""),
  expectedTotal: z.number().min(0).optional(),
}).refine((v) => v.fulfillment !== "shipping" || v.shippingAddress.length >= 5, { message: E("addressRequired"), path: ["shippingAddress"] });
export type CheckoutInput = z.input<typeof checkoutSchema>;

export const statusSchema = z.object({
  orderId: uuid,
  status: z.enum(ADMIN_TRANSITIONS),
  reason: z.string().trim().max(500, E("tooLong")).optional().default(""),
}).refine((v) => !(v.status === "cancelled" || v.status === "refunded") || v.reason.length > 0, { message: E("reasonRequired"), path: ["reason"] });
export type StatusInput = z.input<typeof statusSchema>;

/** First zod issue as an i18n key. */
export function shopZodKey(error: z.ZodError): string {
  const msg = error.issues[0]?.message ?? "";
  return msg.startsWith("shop.") ? msg : E("invalidRequest");
}

export const PROMO_REJECTIONS = [
  "UNKNOWN_CODE", "OUT_OF_SCOPE", "NOT_YET_VALID", "EXPIRED", "CURRENCY_MISMATCH", "LIMIT_REACHED",
  "FAMILY_LIMIT_REACHED", "NOT_COMBINABLE", "NOT_APPLICABLE", "CODE_MISMATCH", "INACTIVE", "NOT_A_SIBLING", "NOT_SELECTED",
] as const;

/** "PROMO_LIMIT_REACHED" (database) -> "shop.promo.LIMIT_REACHED"; null when the message is not a promo error. */
export function promoErrorKey(message: string | null | undefined): string | null {
  const m = /PROMO_([A-Z_]+)/.exec(message ?? "");
  if (!m) return null;
  const code = m[1] as (typeof PROMO_REJECTIONS)[number];
  return `shop.promo.${(PROMO_REJECTIONS as readonly string[]).includes(code) ? code : "UNKNOWN_CODE"}`;
}

const DB_ERRORS: [RegExp, string][] = [
  [/OUT_OF_STOCK/, "outOfStock"],
  [/STOCK_NEGATIVE|shop_variants_stock_nonneg/, "stockNegative"],
  [/STOCK_VIA_MOVEMENTS/, "stockViaMovements"],
  [/PRODUCT_NOT_AVAILABLE/, "productNotAvailable"],
  [/FULFILLMENT_NOT_AVAILABLE/, "fulfillmentNotAvailable"],
  [/PICKUP_VENUE_INVALID/, "pickupVenue"],
  [/ADDRESS_REQUIRED/, "addressRequired"],
  [/PRICE_CHANGED/, "priceChanged"],
  [/CART_EMPTY/, "cartEmpty"],
  [/CART_TOO_LARGE/, "cartTooLarge"],
  [/NOT_A_MEMBER|FAMILY_NOT_FOUND/, "notMember"],
  [/INVALID_TRANSITION/, "invalidTransition"],
  [/HAS_PAYMENTS/, "hasPayments"],
  [/REASON_REQUIRED/, "reasonRequired"],
  [/ORDER_NOT_FOUND|VARIANT_NOT_FOUND|CLUB_NOT_FOUND/, "notFound"],
  [/shop_variants_sku_uidx|duplicate key/, "skuTaken"],
  [/NOT_AUTHORIZED|row-level security|permission denied/, "notPermitted"],
  [/EMAIL_REQUIRED/, "email"],
  [/NAME_REQUIRED/, "nameRequired"],
];

export function shopErrorKey(message: string | null | undefined): string {
  const promo = promoErrorKey(message);
  if (promo) return promo;
  const m = message ?? "";
  for (const [re, key] of DB_ERRORS) if (re.test(m)) return E(key);
  return E("generic");
}
