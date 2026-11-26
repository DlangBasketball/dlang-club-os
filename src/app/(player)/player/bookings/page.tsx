import { ErrorState, PageHeader } from "@/components/ui";
import { BookedAttendance, BookingChanges, UpcomingBookings } from "@/components/booking/portal/family-bookings";
import { getPlayerBookings } from "@/lib/booking/data";
import { flattenAttendance, flattenChanges, flattenUpcoming } from "@/lib/booking/portal";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("bookingPortal.player.title") };
}

/**
 * Player bookings: the player's own upcoming booked sessions, schedule
 * changes and finalized attendance. Reads player_booking_overview only: no
 * price, payer or invoice ever reaches the player portal.
 */
export default async function PlayerBookingsPage() {
  const [{ t, f }, read] = await Promise.all([getI18n(), getPlayerBookings()]);
  const title = t("bookingPortal.player.title");
  if (read.error || !read.data) {
    return (
      <div className="animate-fade-up space-y-5">
        <PageHeader title={title} />
        <ErrorState title={t("bookingPortal.family.loadError")} message={t("bookingPortal.family.loadErrorHint")} />
      </div>
    );
  }
  const me = [read.data];
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={title} description={t("bookingPortal.player.description")} />
      <UpcomingBookings rows={flattenUpcoming(me)} t={t} f={f} showChild={false} />
      <BookingChanges rows={flattenChanges(me)} t={t} f={f} showChild={false} />
      <BookedAttendance rows={flattenAttendance(me)} t={t} f={f} showChild={false} />
    </div>
  );
}
