import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ErrorState, PageHeader } from "@/components/ui";
import { TrainingBookingFlow } from "@/components/training/booking-flow";
import { getTrainingWizardData } from "@/lib/training/data";
import { photoUrlsForCoaches } from "@/lib/people/server";
import { getTranslations } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getParticipantChoices } from "@/lib/participants/server";
import { getActiveAthleteState } from "@/lib/participants/my-athletes";
import { preselectAthlete } from "@/lib/participants/active-athlete";

/**
 * Parent: book a training session / package. The athlete comes from the
 * shared picker (children; "Myself" for adults), preselecting the active
 * athlete of the switcher. "Someone else" stays on /parent/bookings/request
 * (training requests), where third-party booking with guardian consent exists.
 */
export default async function NewBookingPage({ searchParams }: { searchParams: Promise<{ athlete?: string }> }) {
  const [t, res, me, state, sp] = await Promise.all([getTranslations(), getTrainingWizardData(), getSessionUser(), getActiveAthleteState(), searchParams]);
  if (res.error !== null) return (<div className="animate-fade-up"><PageHeader title={t("training.book.title")} /><ErrorState title={t("training.common.loadFailed")} message={res.error} /></div>);
  const [coachPhotos, choices] = await Promise.all([
    photoUrlsForCoaches(res.data.coaches.map((c) => c.id)),
    me?.orgId ? getParticipantChoices({ id: me.id, orgId: me.orgId, fullName: me.fullName ?? null }) : Promise.resolve(null),
  ]);
  const own = choices ? { participants: choices.participants.filter((p) => p.kind !== "other"), self: choices.self } : null;
  const bookable = res.data.athletes.map((a) => a.id);
  // Explicit ?athlete= (validated against the bookable list) wins, else the active athlete.
  const initial = preselectAthlete(sp.athlete ?? null, bookable) ?? preselectAthlete(state.active, bookable) ?? undefined;
  return (
    <div className="animate-fade-up max-w-3xl">
      <Link href="/parent/bookings" className="mb-2 inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {t("training.book.back")}</Link>
      <PageHeader title={t("training.book.title")} description={t("training.book.description")} />
      <TrainingBookingFlow data={res.data} mode="parent" coachPhotos={coachPhotos} choices={own ?? undefined} initialAthleteId={initial} />
    </div>
  );
}
