import Link from "next/link";
import { NotebookPen } from "lucide-react";
import { PageHeader, Card, Badge, EmptyState, ErrorState } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listLessonPlans } from "@/lib/staff/data";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("staff.lessonPlans.adminTitle") };
}

export default async function AdminLessonPlansPage() {
  const me = await requireRole(["admin"]);
  const [{ t, f }, plans] = await Promise.all([getI18n(), listLessonPlans(me.orgId as string)]);
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("staff.lessonPlans.adminTitle")} description={t("staff.lessonPlans.adminDescription")} />
      {plans.error !== null ? (
        <ErrorState title={t("staff.errors.generic")} />
      ) : plans.data.length === 0 ? (
        <EmptyState icon={<NotebookPen />} title={t("staff.lessonPlans.empty")} />
      ) : (
        <Card>
          <ul className="divide-y divide-border-soft">
            {plans.data.map((p) => (
              <li key={p.id}>
                <Link href={p.href} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-elevated">
                  <div className="min-w-0">
                    <div className="font-medium text-text">{p.title || p.itemTitle || t("staff.lessonPlans.title")}</div>
                    <div className="text-xs text-text-muted">
                      {[p.itemTitle, p.itemStart ? f.dateTime(p.itemStart) : null, p.coachName].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={p.sharedWithParents ? "info" : "neutral"}>{p.sharedWithParents ? t("staff.lessonPlans.shared") : t("staff.lessonPlans.notShared")}</Badge>
                    <span className="text-xs text-text-muted">{t("staff.lessonPlans.updated", { date: f.date(p.updatedAt) })}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
