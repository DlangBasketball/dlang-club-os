import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { EmptyState, ErrorState, PageHeader, buttonVariants } from "@/components/ui";
import { CorrectionRequestList, type CorrectionRequestRow } from "@/components/attendance/coach/correction-requests";
import { getCorrectionRequests } from "@/lib/attendance/data";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("coachTrainings.corrections.title") };
}

/** Parents' attendance correction requests for the teams this coach coaches (open first). */
export default async function CoachCorrectionRequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const showAll = status === "all";
  const { t } = await getI18n();
  const res = await getCorrectionRequests({ status: showAll ? null : "open" });
  const rows = (res.data ?? []) as CorrectionRequestRow[];

  const tab = (active: boolean) => cn(buttonVariants({ variant: active ? "secondary" : "ghost", size: "sm" }));
  return (
    <div className="animate-fade-up mx-auto max-w-3xl space-y-4">
      <PageHeader title={t("coachTrainings.corrections.title")} description={t("coachTrainings.corrections.description")}
                  eyebrow={<Link href="/coach/trainings" className="hover:underline">{t("coachTrainings.title")}</Link>} />
      <nav aria-label={t("coachTrainings.corrections.filter")} className="flex gap-2">
        <Link href="/coach/attendance/corrections" className={tab(!showAll)} aria-current={!showAll ? "page" : undefined}>{t("coachTrainings.corrections.open")}</Link>
        <Link href="/coach/attendance/corrections?status=all" className={tab(showAll)} aria-current={showAll ? "page" : undefined}>{t("coachTrainings.corrections.all")}</Link>
      </nav>
      {res.error ? (
        <ErrorState title={t("coachTrainings.corrections.loadError")} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ClipboardCheck />} title={t("coachTrainings.corrections.empty")} />
      ) : (
        <CorrectionRequestList rows={rows} canResolve showSession />
      )}
    </div>
  );
}
