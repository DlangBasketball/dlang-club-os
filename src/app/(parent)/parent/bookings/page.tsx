import Link from "next/link";
import { Dumbbell, CalendarClock, Plus, ChevronRight } from "lucide-react";
import { PageHeader, Card, CardBody, Badge, statusTone, Button, EmptyState, ErrorState, Avatar } from "@/components/ui";
import { photoUrlsForCoaches } from "@/lib/people/server";
import { listBookings } from "@/lib/data/parent";
import { getBookingSettings } from "@/lib/data/training-admin";
import { getFormatter } from "@/lib/i18n/server";

export default async function ParentBookingsPage() {
  const f = await getFormatter();
  const [{ data: bookings, error }, settings] = await Promise.all([listBookings(), getBookingSettings()]);
  if (error) return (<div className="animate-fade-up"><PageHeader title="Bookings" /><ErrorState title="Couldn't load bookings" message={error} /></div>);
  const coachPhotos = await photoUrlsForCoaches((bookings ?? []).map((b) => b.coachId));
  const upcoming = (bookings ?? []).filter((b) => b.status === "booked" && new Date(b.start) >= new Date());
  const past = (bookings ?? []).filter((b) => !(b.status === "booked" && new Date(b.start) >= new Date()));

  const Row = ({ b }: { b: NonNullable<typeof bookings>[number] }) => (
    <Link href={`/parent/bookings/${b.id}`}>
      <Card className="transition active:scale-[0.99] hover:border-maroon/40"><CardBody className="flex items-center justify-between py-3">
        <div className="flex min-w-0 items-center gap-3"><Avatar name={b.coachName} src={coachPhotos[b.coachId] ?? null} size="lg" /><div className="min-w-0"><div className="text-sm font-medium text-ink">{b.serviceName}</div><div className="text-xs text-ink-3">{f.date(b.start)} · {f.time(b.start)} · {b.coachName}</div></div></div>
        <div className="flex items-center gap-2">{b.price !== null && b.price > 0 && <span className="tnum text-xs text-ink-3">{f.money(b.price)}</span>}<Badge tone={statusTone(b.status)}>{b.status}</Badge><ChevronRight className="h-4 w-4 text-ink-4" /></div>
      </CardBody></Card>
    </Link>
  );

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title="Training bookings" description="One-to-one and small-group sessions."
        actions={settings.enabled ? <Link href="/parent/bookings/new"><Button size="sm"><Plus className="h-4 w-4" /> Book a session</Button></Link> : undefined} />
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-2">Upcoming</h2>
        {upcoming.length === 0 ? (
          <EmptyState icon={<CalendarClock className="h-5 w-5" />} title="No upcoming bookings" description={settings.enabled ? "Book a session to get started." : "Bookings open soon."} />
        ) : <div className="space-y-2">{upcoming.map((b) => <Row key={b.id} b={b} />)}</div>}
      </section>
      {past.length > 0 && (
        <section><h2 className="mb-2 text-sm font-semibold text-ink-2">Past & cancelled</h2><div className="space-y-2">{past.map((b) => <Row key={b.id} b={b} />)}</div></section>
      )}
    </div>
  );
}
