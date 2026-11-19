import Link from "next/link";
import { ChevronRight, ClipboardCheck } from "lucide-react";
import { PageHeader, Card, Badge, EmptyState, ErrorState, statusTone } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { staffDb } from "@/lib/staff/db";
import { listMyRollCalls } from "@/lib/staff/data";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("staff.rollCalls.title") };
}

export default async function RollCallHistoryPage() {
  const [{ t, f }, me] = await Promise.all([getI18n(), getSessionUser()]);
  if (!me?.orgId) return null;
  const db = await staffDb();
  const { data: coach } = await db.from("coaches").select("id").eq("org_id", me.orgId).eq("profile_id", me.id).limit(1).maybeSingle();
  const res = coach ? await listMyRollCalls(me.orgId, coach.id) : { data: [], error: null };
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("staff.rollCalls.title")} description={t("staff.rollCalls.description")} />
      {res.error !== null ? (
        <ErrorState title={t("staff.errors.generic")} />
      ) : res.data.length === 0 ? (
        <EmptyState icon={<ClipboardCheck />} title={t("staff.rollCalls.empty")} />
      ) : (
        <Card>
          <ul className="divide-y divide-border-soft">
            {res.data.map((r) => {
              const body = (
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-medium text-text">{r.programName ?? t("staff.calendar.kinds.session")}</div>
                    <div className="text-xs text-text-muted">{f.dateTime(r.date)}</div>
                    <div className="tnum mt-0.5 text-xs text-text-muted">
                      {t("staff.rollCalls.counts", { present: r.present, late: r.late, absent: r.absent, excused: r.excused })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={statusTone(r.status)}>{t.dynamic(`staff.rollCalls.status.${r.status}`, undefined, r.status)}</Badge>
                    {r.programSessionId && <ChevronRight className="h-4 w-4 text-text-muted" />}
                  </div>
                </div>
              );
              return (
                <li key={r.attendanceSessionId}>
                  {r.programSessionId ? <Link href={`/coach/attendance/${r.programSessionId}`} className="block hover:bg-surface-elevated">{body}</Link> : body}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
