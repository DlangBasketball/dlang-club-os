import "server-only";
import { createHash } from "node:crypto";
import { clubMediaUrl, shopAdminDb, shopDb, type MovementRow, type OrderItemRow, type OrderRow, type ProductRow, type VariantRow } from "./db";
import type { CatalogVariant } from "./cart";
import { isLowStock } from "./cart";

/**
 * Shop reads. Public catalogue: service role pinned to the org resolved
 * server-side (host / slug), public active products only (members-only
 * products when the visitor is a signed-in member of that club). Admin and
 * member reads go through RLS.
 */
export type ShopVariant = { id: string; sku: string | null; size: string | null; color: string | null; label: string | null; price: number; stock: number; isActive: boolean; sortOrder: number };
export type ShopProduct = {
  id: string; name: string; description: string | null; category: string | null; price: number; currency: string;
  images: { path: string; url: string }[]; visibility: "public" | "members"; isActive: boolean;
  pickupAvailable: boolean; pickupVenueId: string | null; shippingAvailable: boolean; shippingFee: number;
  lowStockThreshold: number; sortOrder: number; variants: ShopVariant[]; totalStock: number; lowStock: boolean;
};

export function variantLabel(v: { size: string | null; color: string | null }): string | null {
  const parts = [v.size, v.color].map((x) => (x ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" / ") : null;
}

function mapProduct(p: ProductRow, variants: VariantRow[]): ShopProduct {
  const vs = variants
    .filter((v) => v.product_id === p.id)
    .sort((a, b) => a.sort_order - b.sort_order || (a.size ?? "").localeCompare(b.size ?? ""))
    .map((v) => ({
      id: v.id, sku: v.sku, size: v.size, color: v.color, label: variantLabel(v), price: Number(v.price ?? p.price),
      stock: v.stock, isActive: v.is_active, sortOrder: v.sort_order,
    }));
  const totalStock = vs.filter((v) => v.isActive).reduce((s, v) => s + v.stock, 0);
  return {
    id: p.id, name: p.name, description: p.description, category: p.category, price: Number(p.price), currency: p.currency,
    images: (p.images ?? []).map((path) => ({ path, url: clubMediaUrl(path) })), visibility: p.visibility, isActive: p.is_active,
    pickupAvailable: p.pickup_available, pickupVenueId: p.pickup_venue_id, shippingAvailable: p.shipping_available,
    shippingFee: Number(p.shipping_fee), lowStockThreshold: p.low_stock_threshold, sortOrder: p.sort_order, variants: vs, totalStock,
    lowStock: vs.some((v) => v.isActive && isLowStock(v.stock, p.low_stock_threshold)),
  };
}

/** Storefront catalogue of one club (server-resolved org). */
export async function getStorefront(orgId: string, includeMembersOnly: boolean): Promise<ShopProduct[]> {
  const db = shopAdminDb();
  let q = db.from("shop_products").select("*").eq("org_id", orgId).eq("is_active", true);
  if (!includeMembersOnly) q = q.eq("visibility", "public");
  const { data: products } = await q.order("sort_order").order("name").limit(200);
  const rows = (products ?? []) as ProductRow[];
  if (!rows.length) return [];
  const { data: variants } = await db.from("shop_product_variants").select("*").eq("org_id", orgId).eq("is_active", true)
    .in("product_id", rows.map((p) => p.id));
  return rows.map((p) => mapProduct(p, (variants ?? []) as VariantRow[])).filter((p) => p.variants.length > 0);
}

/** Flatten a storefront into the cart's variant catalogue. */
export function toCatalog(products: ShopProduct[]): CatalogVariant[] {
  return products.flatMap((p) => p.variants.map((v) => ({
    variantId: v.id, productId: p.id, name: p.name, label: v.label, price: v.price, stock: v.stock,
    shippingAvailable: p.shippingAvailable, pickupAvailable: p.pickupAvailable, shippingFee: p.shippingFee, pickupVenueId: p.pickupVenueId,
  })));
}

/** Active venues for pickup (names + address only). */
export async function getPickupVenues(orgId: string): Promise<{ id: string; name: string; address: string | null }[]> {
  const { data } = await shopAdminDb().from("venues").select("id,name,address,city").eq("org_id", orgId).eq("is_active", true).order("name");
  return (data ?? []).map((v) => ({ id: v.id, name: v.name, address: [v.address, v.city].filter(Boolean).join(", ") || null }));
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export async function listAdminProducts(orgId: string): Promise<ShopProduct[]> {
  const db = await shopDb();
  const [{ data: products }, { data: variants }] = await Promise.all([
    db.from("shop_products").select("*").eq("org_id", orgId).order("sort_order").order("name"),
    db.from("shop_product_variants").select("*").eq("org_id", orgId),
  ]);
  return ((products ?? []) as ProductRow[]).map((p) => mapProduct(p, (variants ?? []) as VariantRow[]));
}

export async function getAdminProduct(orgId: string, id: string): Promise<{ product: ShopProduct; movements: MovementRow[] } | null> {
  const db = await shopDb();
  const { data: p } = await db.from("shop_products").select("*").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (!p) return null;
  const [{ data: variants }, { data: movements }] = await Promise.all([
    db.from("shop_product_variants").select("*").eq("org_id", orgId).eq("product_id", id),
    db.from("shop_stock_movements").select("*").eq("org_id", orgId).eq("product_id", id).order("created_at", { ascending: false }).limit(100),
  ]);
  return { product: mapProduct(p as ProductRow, (variants ?? []) as VariantRow[]), movements: (movements ?? []) as MovementRow[] };
}

export type OrderFilter = { status?: string | null; q?: string | null };

export async function listOrders(orgId: string, filter: OrderFilter = {}, limit = 200): Promise<OrderRow[]> {
  const db = await shopDb();
  let q = db.from("shop_orders").select("*").eq("org_id", orgId);
  if (filter.status) q = q.eq("status", filter.status);
  const term = (filter.q ?? "").trim().replace(/[%_,()]/g, "");
  if (term) q = q.or(`number.ilike.%${term}%,buyer_name.ilike.%${term}%,buyer_email.ilike.%${term}%`);
  const { data } = await q.order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as OrderRow[];
}

export async function getOrder(orgId: string, id: string): Promise<{ order: OrderRow; items: OrderItemRow[]; invoiceNumber: string | null; venueName: string | null } | null> {
  const db = await shopDb();
  const { data: o } = await db.from("shop_orders").select("*").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (!o) return null;
  const order = o as OrderRow;
  const [{ data: items }, inv, venue] = await Promise.all([
    db.from("shop_order_items").select("*").eq("order_id", id).order("created_at"),
    order.invoice_id ? db.from("invoices").select("number").eq("id", order.invoice_id).maybeSingle() : Promise.resolve({ data: null }),
    order.pickup_venue_id ? db.from("venues").select("name").eq("id", order.pickup_venue_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    order, items: (items ?? []) as OrderItemRow[],
    invoiceNumber: (inv.data as { number?: string } | null)?.number ?? null,
    venueName: (venue.data as { name?: string } | null)?.name ?? null,
  };
}

/** Orders of the signed-in member (RLS: own / family orders). */
export async function listMyOrders(orgId: string): Promise<OrderRow[]> {
  const db = await shopDb();
  const { data } = await db.from("shop_orders").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(50);
  return (data ?? []) as OrderRow[];
}

// ---------------------------------------------------------------------------
// Guest order page (token link)
// ---------------------------------------------------------------------------
export function hashOrderToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Order behind a guest's link, only within the club of the request host. */
export async function getOrderByToken(orgId: string, token: string): Promise<{ order: OrderRow; items: OrderItemRow[]; invoiceNumber: string | null; reference: string | null; venueName: string | null } | null> {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  const db = shopAdminDb();
  const { data: o } = await db.from("shop_orders").select("*").eq("org_id", orgId).eq("access_token_hash", hashOrderToken(token)).maybeSingle();
  if (!o) return null;
  const order = o as OrderRow;
  const [{ data: items }, inv, venue] = await Promise.all([
    db.from("shop_order_items").select("*").eq("order_id", order.id).eq("org_id", orgId).order("created_at"),
    order.invoice_id ? db.from("invoices").select("number,payment_reference").eq("id", order.invoice_id).eq("org_id", orgId).maybeSingle() : Promise.resolve({ data: null }),
    order.pickup_venue_id ? db.from("venues").select("name").eq("id", order.pickup_venue_id).eq("org_id", orgId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const invRow = inv.data as { number?: string; payment_reference?: string | null } | null;
  return {
    order, items: (items ?? []) as OrderItemRow[], invoiceNumber: invRow?.number ?? null, reference: invRow?.payment_reference ?? null,
    venueName: (venue.data as { name?: string } | null)?.name ?? null,
  };
}
