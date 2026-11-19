import { redirect } from "next/navigation";
import { Card, CardBody, PageHeader } from "@/components/ui";
import { EMPTY_PRODUCT, ProductForm } from "@/components/shop/product-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getPickupVenues } from "@/lib/shop/data";

export default async function NewProductPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("admin")) redirect("/admin/shop");
  const venues = await getPickupVenues(me.orgId);
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader title={t("shop.admin.newProduct")} eyebrow={t("shop.admin.title")} />
      <Card><CardBody><ProductForm id={null} initial={EMPTY_PRODUCT} venues={venues} currency={f.currency} canEdit /></CardBody></Card>
    </div>
  );
}
