import { Card, CardBody, ErrorState, PageHeader } from "@/components/ui";
import { ServiceEditor } from "@/components/training/service-editor";
import { listTrainingCatalog } from "@/lib/training/data";
import { getTranslations } from "@/lib/i18n/server";

export default async function NewServicePage() {
  const [t, catalog] = await Promise.all([getTranslations(), listTrainingCatalog()]);
  if (catalog.error !== null) return <ErrorState title={t("training.common.loadFailed")} message={catalog.error} />;
  return (
    <div className="animate-fade-up max-w-3xl">
      <PageHeader title={t("training.services.new")} description={t("training.services.newHint")} />
      <Card><CardBody><ServiceEditor venues={catalog.data.venues} coaches={catalog.data.coaches} /></CardBody></Card>
    </div>
  );
}
