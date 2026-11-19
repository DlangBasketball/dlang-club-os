import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ErrorState, PageHeader } from "@/components/ui";
import { AthleteTrainingView } from "@/components/training/athlete-training";
import { getAthleteTraining } from "@/lib/training/data";
import { getTranslations } from "@/lib/i18n/server";

/** Coach view: only athletes the coach works with are readable (RLS: coach_can_access_athlete). */
export default async function CoachAthleteTrainingPage({ params }: { params: Promise<{ athleteId: string }> }) {
  const { athleteId } = await params;
  const [t, res] = await Promise.all([getTranslations(), getAthleteTraining(athleteId)]);
  if (res.error !== null) return <ErrorState title={t("training.common.loadFailed")} message={res.error} />;
  if (!res.data) notFound();
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <Link href="/coach/training" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {t("training.coach.title")}</Link>
      <PageHeader title={t("training.profile.pageTitle", { name: res.data.athlete.name })} description={t("training.profile.coachHint")} />
      <AthleteTrainingView data={res.data} canEdit canMark />
    </div>
  );
}
