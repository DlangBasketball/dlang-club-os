import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, CardBody, EmptyState, statusTone } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { listMyOrders } from "@/lib/shop/data";

/** The signed-in member's shop orders (own and family orders, RLS-scoped). */
export default async function MyShopOrdersPage() {
  const me = await getSessionUser();
  if (!me?.orgId || !(await tenantMatchesOrg(me.orgId))) redirect("/login?next=/shop/orders");
  const [{ t, f }, orders] = await Promise.all([getI18n(me.orgId), listMyOrders(me.orgId)]);
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">{t("shop.myOrders")}</h1>
        <Link href="/shop" className="text-sm text-brand-primary hover:underline">{t("shop.continueShopping")}</Link>
      </div>
      {orders.length === 0 ? <EmptyState title={t("shop.orders.empty")} /> : (
        <Card><CardBody className="p-0">
          <ul>{orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3 last:border-0">
              <span className="font-mono text-sm">{o.number}</span>
              <span className="flex items-center gap-3 text-sm">
                <span className="text-text-muted">{f.date(o.created_at)}</span>
                <span className="tabular-nums">{f.money(o.total, o.currency)}</span>
                <Badge tone={statusTone(o.status)}>{t.dynamic(`shop.status.${o.status}`, undefined, o.status)}</Badge>
                {o.invoice_id && o.status === "pending_payment" && (
                  <Link href={`/parent/invoices/${o.invoice_id}`} className="text-brand-primary hover:underline">{t("shop.order.payNow")}</Link>
                )}
              </span>
            </li>
          ))}</ul>
        </CardBody></Card>
      )}
    </div>
  );
}
