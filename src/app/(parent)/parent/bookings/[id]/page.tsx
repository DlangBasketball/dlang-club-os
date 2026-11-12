import { notFound } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, Receipt } from "lucide-react";
import { Avatar, Badge, Card, CardBody, ErrorState, PageHeader, statusTone } from "@/components/ui";
import { photoUrlsForCoaches } from "@/lib/people/server";
import { getParentBookingDetail } from "@/lib/data/booking";
import { getTrainingWizardData } from "@/lib/training/data";
import { TrainingBookingActions } from "@/components/training/admin-widgets";
import { getI18n } from "@/lib/i18n/server";

export default async function ParentBookingDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ confirmed?: string }> }) {
  const { t, f } = await getI18n();
  const [{ id }, { confirmed }] = await Promise.all([params, searchParams]);
  const { data, error } = await getParentBookingDetail(id);
  if (error) return <ErrorState title={t("training.common.loadFailed")} message={error} />;
  if (!data) notFound();
  const [coachPhotos, wizard] = await Promise.all([
    photoUrlsForCoaches([data.coachId]),
    data.status === "booked" ? getTrainingWizardData() : Promise.resolve(null),
  ]);
  const statusLabel = t.dynamic(`training.bookingStatus.${data.status}`, undefined, data.status);

  return (
    <div className="animate-fade-up max-w-xl space-y-5">
      <Link href="/parent/bookings" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {t("training.book.back")}</Link>
      {confirmed && (
        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success-soft/40 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" />
          <div><p className="font-medium text-ink">{t("training.book.booked")}</p><p className="text-sm text-ink-3">{t("training.manage.confirmedHint")}</p></div>
        </div>
      )}
      <PageHeader title={data.serviceName} description={t("training.manage.subtitle", { athlete: data.athleteName, coach: data.coachName })} actions={<Badge tone={statusTone(data.status)}>{statusLabel}</Badge>} />
      <Card><CardBody className="space-y-2 text-sm">
        <div className="flex items-center gap-3 pb-1"><Avatar name={data.coachName} src={coachPhotos[data.coachId] ?? null} size="lg" /><span className="font-medium text-ink">{data.coachName}</span></div>
        <div className="flex justify-between"><span className="text-ink-3">{t("training.book.when")}</span><span className="text-ink">{f.date(data.start, { weekday: true })} · {f.time(data.start)}{data.end ? ` – ${f.time(data.end)}` : ""}</span></div>
        <div className="flex justify-between"><span className="text-ink-3">{t("training.book.payment")}</span><span className="text-ink">{data.creditsUsed > 0 ? t("training.profile.paidCredits", { count: data.creditsUsed }) : data.price !== null ? f.money(data.price) : "—"}</span></div>
        {data.invoice && <div className="flex justify-between"><span className="text-ink-3">{t("training.purchases.invoice")}</span><Link href={`/parent/invoices/${data.invoice.id}`} className="inline-flex items-center gap-1 text-maroon hover:underline"><Receipt className="h-3.5 w-3.5" />{data.invoice.number}</Link></div>}
      </CardBody></Card>
      {data.status === "booked" && wizard?.data && (
        <Card><CardBody>
          <p className="mb-3 text-sm font-medium text-ink">{t("training.manage.change")}</p>
          <TrainingBookingActions bookingId={data.id} serviceId={data.serviceId} slotStart={data.start} data={wizard.data} />
        </CardBody></Card>
      )}
    </div>
  );
}
