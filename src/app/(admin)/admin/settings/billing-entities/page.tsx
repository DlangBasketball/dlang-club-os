import { ErrorState } from "@/components/ui";
import { getBillingEntities } from "@/lib/data/billing";
import { getTranslations } from "@/lib/i18n/server";
import { BillingEntitiesEditor } from "@/components/billing/billing-entities-editor";
import { MemberCardBrandsEditor } from "@/components/member-card/brands-editor";
import { CardCheckInSettingForm } from "@/components/member-card/check-in-setting";
import { getCardCheckInEnabled } from "@/lib/member-cards/check-in-setting";
import { listCardBrands } from "@/lib/member-cards/courtside-data";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("billing.entities.tab") };
}

/** Settings -> Billing entities: issuing entities, routing per revenue category, invoice number prefixes, member card brands. */
export default async function BillingEntitiesPage() {
  const [res, brands, t, checkIn] = await Promise.all([getBillingEntities(), listCardBrands(), getTranslations(), getCardCheckInEnabled()]);
  if (res.error !== null) {
    return <ErrorState message={res.error === "NOT_AUTHORIZED" ? t("billing.errors.NOT_AUTHORIZED") : t("billing.errors.generic")} />;
  }
  return (
    <div className="space-y-6">
      <BillingEntitiesEditor view={res.data} />
      {brands.ok && <MemberCardBrandsEditor rows={brands.rows} canEdit={brands.canEdit} />}
      {brands.ok && <CardCheckInSettingForm enabled={checkIn} canEdit={brands.canEdit} />}
    </div>
  );
}
