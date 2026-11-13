import Link from "next/link";
import { CalendarClock, Coins, Dumbbell, Pencil, Plus, Users } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, DataTable, EmptyState, ErrorState, PageHeader, type Column } from "@/components/ui";
import { listTrainingCatalog, getTrainingSettings, type TrainingService } from "@/lib/training/data";
import { TrainingSettingsForm } from "@/components/training/availability-editor";
import { venueLine } from "@/lib/training/format";
import { getI18n } from "@/lib/i18n/server";

export default async function AdminServicesPage() {
  const { t, f } = await getI18n();
  const [catalog, settings] = await Promise.all([listTrainingCatalog(), getTrainingSettings()]);
  if (catalog.error !== null) return (<div className="animate-fade-up"><PageHeader title={t("training.services.title")} /><ErrorState title={t("training.common.loadFailed")} message={catalog.error} /></div>);
  const { services, venues, coaches } = catalog.data;
  const columns: Column<TrainingService>[] = [
    { key: "name", header: t("training.service.name"), render: (s) => (
      <Link href={`/admin/services/${s.id}`} className="flex items-center gap-2 font-medium text-ink hover:text-maroon">
        {s.color && <span aria-hidden className="h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} />}{s.name}
      </Link>
    ) },
    { key: "sessionType", header: t("training.service.type"), render: (s) => s.sessionType === "group"
      ? <Badge tone="accent"><Users className="h-3 w-3" /> {t("training.common.groupRange", { min: s.minParticipants, max: s.maxParticipants })}</Badge>
      : <Badge tone="neutral">{t("training.common.individual")}</Badge> },
    { key: "durationMin", header: t("training.service.duration"), render: (s) => t("training.common.minutes", { count: s.durationMin }) },
    { key: "price", header: t("training.services.single"), align: "right", render: (s) => <span className="tnum">{f.money(s.price, s.currency ?? undefined)}</span> },
    { key: "packages", header: t("training.services.packages"), render: (s) => s.packages.filter((p) => p.isActive).map((p) => p.sessions).join(" · ") || "—" },
    { key: "coachIds", header: t("training.service.coaches"), render: (s) => s.coachIds.map((id) => coaches.find((c) => c.id === id)?.name).filter(Boolean).join(", ") || "—" },
    { key: "venueId", header: t("training.book.location"), render: (s) => s.locationText || venueLine(venues.find((v) => v.id === s.venueId)) || "—" },
    { key: "isActive", header: t("training.common.status"), render: (s) => <Badge tone={s.isActive ? "success" : "neutral"}>{s.isActive ? t("training.common.active") : t("training.common.inactive")}</Badge> },
    { key: "id", header: t("common.actions"), render: (s) => (
      <Link href={`/admin/services/${s.id}`} aria-label={t("training.services.editNamed", { name: s.name })}><Button size="sm" variant="secondary"><Pencil className="h-3.5 w-3.5" /> {t("common.edit")}</Button></Link>
    ) },
  ];
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("training.services.title")} description={t("training.services.description")}
        actions={<div className="flex flex-wrap gap-2">
          <Link href="/admin/training"><Button variant="secondary" size="sm"><Coins className="h-4 w-4" /> {t("training.nav.salesAndCredits")}</Button></Link>
          <Link href="/admin/availability"><Button variant="secondary" size="sm"><CalendarClock className="h-4 w-4" /> {t("training.nav.availability")}</Button></Link>
          <Link href="/admin/services/new"><Button size="sm"><Plus className="h-4 w-4" /> {t("training.services.new")}</Button></Link>
        </div>} />
      <DataTable columns={columns} rows={services as unknown as (TrainingService & Record<string, unknown>)[]} getRowKey={(s) => s.id}
        empty={<EmptyState icon={<Dumbbell className="h-5 w-5" />} title={t("training.services.empty")} description={t("training.services.emptyHint")} />} />
      <Card>
        <CardHeader><CardTitle>{t("training.settings.title")}</CardTitle></CardHeader>
        <CardBody><TrainingSettingsForm settings={settings} /></CardBody>
      </Card>
    </div>
  );
}
