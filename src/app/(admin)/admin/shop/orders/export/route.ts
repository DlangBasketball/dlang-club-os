import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { toCsv } from "@/lib/staff/hours";
import { shopDb, type OrderItemRow } from "@/lib/shop/db";
import { listOrders } from "@/lib/shop/data";
import { ORDER_STATUSES } from "@/lib/shop/validation";
import { writeAudit } from "@/lib/people/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV of shop orders (one row per order line) for admin / finance. RLS-scoped. */
export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance")) || !(await tenantMatchesOrg(me.orgId))) {
    return new NextResponse("Not found", { status: 404 });
  }
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const orders = await listOrders(me.orgId, {
    status: status && (ORDER_STATUSES as readonly string[]).includes(status) ? status : null,
    q: (url.searchParams.get("q") ?? "").slice(0, 80),
  }, 5000);
  const db = await shopDb();
  const items: OrderItemRow[] = [];
  for (let i = 0; i < orders.length; i += 200) {
    const { data } = await db.from("shop_order_items").select("*").eq("org_id", me.orgId).in("order_id", orders.slice(i, i + 200).map((o) => o.id));
    items.push(...((data ?? []) as OrderItemRow[]));
  }
  const byOrder = new Map<string, OrderItemRow[]>();
  for (const it of items) byOrder.set(it.order_id, [...(byOrder.get(it.order_id) ?? []), it]);
  const t = await getTranslations(me.orgId);
  const head = ["number", "createdAt", "status", "buyer", "email", "type", "fulfillment", "item", "variant", "sku", "quantity", "unitPrice", "lineTotal", "subtotal", "discount", "shipping", "total", "currency"]
    .map((k) => t.dynamic(`shop.csv.${k}`, undefined, k));
  const rows: (string | number | null)[][] = [head];
  for (const o of orders) {
    const lines = byOrder.get(o.id) ?? [];
    for (const it of lines.length ? lines : [null]) {
      rows.push([
        o.number, o.created_at, t.dynamic(`shop.status.${o.status}`, undefined, o.status), o.buyer_name, o.buyer_email,
        o.is_guest ? t("shop.orders.guest") : t("shop.orders.member"),
        o.fulfillment === "pickup" ? t("shop.checkout.pickup") : t("shop.checkout.shipping"),
        it?.name ?? null, it?.variant_label ?? null, it?.sku ?? null, it?.quantity ?? null, it ? Number(it.unit_price) : null, it ? Number(it.line_total) : null,
        Number(o.subtotal), Number(o.discount_total), Number(o.shipping_total), Number(o.total), o.currency,
      ]);
    }
  }
  await writeAudit(me as { id: string; orgId: string }, "shop.orders.export", "shop_orders", null, { orders: orders.length });
  return new NextResponse("﻿" + toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="shop-orders.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
