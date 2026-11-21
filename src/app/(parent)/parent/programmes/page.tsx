import Link from "next/link";
import { ChevronRight, Trophy } from "lucide-react";
import { Card, CardBody, EmptyState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getFamilyApplications, getMyChildren, getOpenSelectionPrograms, getSelectionPrograms } from "@/lib/selection/data";
import { ApplicationStatusBadge } from "@/components/selection/shared";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("selection.family.title") };
}

/** Parent app: programmes the family can apply to, and its applications. */
export default async function ParentProgrammesPage() {
  const [me, { t }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId) return null;
  const kids = await getMyChildren(me.id, me.orgId);
  const familyIds = Array.from(new Set(kids.map((k) => k.familyId)));
  const [open, apps] = await Promise.all([getOpenSelectionPrograms(me.orgId), getFamilyApplications(me.orgId, familyIds)]);
  // Programmes the family applied to stay listed after they close.
  const appliedIds = Array.from(new Set(apps.map((a) => a.programId)));
  const extra = appliedIds.filter((id) => !open.some((p) => p.id === id));
  const closed = extra.length ? (await getSelectionPrograms(me.orgId)).filter((p) => extra.includes(p.id)) : [];
  const list = [...open, ...closed];
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("selection.family.title")} description={t("selection.family.description")} />
      {list.length === 0 ? <EmptyState icon={<Trophy />} title={t("selection.family.empty")} /> : (
        <div className="space-y-3">
          {list.map((p) => {
            const mine = apps.filter((a) => a.programId === p.id);
            return (
              <Link key={p.id} href={`/parent/programmes/${p.id}`}>
                <Card className="transition-colors hover:border-brand-primary">
                  <CardBody className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-medium text-text">{p.name}</span>
                      {mine.length > 0 ? (
                        <span className="mt-1 flex flex-wrap gap-2 text-xs text-text-muted">
                          {mine.map((a) => <span key={a.id} className="inline-flex items-center gap-1">{a.athleteName} <ApplicationStatusBadge status={a.status} /></span>)}
                        </span>
                      ) : <span className="block text-xs text-text-muted">{p.open ? t("selection.family.applyNow") : t("selection.admin.closed")}</span>}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
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
