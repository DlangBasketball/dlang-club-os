import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ErrorState, PageHeader } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { getAthleteDevelopment } from "@/lib/development/data";
import { AthleteDevelopmentView } from "@/components/development/athlete-view";
import { todayIn } from "@/components/development/pages";

/** A guardian's view of their child: shared evaluations, own rank band + level, weekly plan, nutrition, wellness. */
export default async function ParentChildDevelopmentPage({ params, searchParams }: {
  params: Promise<{ athleteId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { athleteId } = await params;
  const sp = await searchParams;
  const { t, f } = await getI18n();
  const res = await getAthleteDevelopment(athleteId, { familyView: true });
  if (res.error !== null) return <ErrorState title={t("development.common.loadFailed")} message={res.error} />;
  if (!res.data) notFound();
  const view = sp.view === "month" || sp.view === "year" ? sp.view : "all";
  return (
    <div className="animate-fade-up space-y-5">
      <Link href="/parent/development" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {t("development.family.title")}</Link>
      <PageHeader title={res.data.athlete.name} description={t("development.family.childHint")} />
      <AthleteDevelopmentView data={res.data} mode="family" base="/parent/development" view={view} today={todayIn(f.timeZone)} />
    </div>
  );
}
