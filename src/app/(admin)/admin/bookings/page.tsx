import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { PageHeader, DataTable, Badge, statusTone, EmptyState, ErrorState, type Column } from "@/components/ui";
import { listAllBookings, type AdminBooking } from "@/lib/data/training-admin";
import { getFormatter } from "@/lib/i18n/server";

export default async function AdminBookingsPage() {
  const f = await getFormatter();
  const { data, error } = await listAllBookings();
  if (error) return (<div className="animate-fade-up"><PageHeader title="Bookings" /><ErrorState title="Couldn't load" message={error} /></div>);
  const columns: Column<AdminBooking>[] = [
    { key: "athleteName", header: "Athlete", render: (b) => <Link href={`/admin/bookings/${b.id}`} className="font-medium text-ink hover:text-maroon">{b.athleteName}</Link> },
    { key: "serviceName", header: "Service" },
    { key: "coachName", header: "Coach" },
    { key: "start", header: "When", render: (b) => `${f.date(b.start)} ${f.time(b.start)}` },
    { key: "price", header: "Paid", render: (b) => b.creditsUsed > 0 ? `${b.creditsUsed} credits` : b.price !== null ? f.money(b.price) : "—" },
    { key: "status", header: "Status", render: (b) => <Badge tone={statusTone(b.status)}>{b.status}</Badge> },
  ];
  return (
    <div className="animate-fade-up">
      <PageHeader title="Training bookings" description="All private and small-group session bookings." />
      <DataTable columns={columns} rows={data!} getRowKey={(b) => b.id}
        empty={<EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No bookings yet" />} />
    </div>
  );
}
