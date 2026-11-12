import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader, Card, CardBody, Badge, statusTone, ErrorState } from "@/components/ui";
import { getAdminBookingFull } from "@/lib/data/booking-admin-detail";
import { BookingActions } from "@/components/booking/booking-actions";
import { getFormatter } from "@/lib/i18n/server";

export default async function AdminBookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const f = await getFormatter();
  const { id } = await params;
  const { data, error } = await getAdminBookingFull(id);
  if (error) return <ErrorState title="Couldn't load" message={error} />;
  if (!data) notFound();
  return (
    <div className="animate-fade-up max-w-2xl space-y-5">
      <PageHeader title={data.serviceName} description={`${data.athleteName} · with ${data.coachName}`}
        actions={<Badge tone={statusTone(data.status)}>{data.status}</Badge>} />
      <Card><CardBody className="space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-ink-3">When</span><span className="text-ink">{f.date(data.start)} · {f.time(data.start)}</span></div>
        <div className="flex justify-between"><span className="text-ink-3">Payment</span><span className="text-ink">{data.creditsUsed > 0 ? `${data.creditsUsed} credits` : data.price !== null ? f.money(data.price) : "—"}</span></div>
        {data.invoice && <div className="flex justify-between"><span className="text-ink-3">Invoice</span><Link href={`/admin/invoices/${data.invoice.id}`} className="text-maroon hover:underline">{data.invoice.number} ({data.invoice.status})</Link></div>}
      </CardBody></Card>
      {data.status === "booked" && (
        <Card><CardBody>
          <p className="mb-3 text-sm font-medium text-ink">Manage booking</p>
          <BookingActions bookingId={data.id} status={data.status} cancellationHours={0} slotStart={data.start} rescheduleSlots={data.rescheduleSlots} />
          <p className="mt-2 text-xs text-ink-3">As staff you can cancel or reschedule regardless of the cancellation window; credits and unpaid invoices are reversed.</p>
        </CardBody></Card>
      )}
    </div>
  );
}
