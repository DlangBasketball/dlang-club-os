import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Card, CardBody, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { FamilyRequestForm, type DeclaredAvailability } from "@/components/booking/portal/family-request-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getMyChildren } from "@/lib/attendance/family-data";
import { uuidParam } from "@/lib/attendance/family";
import { getFamilyBookingCatalog } from "@/lib/booking/data";
import { getThirdPartyCatalog } from "@/lib/public-entry/server";
import { getServiceInstalmentInfo } from "@/lib/booking/instalments-db";
import { getTrainingWizardData } from "@/lib/training/data";
import { getI18n } from "@/lib/i18n/server";
import { zonedDayKey } from "@/lib/staff/hours";
import { getParticipantChoices } from "@/lib/participants/server";
import { ParticipantNavPicker } from "@/components/participants/participant-nav-picker";

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
  const [kids, choices] = me?.orgId
    ? await Promise.all([getMyChildren(me.id, me.orgId), getParticipantChoices({ id: me.id, orgId: me.orgId, fullName: me.fullName })])
    : [[], null];
  const todayKey = zonedDayKey(new Date(), f.timeZone);
  const wanted = uuidParam(sp.athlete);
  // The self profile may sit outside the adult's families; it is bookable too.
  const bookable = choices ? choices.participants.map((p) => ({ id: p.id })) : kids;
  if (!bookable.length) {
    return <div className="animate-fade-up max-w-2xl space-y-5">{back}<PageHeader title={t("bookingRequests.family.title")} description={t("bookingRequests.family.description")} />
      {choices ? (
        <Card><CardBody>
          <ParticipantNavPicker participants={choices.participants} self={choices.self} hrefBase="/parent/bookings/request"
            activityDate={todayKey} legend={t("bookingRequests.family.child")} />
        </CardBody></Card>
      ) : <EmptyState title={t("bookingRequests.family.noChildren")} />}
    </div>;
  }
  const child = bookable.find((k) => k.id === wanted) ?? bookable[0];
  // "Someone else" (Workstream B): the booker's catalog (typed name only, no packages of the child's family).
  const isOther = choices?.participants.some((p) => p.id === child.id && p.kind === "other") ?? false;
  const [catalog, wizard] = await Promise.all([isOther ? getThirdPartyCatalog(child.id) : getFamilyBookingCatalog(child.id), getTrainingWizardData()]);
  if (catalog.error !== null) {
    return <div className="animate-fade-up max-w-2xl space-y-5">{back}<PageHeader title={t("bookingRequests.family.title")} />
      <ErrorState title={t("bookingRequests.family.loadError")} message={t.dynamic(`bookingWorkflow.errors.${catalog.error}`, undefined, t("bookingWorkflow.errors.generic"))} /></div>;
  }
  const instalmentInfo = catalog.data.enabled ? await getServiceInstalmentInfo(catalog.data.services.map((x) => x.id)) : null;
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
        <FamilyRequestForm kids={kids} catalog={catalog.data} declared={declared} todayKey={todayKey} instalmentInfo={instalmentInfo}
          participants={choices?.participants} self={choices?.self} />
      )}
    </div>
  );
}
