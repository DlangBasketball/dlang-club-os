import Link from "next/link";
import { redirect } from "next/navigation";
import { Package, Plus, ShoppingBag } from "lucide-react";
import { Badge, Card, CardBody, EmptyState, PageHeader, buttonVariants } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listAdminProducts } from "@/lib/shop/data";

export default async function ShopAdminPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const products = await listAdminProducts(me.orgId);
  const isAdmin = me.roles.includes("admin");
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("shop.admin.title")} description={t("shop.admin.description")} actions={<>
        <Link href="/admin/shop/orders" className={buttonVariants({ variant: "secondary", size: "sm" })}><ShoppingBag className="h-4 w-4" aria-hidden /> {t("shop.orders.title")}</Link>
        <Link href="/shop" className={buttonVariants({ variant: "ghost", size: "sm" })}>{t("shop.admin.viewShop")}</Link>
        {isAdmin && <Link href="/admin/shop/new" className={buttonVariants({ size: "sm" })}><Plus className="h-4 w-4" aria-hidden /> {t("shop.admin.newProduct")}</Link>}
      </>} />
      {products.length === 0 ? (
        <EmptyState icon={<Package />} title={t("shop.admin.empty")} description={t("shop.admin.emptyHint")} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {products.map((p) => (
            <li key={p.id}>
              <Link href={`/admin/shop/${p.id}`} className="block h-full">
                <Card className="h-full transition hover:border-brand-primary/60">
                  <CardBody className="flex gap-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-surface-elevated">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.images[0] ? <img src={p.images[0].url} alt="" className="h-full w-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate font-medium text-text">{p.name}</p>
                      <p className="text-sm text-text-muted">{f.money(p.price, p.currency)} · {t("shop.admin.inStock", { count: p.totalStock })}</p>
                      <div className="flex flex-wrap gap-1">
                        {!p.isActive && <Badge>{t("shop.admin.inactive")}</Badge>}
                        {p.visibility === "members" && <Badge tone="accent">{t("shop.admin.visibilityMembers")}</Badge>}
                        {p.lowStock && <Badge tone="warning">{t("shop.admin.lowStockBadge")}</Badge>}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
