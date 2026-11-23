import { PageHeader, ErrorState } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { uuidParam } from "@/lib/attendance/family";
import { getPlayerFamilyOverview } from "@/lib/attendance/family-data";
import { AttendanceHistory } from "@/components/attendance/family/sections";

/** The player's own finalized attendance, by team and season, with totals. */
export default async function PlayerAttendancePage({ searchParams }: { searchParams: Promise<{ team?: string; season?: string }> }) {
  const sp = await searchParams;
  const { t } = await getI18n();
  const overview = await getPlayerFamilyOverview();
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("familyAttendance.player.historyTitle")} description={t("familyAttendance.player.historyDescription")} />
      {overview.error || !overview.data ? (
        <ErrorState title={t("familyAttendance.player.historyTitle")} message={t("familyAttendance.loadError")} />
      ) : (
        <AttendanceHistory overview={overview.data} basePath="/player/attendance" teamId={uuidParam(sp.team)} seasonId={uuidParam(sp.season)} recordLinks={false} />
      )}
    </div>
  );
}
