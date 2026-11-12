import Link from "next/link";
import { ClipboardList, Pencil, Plus } from "lucide-react";
import { PageHeader, Button, DataTable, Badge, statusTone, EmptyState, ErrorState, Avatar, type Column } from "@/components/ui";
import { photoUrlsForCoaches } from "@/lib/people/server";
import { listAllBookings, type AdminBooking } from "@/lib/data/training-admin";
import { getI18n } from "@/lib/i18n/server";

export default async function AdminBookingsPage() {
  const { t, f } = await getI18n();
  const { data, error } = await listAllBookings();
  if (error) return (<div className="animate-fade-up"><PageHeader title="Bookings" /><ErrorState title="Couldn't load" message={error} /></div>);
  const coachPhotos = await photoUrlsForCoaches(data!.map((b) => b.coachId));
  const columns: Column<AdminBooking>[] = [
    { key: "athleteName", header: "Athlete", render: (b) => <Link href={`/admin/bookings/${b.id}`} className="font-medium text-ink hover:text-maroon">{b.athleteName}</Link> },
    { key: "serviceName", header: "Service" },
    { key: "coachName", header: "Coach", render: (b) => <span className="flex items-center gap-2"><Avatar name={b.coachName} src={coachPhotos[b.coachId] ?? null} size="sm" />{b.coachName}</span> },
    { key: "start", header: "When", render: (b) => `${f.date(b.start)} ${f.time(b.start)}` },
    { key: "price", header: "Paid", render: (b) => b.creditsUsed > 0 ? `${b.creditsUsed} credits` : b.price !== null ? f.money(b.price) : "—" },
    { key: "status", header: "Status", render: (b) => <Badge tone={statusTone(b.status)}>{t.dynamic(`editOps.bookings.statuses.${b.status}`, undefined, b.status)}</Badge> },
    { key: "id", header: t("common.actions"), render: (b) => b.status === "cancelled" ? null : (
      <Link href={`/admin/bookings/${b.id}`} className="inline-flex items-center gap-1 text-xs text-maroon hover:underline"><Pencil className="h-3 w-3" />{t("common.edit")}</Link>
    ) },
  ];
  return (
    <div className="animate-fade-up">
      <PageHeader title={t("training.adminBookings.title")} description={t("training.adminBookings.description")}
        actions={<Link href="/admin/bookings/new"><Button size="sm"><Plus className="h-4 w-4" /> {t("training.adminBookings.new")}</Button></Link>} />
      <DataTable columns={columns} rows={data!} getRowKey={(b) => b.id}
        empty={<EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No bookings yet" />} />
    </div>
  );
}
