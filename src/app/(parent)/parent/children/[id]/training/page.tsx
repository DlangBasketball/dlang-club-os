import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ErrorState, PageHeader } from "@/components/ui";
import { AthleteTrainingView } from "@/components/training/athlete-training";
import { getAthleteTraining } from "@/lib/training/data";
import { getTranslations } from "@/lib/i18n/server";

/** A parent sees their own child's training profile (RLS returns nothing for other children). */
export default async function ParentChildTrainingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, res] = await Promise.all([getTranslations(), getAthleteTraining(id)]);
  if (res.error !== null) return <ErrorState title={t("training.common.loadFailed")} message={res.error} />;
  if (!res.data) notFound();
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <Link href={`/parent/children/${id}`} className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {res.data.athlete.name}</Link>
      <PageHeader title={t("training.profile.pageTitle", { name: res.data.athlete.name })} />
      <AthleteTrainingView data={res.data} canEdit={false} canMark={false} bookHref="/parent/bookings/new" bookingHref={(b) => `/parent/bookings/${b}`} />
    </div>
  );
}
