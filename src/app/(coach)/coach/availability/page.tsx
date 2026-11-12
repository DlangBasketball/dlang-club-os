import { CalendarClock } from "lucide-react";
import { Card, CardBody, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { AvailabilityEditor } from "@/components/training/availability-editor";
import { getMyCoach } from "@/lib/data/training-admin";
import { getAvailabilityData, listTrainingCatalog } from "@/lib/training/data";
import { getTranslations } from "@/lib/i18n/server";

export default async function CoachAvailabilityPage() {
  const [t, me] = await Promise.all([getTranslations(), getMyCoach()]);
  if (!me) return (<div className="animate-fade-up"><PageHeader title={t("training.availability.mine")} /><EmptyState icon={<CalendarClock className="h-5 w-5" />} title={t("training.availability.noCoachProfile")} description={t("training.availability.noCoachProfileHint")} /></div>);
  const [catalog, avail] = await Promise.all([listTrainingCatalog({ activeOnly: true }), getAvailabilityData({ coachId: me.id })]);
  if (catalog.error !== null || avail.error !== null) return <ErrorState title={t("training.common.loadFailed")} message={catalog.error ?? avail.error ?? ""} />;
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("training.availability.mine")} description={t("training.availability.mineHint")} />
      <Card><CardBody>
        <AvailabilityEditor coachId={me.id} data={avail.data} venues={catalog.data.venues} services={catalog.data.services.filter((s) => s.coachIds.includes(me.id))} isAdmin={false} />
      </CardBody></Card>
    </div>
  );
}
