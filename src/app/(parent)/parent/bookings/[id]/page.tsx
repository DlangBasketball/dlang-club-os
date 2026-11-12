import { notFound } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, Receipt } from "lucide-react";
import { PageHeader, Card, CardBody, Badge, statusTone, ErrorState, Avatar } from "@/components/ui";
import { photoUrlsForCoaches } from "@/lib/people/server";
import { getParentBookingDetail } from "@/lib/data/booking";
import { BookingActions } from "@/components/booking/booking-actions";
import { getFormatter } from "@/lib/i18n/server";

export default async function ParentBookingDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ confirmed?: string }> }) {
  const f = await getFormatter();
  const [{ id }, { confirmed }] = await Promise.all([params, searchParams]);
  const { data, error } = await getParentBookingDetail(id);
  if (error) return <ErrorState title="Couldn't load booking" message={error} />;
  if (!data) notFound();
  const coachPhotos = await photoUrlsForCoaches([data.coachId]);

  return (
    <div className="animate-fade-up max-w-xl space-y-5">
      <Link href="/parent/bookings" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> Bookings</Link>
      {confirmed && (
        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success-soft/40 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" />
          <div><p className="font-medium text-ink">Booking confirmed</p><p className="text-sm text-ink-3">We&apos;ve emailed you the details and notified the coach.</p></div>
        </div>
      )}
      <PageHeader title={data.serviceName} description={`${data.athleteName} · with ${data.coachName}`} actions={<Badge tone={statusTone(data.status)}>{data.status}</Badge>} />
      <Card><CardBody className="space-y-2 text-sm">
        <div className="flex items-center gap-3 pb-1"><Avatar name={data.coachName} src={coachPhotos[data.coachId] ?? null} size="lg" /><span className="font-medium text-ink">{data.coachName}</span></div>
        <div className="flex justify-between"><span className="text-ink-3">When</span><span className="text-ink">{f.date(data.start)} · {f.time(data.start)}</span></div>
        <div className="flex justify-between"><span className="text-ink-3">Payment</span><span className="text-ink">{data.creditsUsed > 0 ? `${data.creditsUsed} training credit(s)` : data.price !== null ? f.money(data.price) : "—"}</span></div>
        {data.invoice && <div className="flex justify-between"><span className="text-ink-3">Invoice</span><Link href={`/parent/invoices/${data.invoice.id}`} className="inline-flex items-center gap-1 text-maroon hover:underline"><Receipt className="h-3.5 w-3.5" />{data.invoice.number}</Link></div>}
      </CardBody></Card>
      {data.status === "booked" && (
        <Card><CardBody>
          <p className="mb-3 text-sm font-medium text-ink">Need to change this?</p>
          <BookingActions bookingId={data.id} status={data.status} cancellationHours={data.cancellationHours} slotStart={data.start} rescheduleSlots={data.rescheduleSlots} />
        </CardBody></Card>
      )}
    </div>
  );
}
