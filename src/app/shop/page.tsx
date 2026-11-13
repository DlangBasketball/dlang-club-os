import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LogIn, Receipt } from "lucide-react";
import { buttonVariants } from "@/components/ui";
import { Storefront } from "@/components/shop/storefront";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { getTenant, orgMatchesTenant } from "@/lib/tenant/server";
import { getPickupVenues, getStorefront, toCatalog } from "@/lib/shop/data";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const t = await getTranslations(tenant.id);
  return { title: t("shop.metaTitle", { club: tenant.name }) };
}

/**
 * Public shop of the request host's club. A signed-in member of that club
 * also sees members-only products and checks out as a member; anyone else
 * checks out as a guest (name + email).
 */
export default async function ShopPage() {
  const [tenant, me] = await Promise.all([getTenant(), getSessionUser()]);
  const member = !!me?.orgId && orgMatchesTenant(me.orgId, tenant);
  const orgId = member ? me!.orgId! : tenant.id;
  if (!orgId) notFound();
  const t = await getTranslations(orgId);
  const [products, venues] = await Promise.all([getStorefront(orgId, member), getPickupVenues(orgId)]);
  const currency = products[0]?.currency ?? tenant.currency;
  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-brand-primary">{tenant.name}</p>
          <h1 className="mt-1 font-display text-3xl font-semibold">{t("shop.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-text-muted">{t("shop.intro")}</p>
        </div>
        {member ? (
          <Link href="/shop/orders" className={buttonVariants({ variant: "secondary", size: "sm" })}><Receipt className="h-4 w-4" aria-hidden /> {t("shop.myOrders")}</Link>
        ) : (
          <Link href="/login?next=/shop" className={buttonVariants({ variant: "secondary", size: "sm" })}><LogIn className="h-4 w-4" aria-hidden /> {t("shop.memberSignIn")}</Link>
        )}
      </div>
      <Storefront orgId={orgId} products={products} catalog={toCatalog(products)} currency={currency} venues={venues}
        member={member ? { name: me?.fullName ?? "", email: me?.email ?? "" } : null} />
    </div>
  );
}
