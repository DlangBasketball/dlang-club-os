import Link from "next/link";
import { ChevronRight, Dumbbell } from "lucide-react";
import { Badge, Card, CardBody, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { getAthleteDevelopment, listMyChildren } from "@/lib/development/data";
import { completionRate } from "@/lib/development/plan";
import { levelName } from "@/components/development/athlete-view";

/**
 * "My training": for each child, the progress level emoji, their own rank
 * band (never other children's names or scores) and this week's plan.
 */
export default async function ParentDevelopmentPage() {
  const { t } = await getI18n();
  const kids = await listMyChildren();
  if (kids.error !== null) return <ErrorState title={t("development.common.loadFailed")} message={kids.error} />;
  const profiles = await Promise.all(kids.data.map((k) => getAthleteDevelopment(k.id, { familyView: true })));
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("development.family.title")} description={t("development.family.description")} />
      {kids.data.length === 0 ? <EmptyState icon={<Dumbbell className="h-5 w-5" />} title={t("development.family.noChildren")} /> : (
        <div className="space-y-3">
          {kids.data.map((k, i) => {
            const d = profiles[i].data;
            const active = d?.assignments.filter((a) => a.status === "active") ?? [];
            const thisWeek = active.flatMap((a) => a.items.filter((it) => it.week === a.currentWeek).map((it) => ({ id: it.id, done: Boolean(a.completions[it.id]) })));
            const rate = completionRate(thisWeek.map((x) => x.id), thisWeek.filter((x) => x.done).map((x) => x.id));
            return (
              <Link key={k.id} href={`/parent/development/${k.id}`}>
                <Card className="transition hover:border-maroon/40"><CardBody className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {d && <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-brand-accent/40 bg-brand-accent-soft text-2xl">{d.level.tier.emoji}</span>}
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">{k.name}</div>
                      <div className="flex flex-wrap items-center gap-1 text-xs text-ink-3">
                        {d && <span>{levelName(t, d.level.tier, d.level.index)}</span>}
                        {d?.ranks.filter((r) => r.band).slice(0, 2).map((r, j) => <Badge key={j} tone="accent">{r.groupName}: {t.dynamic(`development.bands.${r.band}`, undefined, r.band ?? "")}</Badge>)}
                      </div>
                      <div className="text-xs text-ink-4">
                        {active.length === 0 ? t("development.plans.noneAssigned") : thisWeek.length === 0 ? t("development.family.nothingThisWeek") : t("development.family.thisWeek", { rate })}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" />
                </CardBody></Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
