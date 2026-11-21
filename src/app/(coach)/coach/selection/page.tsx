import Link from "next/link";
import { ChevronRight, Trophy } from "lucide-react";
import { Card, CardBody, EmptyState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getCoachSelectionPrograms } from "@/lib/selection/data";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("selection.coach.title") };
}

/** Coach app: the selection programmes this coach reviews applications for. */
export default async function CoachSelectionPage() {
  const [me, { t }] = await Promise.all([getSessionUser(), getI18n()]);
  const programs = me?.orgId ? await getCoachSelectionPrograms(me.orgId, me.id) : [];
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("selection.coach.title")} description={t("selection.coach.description")} />
      {programs.length === 0 ? <EmptyState icon={<Trophy />} title={t("selection.coach.empty")} /> : (
        <div className="space-y-3">
          {programs.map((p) => (
            <Link key={p.id} href={`/coach/selection/${p.id}`}>
              <Card className="transition-colors hover:border-brand-primary">
                <CardBody className="flex items-center justify-between gap-3">
                  <span className="font-medium text-text">{p.name}</span>
                  <ChevronRight className="h-4 w-4 text-text-muted" />
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
