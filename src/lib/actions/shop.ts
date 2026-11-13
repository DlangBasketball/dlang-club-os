"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { getTenant, orgMatchesTenant, tenantMatchesOrg } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { writeAudit } from "@/lib/people/server";
import { sniffImageType } from "@/lib/people/validation";
import { logError } from "@/lib/log";
import { loadPricingDiscounts } from "@/lib/camps/data";
import { computePrice } from "@/lib/pricing/discounts";
import { getOrgPaymentProfile, methodsForInvoice } from "@/lib/payments/settings";
import { createInvoiceCheckout } from "@/lib/stripe-connect";
import { getStripe } from "@/lib/stripe";
import type { Json } from "@/types/database";
import { CLUB_MEDIA_BUCKET, shopAdminDb, shopDb } from "@/lib/shop/db";
import { cartTotals } from "@/lib/shop/cart";
import { getOrderByToken, getStorefront, hashOrderToken, toCatalog } from "@/lib/shop/data";
import {
  checkoutSchema, productSchema, shopErrorKey, shopZodKey, statusSchema, stockSchema, variantSchema,
  type CheckoutInput, type ProductInput, type StatusInput, type StockInput, type VariantInput,
} from "@/lib/shop/validation";

/**
 * Shop server actions. Admin mutations: admin of the session's club (org
 * from the profile, never the client) on that club's host. Checkout: the
 * club is the request host's tenant (or the signed-in member's own club on
 * the platform host); prices, stock and discounts are re-checked by
 * public.shop_place_order().
 */
export type ShopResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
type Admin = SessionUser & { orgId: string };

async function fail(key: string, orgId?: string | null): Promise<{ ok: false; error: string }> {
  const t = await getTranslations(orgId);
  return { ok: false, error: t.dynamic(key, undefined, t("shop.errors.generic")) };
}

async function requireAdmin(): Promise<Admin | null> {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return null;
  if (!(await tenantMatchesOrg(me.orgId))) return null;
  return me as Admin;
}

const isUuid = (v: unknown): v is string => typeof v === "string" && z.string().uuid().safeParse(v).success;

function revalidateShop(productId?: string) {
  revalidatePath("/admin/shop");
  revalidatePath("/admin/shop/orders");
  if (productId) revalidatePath(`/admin/shop/${productId}`);
  revalidatePath("/shop");
}

// ===========================================================================
// Products + variants (admin)
// ===========================================================================
export async function saveProduct(id: string | null, input: ProductInput): Promise<ShopResult<{ id: string }>> {
  const me = await requireAdmin();
  if (!me) return fail("shop.errors.notPermitted");
  if (id && !isUuid(id)) return fail("shop.errors.invalidRequest", me.orgId);
  const p = productSchema.safeParse(input);
  if (!p.success) return fail(shopZodKey(p.error), me.orgId);
  const v = p.data;
  const db = await shopDb();
  if (v.pickupVenueId) {
    const { data } = await db.from("venues").select("id").eq("id", v.pickupVenueId).eq("org_id", me.orgId).maybeSingle();
    if (!data) return fail("shop.errors.pickupVenue", me.orgId);
  }
  const { data: org } = await db.from("organizations").select("currency").eq("id", me.orgId).maybeSingle();
  const row = {
    name: v.name, description: v.description || null, category: v.category || null, price: v.price,
    visibility: v.visibility, is_active: v.isActive, pickup_available: v.pickupAvailable, pickup_venue_id: v.pickupVenueId,
    shipping_available: v.shippingAvailable, shipping_fee: v.shippingFee, low_stock_threshold: v.lowStockThreshold, sort_order: v.sortOrder,
  };
  const res = id
    ? await db.from("shop_products").update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from("shop_products").insert({
      ...row, org_id: me.orgId, created_by: me.id,
      currency: ((org as { currency?: string | null } | null)?.currency ?? "CHF").toUpperCase(),
    }).select("id");
  if (res.error) return fail(shopErrorKey(res.error.message), me.orgId);
  if (!res.data?.length) return fail("shop.errors.notFound", me.orgId);
  const pid = res.data[0].id;
  // A product without a variant cannot be sold: add a default one.
  if (!id) {
    const { error } = await db.from("shop_product_variants").insert({ org_id: me.orgId, product_id: pid });
    if (error) logError("shop.defaultVariant", error);
  }
  revalidateShop(pid);
  return { ok: true, data: { id: pid } };
}

export async function deleteProduct(id: string): Promise<ShopResult<{ archived: boolean }>> {
  const me = await requireAdmin();
  if (!me) return fail("shop.errors.notPermitted");
  if (!isUuid(id)) return fail("shop.errors.invalidRequest", me.orgId);
  const db = await shopDb();
  // Sold products stay (order history); they are hidden instead.
  const { count } = await db.from("shop_order_items").select("id", { count: "exact", head: true }).eq("org_id", me.orgId).eq("product_id", id);
  if ((count ?? 0) > 0) {
    const { error } = await db.from("shop_products").update({ is_active: false }).eq("id", id).eq("org_id", me.orgId);
    if (error) return fail(shopErrorKey(error.message), me.orgId);
    revalidateShop(id);
    return { ok: true, data: { archived: true } };
  }
  const { data: prod } = await db.from("shop_products").select("images").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  const { data, error } = await db.from("shop_products").delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return fail(shopErrorKey(error.message), me.orgId);
  if (!data?.length) return fail("shop.errors.notFound", me.orgId);
  const images = ((prod as { images?: string[] } | null)?.images ?? []).filter((p) => p.startsWith(`${me.orgId}/products/`));
  if (images.length) await db.storage.from(CLUB_MEDIA_BUCKET).remove(images);
  revalidateShop();
  return { ok: true, data: { archived: false } };
}

export async function saveVariant(productId: string, input: VariantInput): Promise<ShopResult<{ id: string }>> {
  const me = await requireAdmin();
  if (!me) return fail("shop.errors.notPermitted");
  if (!isUuid(productId)) return fail("shop.errors.invalidRequest", me.orgId);
  const p = variantSchema.safeParse(input);
  if (!p.success) return fail(shopZodKey(p.error), me.orgId);
  const v = p.data;
  const db = await shopDb();
  const row = { sku: v.sku || null, size: v.size || null, color: v.color || null, price: v.price, is_active: v.isActive, sort_order: v.sortOrder };
  const res = v.id
    ? await db.from("shop_product_variants").update(row).eq("id", v.id).eq("product_id", productId).eq("org_id", me.orgId).select("id")
    : await db.from("shop_product_variants").insert({ ...row, org_id: me.orgId, product_id: productId }).select("id");
  if (res.error) return fail(shopErrorKey(res.error.message), me.orgId);
  if (!res.data?.length) return fail("shop.errors.notFound", me.orgId);
  revalidateShop(productId);
  return { ok: true, data: { id: res.data[0].id } };
}

export async function deleteVariant(productId: string, variantId: string): Promise<ShopResult<{ archived: boolean }>> {
  const me = await requireAdmin();
  if (!me) return fail("shop.errors.notPermitted");
  if (!isUuid(productId) || !isUuid(variantId)) return fail("shop.errors.invalidRequest", me.orgId);
  const db = await shopDb();
  const { count } = await db.from("shop_order_items").select("id", { count: "exact", head: true }).eq("org_id", me.orgId).eq("variant_id", variantId);
  const res = (count ?? 0) > 0
    ? await db.from("shop_product_variants").update({ is_active: false }).eq("id", variantId).eq("org_id", me.orgId).select("id")
    : await db.from("shop_product_variants").delete().eq("id", variantId).eq("product_id", productId).eq("org_id", me.orgId).select("id");
  if (res.error) return fail(shopErrorKey(res.error.message), me.orgId);
  if (!res.data?.length) return fail("shop.errors.notFound", me.orgId);
  revalidateShop(productId);
  return { ok: true, data: { archived: (count ?? 0) > 0 } };
}

export async function adjustStock(input: StockInput): Promise<ShopResult<{ stock: number }>> {
  const me = await requireAdmin();
  if (!me) return fail("shop.errors.notPermitted");
  const p = stockSchema.safeParse(input);
  if (!p.success) return fail(shopZodKey(p.error), me.orgId);
  const db = await shopDb();
  const { data, error } = await db.rpc("shop_adjust_stock", {
    p_variant: p.data.variantId, p_delta: p.data.delta, p_kind: p.data.kind, p_reason: p.data.reason || null,
  });
  if (error) return fail(shopErrorKey(error.message), me.orgId);
  revalidateShop();
  return { ok: true, data: { stock: Number((data as { stock?: number } | null)?.stock ?? 0) } };
}

const IMAGE_MAX_BYTES = 3 * 1024 * 1024;

export async function uploadProductImage(form: FormData): Promise<ShopResult<{ path: string }>> {
  const me = await requireAdmin();
  if (!me) return fail("shop.errors.notPermitted");
  const productId = String(form.get("productId") ?? "");
  const file = form.get("file");
  if (!isUuid(productId) || !(file instanceof File)) return fail("shop.errors.invalidRequest", me.orgId);
  if (file.size === 0 || file.size > IMAGE_MAX_BYTES) return fail("shop.errors.imageSize", me.orgId);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) return fail("shop.errors.imageType", me.orgId);
  const db = await shopDb();
  const { data: prod } = await db.from("shop_products").select("images").eq("id", productId).eq("org_id", me.orgId).maybeSingle();
  if (!prod) return fail("shop.errors.notFound", me.orgId);
  const images = (prod as { images: string[] }).images ?? [];
  if (images.length >= 8) return fail("shop.errors.tooManyImages", me.orgId);
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const path = `${me.orgId}/products/${productId}-${randomUUID()}.${ext}`;
  const up = await db.storage.from(CLUB_MEDIA_BUCKET).upload(path, bytes, { contentType: type, upsert: false, cacheControl: "3600" });
  if (up.error) {
    logError("shop.imageUpload", up.error);
    return fail("shop.errors.uploadFailed", me.orgId);
  }
  const { error } = await db.from("shop_products").update({ images: [...images, path] }).eq("id", productId).eq("org_id", me.orgId);
  if (error) {
    await db.storage.from(CLUB_MEDIA_BUCKET).remove([path]);
    return fail(shopErrorKey(error.message), me.orgId);
  }
  revalidateShop(productId);
  return { ok: true, data: { path } };
}

export async function removeProductImage(productId: string, path: string): Promise<ShopResult> {
  const me = await requireAdmin();
  if (!me) return fail("shop.errors.notPermitted");
  if (!isUuid(productId) || typeof path !== "string" || !path.startsWith(`${me.orgId}/products/`) || path.includes("..")) {
    return fail("shop.errors.invalidRequest", me.orgId);
  }
  const db = await shopDb();
  const { data: prod } = await db.from("shop_products").select("images").eq("id", productId).eq("org_id", me.orgId).maybeSingle();
  if (!prod) return fail("shop.errors.notFound", me.orgId);
  const images = ((prod as { images: string[] }).images ?? []).filter((p) => p !== path);
  const { error } = await db.from("shop_products").update({ images }).eq("id", productId).eq("org_id", me.orgId);
  if (error) return fail(shopErrorKey(error.message), me.orgId);
  await db.storage.from(CLUB_MEDIA_BUCKET).remove([path]);
  revalidateShop(productId);
  return { ok: true };
}

// ===========================================================================
// Orders (admin)
// ===========================================================================
export async function setOrderStatus(input: StatusInput): Promise<ShopResult> {
  const me = await requireAdmin();
  if (!me) return fail("shop.errors.notPermitted");
  const p = statusSchema.safeParse(input);
  if (!p.success) return fail(shopZodKey(p.error), me.orgId);
  const db = await shopDb();
  const { error } = await db.rpc("shop_set_order_status", { p_order: p.data.orderId, p_status: p.data.status, p_reason: p.data.reason || null });
  if (error) return fail(shopErrorKey(error.message), me.orgId);
  await writeAudit(me, `shop.order.${p.data.status}`, "shop_orders", p.data.orderId, { status: p.data.status });
  revalidatePath(`/admin/shop/orders/${p.data.orderId}`);
  revalidateShop();
  revalidatePath("/admin/invoices");
  return { ok: true };
}

// ===========================================================================
// Storefront + checkout
// ===========================================================================
type ShopContext = { orgId: string; member: { profileId: string; familyId: string | null; email: string | null; name: string | null } | null };

/** The club of the shop: the signed-in member's own club when it matches the host, else the host's club. */
async function shopContext(): Promise<ShopContext | null> {
  const [tenant, me] = await Promise.all([getTenant(), getSessionUser()]);
  if (me?.orgId && orgMatchesTenant(me.orgId, tenant)) {
    const admin = shopAdminDb();
    const { data: fam } = await admin.from("family_members").select("family_id,is_primary,families!inner(org_id)")
      .eq("profile_id", me.id).eq("families.org_id", me.orgId).order("is_primary", { ascending: false }).limit(1);
    const familyId = (fam?.[0] as { family_id?: string } | undefined)?.family_id ?? null;
    return { orgId: me.orgId, member: { profileId: me.id, familyId, email: me.email ?? null, name: me.fullName ?? null } };
  }
  if (!tenant.id) return null;
  return { orgId: tenant.id, member: null };
}

export type CartQuote = {
  ok: boolean;
  error?: string;
  currency: string;
  subtotal: number;
  discountTotal: number;
  discounts: { name: string; amount: number }[];
  shipping: number;
  total: number;
  promo: "none" | "applied" | "rejected";
  promoMessage?: string;
  unavailable: string[];
};

/** Price a cart (preview). The order itself is re-priced by the database. */
export async function quoteCart(input: { items: { variantId: string; quantity: number }[]; fulfillment: "pickup" | "shipping"; promoCode?: string }): Promise<CartQuote> {
  const ctx = await shopContext();
  const t = await getTranslations(ctx?.orgId);
  const empty: CartQuote = { ok: false, currency: "CHF", subtotal: 0, discountTotal: 0, discounts: [], shipping: 0, total: 0, promo: "none", unavailable: [] };
  if (!ctx) return { ...empty, error: t("shop.errors.notFound") };
  const items = z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(100) })).max(50).safeParse(input.items);
  if (!items.success) return { ...empty, error: t("shop.errors.invalidRequest") };
  const products = await getStorefront(ctx.orgId, Boolean(ctx.member));
  const currency = products[0]?.currency ?? (await getTenant()).currency ?? "CHF";
  const totals = cartTotals(items.data, toCatalog(products), currency, input.fulfillment === "shipping" ? "shipping" : "pickup");
  const promoCode = (input.promoCode ?? "").trim().slice(0, 40);
  const discounts = await loadPricingDiscounts(ctx.orgId, ctx.member?.familyId ?? null);
  const q = computePrice({ kind: "shop", currency, listAmount: totals.subtotal }, discounts, { now: new Date(), promoCode });
  const rejected = promoCode !== "" && q.promoRejection !== null;
  return {
    ok: true, currency, subtotal: totals.subtotal, discountTotal: q.discountTotal,
    discounts: q.discounts.map((d) => ({ name: d.name, amount: d.amount })), shipping: totals.shipping,
    total: Math.round((q.total + totals.shipping) * 1e6) / 1e6,
    promo: promoCode === "" ? "none" : rejected ? "rejected" : "applied",
    promoMessage: rejected ? t.dynamic(`shop.promo.${q.promoRejection}`, undefined, t("shop.promo.UNKNOWN_CODE")) : undefined,
    unavailable: totals.problems,
  };
}

export type PlacedOrder = { orderId: string; number: string; token: string | null; member: boolean; invoiceId: string | null };

export async function placeOrder(input: CheckoutInput): Promise<ShopResult<PlacedOrder>> {
  const ctx = await shopContext();
  if (!ctx) return fail("shop.errors.notFound");
  const p = checkoutSchema.safeParse(input);
  if (!p.success) return fail(shopZodKey(p.error), ctx.orgId);
  const v = p.data;
  const t = await getTranslations(ctx.orgId);
  const token = ctx.member ? null : randomBytes(32).toString("base64url");
  const payload = {
    org_id: ctx.orgId,
    mode: ctx.member ? "member" : "guest",
    profile_id: ctx.member?.profileId ?? null,
    family_id: ctx.member?.familyId ?? null,
    buyer: { name: v.buyer.name, email: v.buyer.email, phone: v.buyer.phone || null },
    fulfillment: v.fulfillment,
    pickup_venue_id: v.fulfillment === "pickup" ? v.pickupVenueId : null,
    shipping_address: v.fulfillment === "shipping" ? v.shippingAddress : null,
    notes: v.notes || null,
    promo_code: v.promoCode || null,
    items: v.items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })),
    access_token_hash: token ? hashOrderToken(token) : null,
    expected_total: v.expectedTotal ?? null,
    labels: { invoice: t("shop.invoice.description"), shipping: t("shop.invoice.shipping") },
  };
  const { data, error } = await shopAdminDb().rpc("shop_place_order", { p_payload: payload as unknown as Json });
  if (error) {
    if (!/PROMO_|OUT_OF_STOCK|PRICE_CHANGED|PRODUCT_NOT_AVAILABLE/.test(error.message)) logError("shop.placeOrder", error);
    return fail(shopErrorKey(error.message), ctx.orgId);
  }
  const r = (data ?? {}) as { order_id?: string; number?: string; invoice_id?: string | null };
  revalidatePath("/admin/shop/orders");
  revalidatePath("/parent/invoices");
  revalidatePath("/shop");
  return { ok: true, data: { orderId: r.order_id ?? "", number: r.number ?? "", token, member: Boolean(ctx.member), invoiceId: r.invoice_id ?? null } };
}

/** Card / TWINT payment for a guest order (Stripe, when the club set it up). */
export async function payGuestOrder(token: string): Promise<ShopResult<{ url: string }>> {
  const tenant = await getTenant();
  if (!tenant.id || typeof token !== "string") return fail("shop.errors.notFound");
  const found = await getOrderByToken(tenant.id, token);
  if (!found || found.order.status !== "pending_payment" || !found.order.invoice_id || !found.invoiceNumber) {
    return fail("shop.errors.notPayable", tenant.id);
  }
  if (!getStripe()) return fail("shop.errors.noOnlinePayment", tenant.id);
  const profile = await getOrgPaymentProfile(tenant.id);
  if (!profile.stripeReady) return fail("shop.errors.noOnlinePayment", tenant.id);
  const methods = methodsForInvoice(profile, found.order.currency).filter((m) => m.via === "stripe");
  if (!methods.length) return fail("shop.errors.noOnlinePayment", tenant.id);
  const admin = shopAdminDb();
  const { data: inv } = await admin.from("invoices").select("total_chf,adjustments_total,status").eq("id", found.order.invoice_id).eq("org_id", tenant.id).maybeSingle();
  const paidRes = await admin.rpc("invoice_net_paid" as never, { p_invoice: found.order.invoice_id } as never);
  const row = inv as { total_chf?: number; adjustments_total?: number | null; status?: string } | null;
  const balance = Number(row?.total_chf ?? 0) + Number(row?.adjustments_total ?? 0) - Number((paidRes as { data?: unknown }).data ?? 0);
  if (!row || balance <= 0 || ["paid", "cancelled", "void", "written_off"].includes(row.status ?? "")) return fail("shop.errors.notPayable", tenant.id);
  try {
    const url = await createInvoiceCheckout({
      profile, invoiceId: found.order.invoice_id, invoiceNumber: found.invoiceNumber, currency: found.order.currency,
      amount: balance, methods, customerEmail: found.order.buyer_email, returnPath: `/shop/order/${token}`,
    });
    return { ok: true, data: { url } };
  } catch (e) {
    logError("shop.guestCheckout", e);
    return fail("shop.errors.paymentFailed", tenant.id);
  }
}
