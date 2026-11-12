import Link from "next/link";
import { ChevronRight, Tent } from "lucide-react";
import { Card, CardBody, EmptyState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { listMemberCamps } from "@/lib/camps/data";
import { getI18n } from "@/lib/i18n/server";

export default async function ParentCampsPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  const camps = me?.orgId ? await listMemberCamps(me.orgId) : [];
  return (
    <div className="animate-fade-up">
      <PageHeader title={t("camps.parent.title")} description={t("camps.parent.description")} />
      {camps.length === 0 ? (
        <EmptyState icon={<Tent className="h-5 w-5" />} title={t("camps.parent.empty")} />
      ) : (
        <div className="space-y-2">
          {camps.map((c) => (
            <Link key={c.id} href={`/parent/camps/${c.id}`}>
              <Card className="transition hover:border-maroon/40">
                <CardBody className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="font-medium text-ink">{c.name}</div>
                    <div className="text-xs text-ink-3">
                      {t("camps.parent.editions", { count: c.editions })}
                      {c.nextStart && <> · {t("camps.parent.nextStart", { date: f.date(c.nextStart) })}</>}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-4" />
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
