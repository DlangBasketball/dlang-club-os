import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ErrorState, PageHeader } from "@/components/ui";
import { TrainingBookingFlow } from "@/components/training/booking-flow";
import { getTrainingWizardData } from "@/lib/training/data";
import { photoUrlsForCoaches } from "@/lib/people/server";
import { getTranslations } from "@/lib/i18n/server";

export default async function NewBookingPage() {
  const [t, res] = await Promise.all([getTranslations(), getTrainingWizardData()]);
  if (res.error !== null) return (<div className="animate-fade-up"><PageHeader title={t("training.book.title")} /><ErrorState title={t("training.common.loadFailed")} message={res.error} /></div>);
  const coachPhotos = await photoUrlsForCoaches(res.data.coaches.map((c) => c.id));
  return (
    <div className="animate-fade-up max-w-3xl">
      <Link href="/parent/bookings" className="mb-2 inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {t("training.book.back")}</Link>
      <PageHeader title={t("training.book.title")} description={t("training.book.description")} />
      <TrainingBookingFlow data={res.data} mode="parent" coachPhotos={coachPhotos} />
    </div>
  );
}
