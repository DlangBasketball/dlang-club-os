import Link from "next/link";
import { CalendarPlus, Plus } from "lucide-react";
import { Button, ErrorState, PageHeader } from "@/components/ui";
import { BookedAttendance, BookingChanges, BookingInvoices, UpcomingBookings } from "@/components/booking/portal/family-bookings";
import { getGuardianBookings } from "@/lib/booking/data";
import { flattenAttendance, flattenChanges, flattenInvoices, flattenUpcoming, invoiceByBooking } from "@/lib/booking/portal";
import { uuidParam } from "@/lib/attendance/family";
import { getBookingSettings } from "@/lib/data/training-admin";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { getSessionUser } from "@/lib/auth/get-user";
import { guardianKids } from "@/lib/camps/parent-kids";
import { listFamilyCampRegistrations } from "@/lib/camps/approval-data";
import { FamilyCampRegistrations } from "@/components/camps/family-camp-registrations";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("bookingPortal.family.title") };
}

/**
 * Parent bookings: per own child, upcoming booked sessions (service, time in
 * the club's time zone, coach, place), schedule changes (moved / cancelled
 * with the reason), finalized attendance of booked sessions, and invoices of
 * bookings only where the guardian is the payer. Reads
 * guardian_booking_overview, which re-checks guardianship on the server.
 */
export default async function ParentBookingsPage({ searchParams }: { searchParams: Promise<{ athlete?: string; camp?: string }> }) {
  const sp = await searchParams;
  const [{ t, f }, overview, settings, me] = await Promise.all([getI18n(), getGuardianBookings(), getBookingSettings(), getSessionUser()]);
  // Camp weeks of the guardian's own children (incl. requests pending approval).
  const campKids = me?.orgId ? await guardianKids(me.id, me.orgId) : [];
  const campRows = me?.orgId ? await listFamilyCampRegistrations(me.orgId, campKids.map((k) => k.id)) : [];
  const campNotice = sp.camp === "requested"
    ? <div role="status" className="rounded-md border border-info/40 bg-info-soft px-4 py-3 text-sm text-text">{t("camps.approval.parent.requested")}</div>
    : null;
  const title = t("bookingPortal.family.title");
  const action = settings.enabled
    ? (
      <div className="flex flex-wrap gap-2">
        <Link href="/parent/bookings/request"><Button size="sm" variant="secondary"><CalendarPlus className="h-4 w-4" aria-hidden /> {t("bookingRequests.family.requestCta")}</Button></Link>
        <Link href="/parent/bookings/new"><Button size="sm"><Plus className="h-4 w-4" aria-hidden /> {t("bookingPortal.family.book")}</Button></Link>
      </div>
    )
    : undefined;

  if (overview.error || !overview.data) {
    return (
      <div className="animate-fade-up space-y-5">
        <PageHeader title={title} actions={action} />
        {campNotice}
        <FamilyCampRegistrations rows={campRows} t={t} f={f} showChild={campKids.length > 1} />
        <ErrorState title={t("bookingPortal.family.loadError")} message={t("bookingPortal.family.loadErrorHint")} />
      </div>
    );
  }

  const all = overview.data;
  const wanted = uuidParam(sp.athlete);
  const kids = wanted && all.some((o) => o.athlete.id === wanted) ? all.filter((o) => o.athlete.id === wanted) : all;
  const showChild = kids.length > 1;
  const invoices = invoiceByBooking(kids);

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={title} description={t("bookingPortal.family.description")} actions={action} />

      {all.length > 1 && (
        <nav aria-label={t("bookingPortal.family.childTabs")} className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1">
          <Link href="/parent/bookings" aria-current={kids.length === all.length ? "page" : undefined}
            className={cn("flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-center text-sm transition-colors",
              kids.length === all.length ? "bg-brand-primary-soft text-text" : "text-text-muted hover:text-text")}>
            {t("bookingPortal.family.allChildren")}
          </Link>
          {all.map((o) => {
            const current = kids.length === 1 && kids[0].athlete.id === o.athlete.id;
            return (
              <Link key={o.athlete.id} href={`/parent/bookings?athlete=${o.athlete.id}`} aria-current={current ? "page" : undefined}
                className={cn("flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-center text-sm transition-colors",
                  current ? "bg-brand-primary-soft text-text" : "text-text-muted hover:text-text")}>
                {o.athlete.first_name} {o.athlete.last_name}
              </Link>
            );
          })}
        </nav>
      )}

      {campNotice}
      <FamilyCampRegistrations rows={wanted ? campRows.filter((r) => r.athleteId === wanted) : campRows} t={t} f={f} showChild={showChild || (!wanted && campKids.length > 1)} />

      <UpcomingBookings rows={flattenUpcoming(kids)} t={t} f={f} showChild={showChild} familyActions
        detailHref={(id) => `/parent/bookings/${id}`} invoiceFor={(id) => invoices.get(id)} />
      <BookingChanges rows={flattenChanges(kids)} t={t} f={f} showChild={showChild} />
      <BookedAttendance rows={flattenAttendance(kids)} t={t} f={f} showChild={showChild} />
      <BookingInvoices rows={flattenInvoices(kids)} t={t} f={f} showChild={showChild} />
    </div>
  );
}
