import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, statusTone, ErrorState, Avatar } from "@/components/ui";
import { photoUrlsForCoaches } from "@/lib/people/server";
import { getAdminBookingFull } from "@/lib/data/booking-admin-detail";
import { BookingActions } from "@/components/booking/booking-actions";
import { BookingEditor } from "@/components/booking/booking-editor";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";

export default async function AdminBookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ t, f }, me] = await Promise.all([getI18n(), getSessionUser()]);
  const { id } = await params;
  const { data, error } = await getAdminBookingFull(id);
  if (error) return <ErrorState title={t("editOps.common.loadFailed")} message={error} />;
  if (!data) notFound();
  const isAdmin = !!me?.roles.includes("admin");
  const coachPhotos = await photoUrlsForCoaches([data.coachId]);
  const statusLabel = t.dynamic(`editOps.bookings.statuses.${data.status}`, undefined, data.status);
  return (
    <div className="animate-fade-up max-w-2xl space-y-5">
      <PageHeader title={data.serviceName} description={t("editOps.bookings.subtitle", { athlete: data.athleteName, coach: data.coachName })}
        actions={<Badge tone={statusTone(data.status)}>{statusLabel}</Badge>} />
      <Card><CardBody className="space-y-2 text-sm">
        <Link href={`/admin/coaches/${data.coachId}`} className="flex items-center gap-3 pb-1 text-ink hover:text-maroon"><Avatar name={data.coachName} src={coachPhotos[data.coachId] ?? null} size="lg" /><span className="font-medium">{data.coachName}</span></Link>
        <div className="flex justify-between"><span className="text-ink-3">{t("editOps.bookings.when")}</span><span className="text-ink">{f.date(data.start)} · {f.time(data.start)}{data.end ? `–${f.time(data.end)}` : ""}</span></div>
        <div className="flex justify-between"><span className="text-ink-3">{t("editOps.bookings.payment")}</span><span className="text-ink">{data.creditsUsed > 0 ? t("editOps.bookings.credits", { count: data.creditsUsed }) : data.price !== null ? f.money(data.price) : "—"}</span></div>
        {data.invoice && <div className="flex justify-between"><span className="text-ink-3">{t("editOps.bookings.invoice")}</span><Link href={`/admin/invoices/${data.invoice.id}`} className="text-maroon hover:underline">{data.invoice.number} ({data.invoice.status})</Link></div>}
        {data.status === "cancelled" && (
          <div className="flex justify-between gap-4"><span className="text-ink-3">{t("editOps.bookings.cancelled")}</span>
            <span className="text-right text-ink">{data.cancelledAt ? f.dateTime(data.cancelledAt) : ""}{data.cancelReason ? ` · ${data.cancelReason}` : ""}</span></div>
        )}
      </CardBody></Card>
      {isAdmin && data.status !== "cancelled" && (
        <Card>
          <CardHeader><CardTitle>{t("editOps.bookings.editTitle")}</CardTitle></CardHeader>
          <CardBody>
            <BookingEditor bookingId={data.id} status={data.status} serviceId={data.serviceId} coachId={data.coachId} start={data.start} end={data.end}
              notes={data.notes} services={data.serviceOptions} coaches={data.coachOptions} />
          </CardBody>
        </Card>
      )}
      {data.status === "booked" && (
        <Card><CardBody>
          <p className="mb-3 text-sm font-medium text-ink">{t("editOps.bookings.moveToSlot")}</p>
          <BookingActions bookingId={data.id} status={data.status} cancellationHours={0} slotStart={data.start} rescheduleSlots={data.rescheduleSlots} hideCancel={isAdmin} />
          <p className="mt-2 text-xs text-ink-3">{t("editOps.bookings.staffHint")}</p>
        </CardBody></Card>
      )}
    </div>
  );
}
