import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, Trophy } from "lucide-react";
import { Badge, Button, Card, CardBody, EmptyState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getProgramStats, getSelectionPrograms } from "@/lib/selection/data";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("selection.admin.title") };
}

/** Selection programmes of the club: pipeline and revenue at a glance. */
export default async function SelectionProgramsPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId) redirect("/admin/dashboard");
  const [programs, stats] = await Promise.all([getSelectionPrograms(me.orgId), getProgramStats(null)]);
  const byId = new Map(stats.data.map((s) => [s.programId, s]));
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("selection.admin.title")} description={t("selection.admin.description")}
        actions={<Link href="/admin/selection/report"><Button variant="secondary"><BarChart3 className="h-4 w-4" /> {t("selection.report.title")}</Button></Link>} />
      {programs.length === 0 ? (
        <EmptyState icon={<Trophy />} title={t("selection.admin.empty")} description={t("selection.admin.emptyHint")}
          action={<Link href="/admin/programs/new"><Button>{t("selection.admin.create")}</Button></Link>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {programs.map((p) => {
            const s = byId.get(p.id);
            const cur = s?.currency ?? p.currency ?? f.currency;
            return (
              <Link key={p.id} href={`/admin/selection/${p.id}`}>
                <Card className="h-full transition-colors hover:border-brand-primary">
                  <CardBody className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-lg text-text">{p.name}</span>
                      <Badge tone={p.open ? "success" : "neutral"}>{p.open ? t("selection.admin.open") : t("selection.admin.closed")}</Badge>
                      {!p.selectionEnabled && <Badge tone="warning">{t("selection.admin.notEnabled")}</Badge>}
                    </div>
                    <p className="text-xs text-text-muted">{t("selection.dashboard.pipeline", { applicants: s?.applicants ?? 0, accepted: s?.accepted ?? 0, enrolled: s?.enrolled ?? 0 })}</p>
                    <p className="text-sm tnum text-text">
                      {t("selection.admin.moneyLine", { invoiced: f.money(s?.invoiced ?? 0, cur), collected: f.money(s?.collected ?? 0, cur), outstanding: f.money(s?.outstanding ?? 0, cur) })}
                    </p>
                  </CardBody>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
