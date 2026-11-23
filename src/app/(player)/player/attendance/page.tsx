import { PageHeader, ErrorState } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { uuidParam } from "@/lib/attendance/family";
import { getPlayerFamilyOverview, type HistoryEntry } from "@/lib/attendance/family-data";
import { AttendanceHistory } from "@/components/attendance/family/sections";
import { getPlayerBookings } from "@/lib/booking/data";
import { mergeAttendanceHistory } from "@/lib/booking/portal";

/** The player's own finalized attendance (team sessions and booked sessions), by team and season, with totals. */
export default async function PlayerAttendancePage({ searchParams }: { searchParams: Promise<{ team?: string; season?: string }> }) {
  const sp = await searchParams;
  const { t } = await getI18n();
  const [overview, bookings] = await Promise.all([getPlayerFamilyOverview(), getPlayerBookings()]);
  const data = overview.data
    ? {
        ...overview.data,
        history: mergeAttendanceHistory<HistoryEntry>(overview.data.history, bookings.data?.attendance ?? [], (a) => ({
          event_id: a.event_id, team_id: null, team_name: a.service_name, type: "training", starts_at: a.starts_at, status: a.status,
          is_guest: false, season_id: null, season_name: null, can_request_correction: false, open_request: false, alert: null, booked: true,
        })),
      }
    : null;
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("familyAttendance.player.historyTitle")} description={t("familyAttendance.player.historyDescription")} />
      {overview.error || !data ? (
        <ErrorState title={t("familyAttendance.player.historyTitle")} message={t("familyAttendance.loadError")} />
      ) : (
        <AttendanceHistory overview={data} basePath="/player/attendance" teamId={uuidParam(sp.team)} seasonId={uuidParam(sp.season)} recordLinks={false} />
      )}
    </div>
  );
}
