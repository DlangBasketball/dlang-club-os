import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader, statusTone } from "@/components/ui";
import { OrderActions } from "@/components/shop/order-actions";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getOrder } from "@/lib/shop/data";
import type { OrderStatus } from "@/lib/shop/validation";

export default async function ShopOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const found = await getOrder(me.orgId, id);
  if (!found) notFound();
  const { order: o, items, invoiceNumber, venueName } = found;
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1 text-sm"><span className="text-text-muted">{label}</span><span className="text-right text-text">{value}</span></div>
  );
  const timeline: [string, string | null][] = [
    ["created", o.created_at], ["paid", o.paid_at], ["ready", o.ready_at], ["fulfilled", o.fulfilled_at], ["cancelled", o.cancelled_at], ["refunded", o.refunded_at],
  ];
  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <PageHeader title={o.number} eyebrow={<Link href="/admin/shop/orders" className="hover:underline">{t("shop.orders.title")}</Link>}
        actions={<Badge tone={statusTone(o.status)}>{t.dynamic(`shop.status.${o.status}`, undefined, o.status)}</Badge>} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>{t("shop.orders.buyer")}</CardTitle></CardHeader><CardBody>
          {row(t("shop.checkout.name"), o.buyer_name)}
          {row(t("shop.checkout.email"), o.buyer_email)}
          {o.buyer_phone && row(t("shop.checkout.phone"), o.buyer_phone)}
          {row(t("shop.orders.type"), o.is_guest ? t("shop.orders.guest") : t("shop.orders.member"))}
          {row(t("shop.checkout.fulfillment"), o.fulfillment === "pickup" ? `${t("shop.checkout.pickup")}${venueName ? ` · ${venueName}` : ""}` : t("shop.checkout.shipping"))}
          {o.shipping_address && row(t("shop.checkout.address"), <span className="whitespace-pre-line">{o.shipping_address}</span>)}
          {o.notes && row(t("shop.checkout.notes"), o.notes)}
          {o.invoice_id && row(t("shop.orders.invoice"), <Link href={`/admin/invoices/${o.invoice_id}`} className="text-brand-primary hover:underline">{invoiceNumber ?? "—"}</Link>)}
        </CardBody></Card>
        <Card><CardHeader><CardTitle>{t("shop.orders.timeline")}</CardTitle></CardHeader><CardBody>
          {timeline.filter(([, at]) => at).map(([k, at]) => row(t(`shop.orders.events.${k as "created"}`), f.dateTime(at)))}
          {o.cancel_reason && row(t("shop.orders.reason"), o.cancel_reason)}
          {me.roles.includes("admin") && <div className="mt-4"><OrderActions orderId={o.id} status={o.status as OrderStatus} fulfillment={o.fulfillment} /></div>}
        </CardBody></Card>
      </div>
      <Card><CardHeader><CardTitle>{t("shop.orders.items")}</CardTitle></CardHeader><CardBody className="p-0">
        <ul>{items.map((it) => (
          <li key={it.id} className="flex justify-between gap-3 border-b border-border px-5 py-2.5 text-sm last:border-0">
            <span>{it.quantity} × {it.name}{it.variant_label ? ` (${it.variant_label})` : ""}{it.sku ? <span className="ml-2 font-mono text-xs text-text-muted">{it.sku}</span> : null}</span>
            <span className="tabular-nums">{f.money(it.line_total, o.currency)}</span>
          </li>
        ))}</ul>
        <div className="space-y-1 border-t border-border px-5 py-3">
          {row(t("shop.cart.subtotal"), f.money(o.subtotal, o.currency))}
          {o.discount_total > 0 && row(`${t("shop.cart.discount")}${o.promo_code ? ` (${o.promo_code})` : ""}`, `−${f.money(o.discount_total, o.currency)}`)}
          {o.shipping_total > 0 && row(t("shop.cart.shipping"), f.money(o.shipping_total, o.currency))}
          {row(t("shop.cart.total"), <strong>{f.money(o.total, o.currency)}</strong>)}
        </div>
      </CardBody></Card>
    </div>
  );
}
