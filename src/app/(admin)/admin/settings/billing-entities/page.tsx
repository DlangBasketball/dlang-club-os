import { ErrorState } from "@/components/ui";
import { getBillingEntities } from "@/lib/data/billing";
import { getTranslations } from "@/lib/i18n/server";
import { BillingEntitiesEditor } from "@/components/billing/billing-entities-editor";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("billing.entities.tab") };
}

/** Settings -> Billing entities: issuing entities, routing per revenue category, invoice number prefixes. */
export default async function BillingEntitiesPage() {
  const [res, t] = await Promise.all([getBillingEntities(), getTranslations()]);
  if (res.error !== null) {
    return <ErrorState message={res.error === "NOT_AUTHORIZED" ? t("billing.errors.NOT_AUTHORIZED") : t("billing.errors.generic")} />;
  }
  return <BillingEntitiesEditor view={res.data} />;
}
