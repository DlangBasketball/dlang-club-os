import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { FamilyRequestForm, type DeclaredAvailability } from "@/components/booking/portal/family-request-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getMyChildren } from "@/lib/attendance/family-data";
import { uuidParam } from "@/lib/attendance/family";
import { getFamilyBookingCatalog } from "@/lib/booking/data";
import { getTrainingWizardData } from "@/lib/training/data";
import { getI18n } from "@/lib/i18n/server";
import { zonedDayKey } from "@/lib/staff/hours";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("bookingRequests.family.title") };
}

/**
 * Parent request form: a guardian asks for a session for their own child
 * (service bookable by families, preferred time inside the venue hours,
 * optional coach, or a group session with free places). The club / coach
 * confirms it; the payer is the family. Every check runs again on the server
 * (family_booking_catalog, booking_family_quote, booking_family_request).
 */
export default async function ParentBookingRequestPage({ searchParams }: { searchParams: Promise<{ athlete?: string }> }) {
  const [{ t, f }, me, sp] = await Promise.all([getI18n(), getSessionUser(), searchParams]);
  const back = (
    <Link href="/parent/bookings" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
      <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> {t("bookingRequests.family.back")}
    </Link>
  );
  const kids = me?.orgId ? await getMyChildren(me.id, me.orgId) : [];
  if (!kids.length) {
    return <div className="animate-fade-up max-w-2xl space-y-5">{back}<PageHeader title={t("bookingRequests.family.title")} />
      <EmptyState title={t("bookingRequests.family.noChildren")} /></div>;
  }
  const wanted = uuidParam(sp.athlete);
  const child = kids.find((k) => k.id === wanted) ?? kids[0];
  const [catalog, wizard] = await Promise.all([getFamilyBookingCatalog(child.id), getTrainingWizardData()]);
  if (catalog.error !== null) {
    return <div className="animate-fade-up max-w-2xl space-y-5">{back}<PageHeader title={t("bookingRequests.family.title")} />
      <ErrorState title={t("bookingRequests.family.loadError")} message={t.dynamic(`bookingWorkflow.errors.${catalog.error}`, undefined, t("bookingWorkflow.errors.generic"))} /></div>;
  }
  // Declared coach availability for the "show availability" hints: times only, no blackout reasons, no other family's data.
  const w = wizard.data;
  const declared: DeclaredAvailability | null = w ? {
    templates: w.availability.templates.filter((x) => x.isActive).map((x) => ({
      coachId: x.coachId, venueId: x.venueId, serviceId: x.serviceId, weekday: x.weekday, startTime: x.startTime, endTime: x.endTime,
      capacity: x.capacity, validFrom: x.validFrom ?? null, validUntil: x.validUntil ?? null,
    })),
    windows: w.availability.windows.map((x) => ({ coachId: x.coachId, venueId: x.venueId, serviceId: x.serviceId, startsAt: x.startsAt, endsAt: x.endsAt, capacity: x.capacity })),
    blackouts: w.availability.blackouts.map((x) => ({ coachId: x.coachId, venueId: x.venueId, startsAt: x.startsAt, endsAt: x.endsAt })),
    busy: w.busy,
    venueHours: Object.fromEntries(w.venues.map((v) => [v.id, v.openingHours])),
    stepMin: w.settings.slotStepMin,
  } : null;

  return (
    <div className="animate-fade-up max-w-2xl space-y-5">
      {back}
      <PageHeader title={t("bookingRequests.family.title")} description={t("bookingRequests.family.description")} />
      {!catalog.data.enabled ? (
        <EmptyState title={t("bookingRequests.family.disabled")} />
      ) : catalog.data.services.length === 0 ? (
        <EmptyState title={t("bookingRequests.family.noServices")} />
      ) : (
        <FamilyRequestForm kids={kids} catalog={catalog.data} declared={declared} todayKey={zonedDayKey(new Date(), f.timeZone)} />
      )}
    </div>
  );
}
