import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, ChevronLeft } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle, ErrorState, PageHeader } from "@/components/ui";
import { PackagesEditor, ServiceEditor } from "@/components/training/service-editor";
import { getTrainingService } from "@/lib/training/data";
import { getTranslations } from "@/lib/i18n/server";

export default async function EditServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, res] = await Promise.all([getTranslations(), getTrainingService(id)]);
  if (res.error !== null) return <ErrorState title={t("training.common.loadFailed")} message={res.error} />;
  const { service, venues, coaches } = res.data;
  if (!service) notFound();
  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <Link href="/admin/services" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {t("training.services.title")}</Link>
      <PageHeader title={service.name} description={t("training.services.editHint")}
        actions={<Link href="/admin/availability"><Button size="sm" variant="secondary"><CalendarClock className="h-4 w-4" /> {t("training.nav.availability")}</Button></Link>} />
      <Card><CardBody><ServiceEditor service={service} venues={venues} coaches={coaches} /></CardBody></Card>
      <Card>
        <CardHeader><CardTitle>{t("training.packages.title")}</CardTitle></CardHeader>
        <CardBody><PackagesEditor serviceId={service.id} packages={service.packages} singlePrice={service.price} currency={service.currency} /></CardBody>
      </Card>
    </div>
  );
}
