import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ErrorState, PageHeader } from "@/components/ui";
import { NewBookingForm } from "@/components/booking/admin/new-booking-form";
import { NewOrderForm } from "@/components/booking/admin/new-order-form";
import { getServiceCatalog } from "@/lib/booking/data";
import { getCoachOptions, getSpaceOptions } from "@/lib/booking/admin-data";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { zonedDayKey } from "@/lib/staff/hours";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("adminBooking.form.title") };
}

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * New booking (admin / finance): a booking order (single session, package,
 * group; one or several dates or a weekly rule) — docs/booking-workflow.md §13.
 * ?athlete=<id> preselects the athlete; ?classic=1 opens the single-booking
 * form (promo codes, joining one open group session).
 */
export default async function AdminNewBookingPage({ searchParams }: { searchParams: Promise<{ athlete?: string; classic?: string }> }) {
  const me = await requireRole(["admin", "finance"]);
  const [{ athlete, classic }, { t, f }] = await Promise.all([searchParams, getI18n()]);
  const orgId = me.orgId as string;
  const [catalog, coaches, spaces] = await Promise.all([getServiceCatalog(), getCoachOptions(orgId), getSpaceOptions(orgId)]);
  const back = (
    <Link href="/admin/bookings" className="mb-2 inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
      <ChevronLeft className="h-3.5 w-3.5" /> {t("adminBooking.list.title")}
    </Link>
  );
  if (catalog.error !== null) {
    return <div className="animate-fade-up">{back}<PageHeader title={t("adminBooking.form.title")} /><ErrorState title={t("adminBooking.common.loadFailed")} message={t.dynamic(`bookingWorkflow.errors.${catalog.error}`, undefined, t("bookingWorkflow.errors.generic"))} /></div>;
  }
  let initialAthlete: { id: string; label: string; familyId: string } | null = null;
  if (athlete && UUID.test(athlete)) {
    const { data } = await (await createClient()).from("athletes").select("id,first_name,last_name,family_id").eq("org_id", orgId).eq("id", athlete).maybeSingle();
    if (data) initialAthlete = { id: data.id, label: `${data.first_name} ${data.last_name}`, familyId: data.family_id };
  }
  return (
    <div className="animate-fade-up">
      {back}
      <PageHeader title={t("adminBooking.form.title")} description={t("adminBooking.form.description")} />
      {catalog.data.length === 0 ? (
        <ErrorState title={t("adminBooking.form.noServices")} message={t("adminBooking.form.noServicesHint")} />
      ) : (
        classic === "1" ? (
          <>
            <p className="mb-4 text-xs text-ink-3"><Link href="/admin/bookings/new" className="underline">{t("bookingOrders.form.backToOrders")}</Link></p>
            <NewBookingForm services={catalog.data} coaches={coaches} spaces={spaces} isAdmin={me.roles.includes("admin")}
              scope={orgId} todayKey={zonedDayKey(new Date(), f.timeZone)} initialAthlete={initialAthlete} />
          </>
        ) : (
          <NewOrderForm services={catalog.data} coaches={coaches} spaces={spaces} isAdmin={me.roles.includes("admin")}
            scope={orgId} todayKey={zonedDayKey(new Date(), f.timeZone)} initialAthlete={initialAthlete} />
        )
      )}
    </div>
  );
}
