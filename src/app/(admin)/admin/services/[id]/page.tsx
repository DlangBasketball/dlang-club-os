import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, ChevronLeft } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle, ErrorState, PageHeader } from "@/components/ui";
import { PackagesEditor, ServiceEditor } from "@/components/training/service-editor";
import { getTrainingService } from "@/lib/training/data";
import { getTranslations } from "@/lib/i18n/server";
import { ServiceBookingSetup } from "@/components/booking/admin/service-booking-setup";
import { getServiceCatalog } from "@/lib/booking/data";
import { getCoachOptions, getSpaceOptions } from "@/lib/booking/admin-data";
import { getSessionUser } from "@/lib/auth/get-user";

export default async function EditServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, res, me, catalog] = await Promise.all([getTranslations(), getTrainingService(id), getSessionUser(), getServiceCatalog({ includeInactive: true })]);
  if (res.error !== null) return <ErrorState title={t("training.common.loadFailed")} message={res.error} />;
  const { service, venues, coaches } = res.data;
  if (!service) notFound();
  const orgId = me?.orgId ?? "";
  const entry = (catalog.data ?? []).find((c) => c.id === service.id) ?? null;
  const [bookingCoaches, spaces] = entry ? await Promise.all([getCoachOptions(orgId), getSpaceOptions(orgId)]) : [[], []];
  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <Link href="/admin/services" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {t("training.services.title")}</Link>
      <PageHeader title={service.name} description={t("training.services.editHint")}
        actions={<Link href="/admin/availability"><Button size="sm" variant="secondary"><CalendarClock className="h-4 w-4" /> {t("training.nav.availability")}</Button></Link>} />
      <Card><CardBody><ServiceEditor service={service} venues={venues} coaches={coaches} /></CardBody></Card>
      {entry && (
        <Card>
          <CardHeader><CardTitle>{t("adminBooking.services.title")}</CardTitle></CardHeader>
          <CardBody>
            <ServiceBookingSetup serviceId={service.id} canEdit={!!me?.roles.includes("admin")} coaches={bookingCoaches} spaces={spaces}
              setupMissing={entry.setup_missing} numberPrefix={entry.number_prefix}
              initial={{ kind: entry.kind, billingCategory: entry.billing_category, defaultVenueSpaceId: entry.default_venue_space_id, maxParticipants: entry.max_participants, coachIds: entry.coaches.map((c) => c.id) }} />
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>{t("training.packages.title")}</CardTitle></CardHeader>
        <CardBody><PackagesEditor serviceId={service.id} packages={service.packages} singlePrice={service.price} currency={service.currency} /></CardBody>
      </Card>
    </div>
  );
}
