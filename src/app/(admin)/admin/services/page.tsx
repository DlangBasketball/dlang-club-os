import Link from "next/link";
import { Plus, Coins, CalendarClock, Dumbbell, Pencil } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, DataTable, Badge, statusTone, Button, EmptyState, ErrorState, type Column } from "@/components/ui";
import { listServices, getBookingSettings, type ServiceRow } from "@/lib/data/training-admin";
import { BookingSettingsForm } from "@/components/admin/booking-settings-form";
import { getI18n } from "@/lib/i18n/server";

export default async function AdminServicesPage() {
  const { t, f } = await getI18n();
  const [{ data, error }, settings] = await Promise.all([listServices(), getBookingSettings()]);
  if (error) return (<div className="animate-fade-up"><PageHeader title="Training services" /><ErrorState title="Couldn't load" message={error} /></div>);
  const services = data!;
  const columns: Column<ServiceRow>[] = [
    { key: "name", header: "Service", render: (s) => <Link href={`/admin/services/${s.id}`} className="font-medium text-ink hover:text-maroon">{s.name}</Link> },
    { key: "durationMin", header: "Duration", render: (s) => `${s.durationMin} min` },
    { key: "priceChf", header: "Price", align: "right", render: (s) => f.money(s.priceChf) },
    { key: "creditsRequired", header: "Credits", render: (s) => s.creditsRequired > 0 ? `${s.creditsRequired} ${s.creditCategory}` : "—" },
    { key: "isActive", header: "Status", render: (s) => <Badge tone={s.isActive ? "success" : "neutral"}>{s.isActive ? "active" : "inactive"}</Badge> },
    { key: "id", header: t("common.actions"), render: (s) => (
      <Link href={`/admin/services/${s.id}`} aria-label={t("editOps.services.editNamed", { name: s.name })}><Button size="sm" variant="secondary"><Pencil className="h-3.5 w-3.5" /> {t("common.edit")}</Button></Link>
    ) },
  ];
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title="Training services" description="Private and small-group session types."
        actions={<div className="flex gap-2">
          <Link href="/admin/credits"><Button variant="secondary" size="sm"><Coins className="h-4 w-4" /> Credits</Button></Link>
          <Link href="/admin/availability"><Button variant="secondary" size="sm"><CalendarClock className="h-4 w-4" /> Availability</Button></Link>
          <Link href="/admin/services/new"><Button size="sm"><Plus className="h-4 w-4" /> New service</Button></Link>
        </div>} />
      <DataTable columns={columns} rows={services} getRowKey={(s) => s.id}
        empty={<EmptyState icon={<Dumbbell className="h-5 w-5" />} title="No services yet" description="Create your first training service." />} />
      <Card>
        <CardHeader><CardTitle>Booking settings</CardTitle></CardHeader>
        <CardBody><BookingSettingsForm enabled={settings.enabled} cancellationHours={settings.cancellationHours} refundCreditsOnCancel={settings.refundCreditsOnCancel} /></CardBody>
      </Card>
    </div>
  );
}
