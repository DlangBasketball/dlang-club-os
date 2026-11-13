import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, ShoppingBag } from "lucide-react";
import { Badge, Card, CardBody, EmptyState, Input, PageHeader, Select, buttonVariants, statusTone } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listOrders } from "@/lib/shop/data";
import { ORDER_STATUSES } from "@/lib/shop/validation";

export default async function ShopOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const [me, { t, f }, sp] = await Promise.all([getSessionUser(), getI18n(), searchParams]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const status = (ORDER_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : null;
  const q = (sp.q ?? "").slice(0, 80);
  const orders = await listOrders(me.orgId, { status, q });
  const exportQs = new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}) }).toString();
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("shop.orders.title")} eyebrow={<Link href="/admin/shop" className="hover:underline">{t("shop.admin.title")}</Link>}
        actions={<a href={`/admin/shop/orders/export${exportQs ? `?${exportQs}` : ""}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          <Download className="h-4 w-4" aria-hidden /> {t("shop.orders.export")}</a>} />
      <form className="flex flex-wrap gap-2" method="get">
        <Select name="status" defaultValue={status ?? ""} aria-label={t("shop.orders.status")} className="max-w-[14rem]">
          <option value="">{t("shop.orders.allStatuses")}</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{t(`shop.status.${s}`)}</option>)}
        </Select>
        <Input name="q" defaultValue={q} placeholder={t("shop.orders.searchPlaceholder")} aria-label={t("shop.orders.searchPlaceholder")} className="max-w-xs" maxLength={80} />
        <button type="submit" className={buttonVariants({ variant: "secondary", size: "md" })}>{t("shop.orders.filter")}</button>
      </form>
      {orders.length === 0 ? <EmptyState icon={<ShoppingBag />} title={t("shop.orders.empty")} /> : (
        <Card><CardBody className="p-0">
          <ul>
            {orders.map((o) => (
              <li key={o.id} className="border-b border-border last:border-0">
                <Link href={`/admin/shop/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-surface">
                  <span className="min-w-0">
                    <span className="font-mono text-sm text-text">{o.number}</span>
                    <span className="ml-2 text-sm text-text-secondary">{o.buyer_name}</span>
                    {o.is_guest && <Badge className="ml-2">{t("shop.orders.guest")}</Badge>}
                  </span>
                  <span className="flex items-center gap-3 text-sm">
                    <span className="text-text-muted">{f.date(o.created_at)}</span>
                    <span className="tabular-nums">{f.money(o.total, o.currency)}</span>
                    <Badge tone={statusTone(o.status)}>{t.dynamic(`shop.status.${o.status}`, undefined, o.status)}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CardBody></Card>
      )}
    </div>
  );
}
