import { ErrorState } from "@/components/ui";
import { getClubBillingSettings, listSeasons } from "@/lib/data/billing";
import { getAttendanceSettings, getTrainingBreaks } from "@/lib/attendance/data";
import { getTranslations } from "@/lib/i18n/server";
import { SeasonsEditor } from "@/components/billing/seasons-editor";
import { TrainingSettings } from "@/components/attendance/training-settings";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("billing.seasons.tab") };
}

/** Settings -> Seasons & membership plan defaults, training window, go-live and breaks. */
export default async function SeasonsPage() {
  const [settings, seasons, attendance, breaks, t] = await Promise.all([
    getClubBillingSettings(), listSeasons(), getAttendanceSettings(), getTrainingBreaks(), getTranslations(),
  ]);
  if (settings.error !== null || seasons.error !== null) {
    const denied = settings.error === "NOT_AUTHORIZED" || seasons.error === "NOT_AUTHORIZED";
    return <ErrorState message={denied ? t("billing.errors.NOT_AUTHORIZED") : t("billing.errors.generic")} />;
  }
  return (
    <div className="space-y-6">
      <SeasonsEditor settings={settings.data} seasons={seasons.data.seasons} canEdit={seasons.data.canEdit} />
      <TrainingSettings
        goLive={attendance.data?.attendanceTrackingStartsOn ?? null}
        breaks={breaks.data ?? []}
        seasons={seasons.data.seasons.map((s) => ({ id: s.id, name: s.name }))}
        canEdit={seasons.data.canEdit}
      />
    </div>
  );
}
