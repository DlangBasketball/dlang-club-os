import Link from "next/link";
import { CalendarClock, MapPin } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { AvailabilityEditor, VenueHoursEditor } from "@/components/training/availability-editor";
import { getAvailabilityData, listTrainingCatalog } from "@/lib/training/data";
import { venueLine } from "@/lib/training/format";
import { getTranslations } from "@/lib/i18n/server";

export default async function AdminAvailabilityPage({ searchParams }: { searchParams: Promise<{ coach?: string }> }) {
  const [{ coach }, t, catalog] = await Promise.all([searchParams, getTranslations(), listTrainingCatalog()]);
  if (catalog.error !== null) return (<div className="animate-fade-up"><PageHeader title={t("training.availability.title")} /><ErrorState title={t("training.common.loadFailed")} message={catalog.error} /></div>);
  const coaches = catalog.data.coaches.filter((c) => c.isActive);
  const selected = coaches.find((c) => c.id === coach)?.id ?? coaches[0]?.id ?? "";
  const avail = await getAvailabilityData({ coachId: selected || null });

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("training.availability.title")} description={t("training.availability.description")} />
      {coaches.length === 0 ? (
        <EmptyState icon={<CalendarClock className="h-5 w-5" />} title={t("training.availability.noCoaches")} />
      ) : (
        <>
          <nav aria-label={t("training.book.coach")} className="flex flex-wrap gap-2">
            {coaches.map((c) => (
              <Link key={c.id} href={`/admin/availability?coach=${c.id}`} aria-current={c.id === selected ? "page" : undefined}
                className={`rounded-full border px-3 py-1.5 text-sm ${c.id === selected ? "border-maroon bg-maroon/10 text-ink" : "border-line text-ink-3 hover:text-ink"}`}>{c.name}</Link>
            ))}
          </nav>
          <Card><CardBody>
            {avail.error !== null ? <ErrorState title={t("training.common.loadFailed")} message={avail.error} />
              : <AvailabilityEditor coachId={selected} data={avail.data} venues={catalog.data.venues} services={catalog.data.services} isAdmin />}
          </CardBody></Card>
        </>
      )}
      <Card>
        <CardHeader><CardTitle>{t("training.venue.title")}</CardTitle></CardHeader>
        <CardBody className="space-y-5">
          <p className="text-sm text-ink-3">{t("training.venue.hint")} <Link href="/admin/schedule/venues" className="text-maroon underline">{t("training.venue.manage")}</Link></p>
          {catalog.data.venues.filter((v) => v.isActive).length === 0 && <EmptyState icon={<MapPin className="h-5 w-5" />} title={t("training.venue.none")} />}
          {catalog.data.venues.filter((v) => v.isActive).map((v) => (
            <div key={v.id} className="space-y-2 border-t border-line pt-4 first:border-t-0 first:pt-0">
              <h3 className="text-sm font-medium text-ink">{venueLine(v)}</h3>
              <VenueHoursEditor venue={v} />
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
