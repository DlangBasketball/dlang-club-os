import { notFound, redirect } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { ProductForm } from "@/components/shop/product-form";
import { ProductImages, VariantManager } from "@/components/shop/variant-manager";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getAdminProduct, getPickupVenues } from "@/lib/shop/data";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [found, venues] = await Promise.all([getAdminProduct(me.orgId, id), getPickupVenues(me.orgId)]);
  if (!found) notFound();
  const { product: p, movements } = found;
  const canEdit = me.roles.includes("admin");
  const variantName = new Map(p.variants.map((v) => [v.id, v.label ?? v.sku ?? "—"]));
  return (
    <div className="animate-fade-up max-w-5xl space-y-5">
      <PageHeader title={p.name} eyebrow={t("shop.admin.title")} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>{t("shop.admin.details")}</CardTitle></CardHeader><CardBody>
          <ProductForm id={p.id} venues={venues} currency={p.currency} canEdit={canEdit} initial={{
            name: p.name, description: p.description ?? "", category: p.category ?? "", price: String(p.price), visibility: p.visibility,
            isActive: p.isActive, pickupAvailable: p.pickupAvailable, pickupVenueId: p.pickupVenueId ?? "", shippingAvailable: p.shippingAvailable,
            shippingFee: String(p.shippingFee), lowStockThreshold: String(p.lowStockThreshold), sortOrder: String(p.sortOrder),
          }} />
        </CardBody></Card>
        <Card><CardHeader><CardTitle>{t("shop.admin.images")}</CardTitle></CardHeader><CardBody>
          <ProductImages productId={p.id} images={p.images} canEdit={canEdit} />
        </CardBody></Card>
      </div>
      <Card><CardHeader><CardTitle>{t("shop.admin.variants")}</CardTitle></CardHeader><CardBody>
        <VariantManager productId={p.id} variants={p.variants} productPrice={p.price} currency={p.currency} lowStockThreshold={p.lowStockThreshold} canEdit={canEdit} />
      </CardBody></Card>
      <Card><CardHeader><CardTitle>{t("shop.admin.movements")}</CardTitle></CardHeader><CardBody className="p-0">
        {movements.length === 0 ? <p className="p-5 text-sm text-text-muted">{t("shop.admin.noMovements")}</p> : (
          <ul>{movements.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2.5 text-sm last:border-0">
              <span>{t(`shop.movements.${m.kind}`)} · {variantName.get(m.variant_id) ?? "—"}{m.reason ? ` · ${m.reason}` : ""}</span>
              <span className="tabular-nums text-text-muted">{m.quantity > 0 ? `+${m.quantity}` : m.quantity} → {m.stock_after} · {f.dateTime(m.created_at)}</span>
            </li>
          ))}</ul>
        )}
      </CardBody></Card>
    </div>
  );
}
