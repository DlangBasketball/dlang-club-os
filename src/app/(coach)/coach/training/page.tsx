import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";
import { Card, CardBody, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { listMyTrainingAthletes } from "@/lib/training/data";
import { getI18n } from "@/lib/i18n/server";

export default async function CoachTrainingPage() {
  const { t, f } = await getI18n();
  const res = await listMyTrainingAthletes();
  if (res.error !== null) return <ErrorState title={t("training.common.loadFailed")} message={res.error} />;
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("training.coach.title")} description={t("training.coach.description")} />
      {res.data.athletes.length === 0 ? (
        <EmptyState icon={<Users className="h-5 w-5" />} title={res.data.coachId ? t("training.coach.empty") : t("training.availability.noCoachProfile")} />
      ) : (
        <div className="space-y-2">
          {res.data.athletes.map((a) => (
            <Link key={a.id} href={`/coach/training/${a.id}`}>
              <Card className="transition hover:border-maroon/40"><CardBody className="flex items-center justify-between py-3">
                <div><div className="text-sm font-medium text-ink">{a.name}</div>
                  <div className="text-xs text-ink-3">{a.next ? t("training.coach.next", { when: `${f.date(a.next, { weekday: true })} · ${f.time(a.next)}` }) : t("training.coach.noNext")} · {t("training.coach.sessions", { count: a.sessions })}</div></div>
                <ChevronRight className="h-4 w-4 text-ink-4" />
              </CardBody></Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
