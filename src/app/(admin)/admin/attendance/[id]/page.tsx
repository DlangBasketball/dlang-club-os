import { notFound } from "next/navigation";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, ErrorState } from "@/components/ui";
import { AttendanceCorrection } from "@/components/attendance/attendance-correction";
import { getAttendanceSessionDetail } from "@/lib/data/attendance-admin";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";

export default async function AdminAttendanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ t, f }, me] = await Promise.all([getI18n(), getSessionUser()]);
  const { id } = await params;
  const { data, error } = await getAttendanceSessionDetail(id);
  if (error) return <ErrorState title={t("editOps.common.loadFailed")} message={error} />;
  if (!data) notFound();
  const isAdmin = !!me?.roles.includes("admin");
  const actionLabel = (a: string) => t.dynamic(`editOps.attendance.actions.${a.replace("attendance.", "")}`, undefined, a);
  const statusLabel = (s: string | null) => (s ? t.dynamic(`editOps.attendance.statuses.${s}`, undefined, s) : "—");

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={data.programName} description={`${data.coachName} · ${f.date(data.date)} ${f.time(data.date)}`} />
      {data.reopenedAt && <p className="text-xs text-ink-3">{t("editOps.attendance.reopenedAt", { date: f.dateTime(data.reopenedAt) })}</p>}
      <Card>
        <CardHeader><CardTitle>{isAdmin ? t("editOps.attendance.correctTitle") : t("editOps.attendance.marksTitle")}</CardTitle></CardHeader>
        <CardBody>
          {isAdmin ? (
            <AttendanceCorrection sessionId={data.id} status={data.status} marks={data.marks} addable={data.addable} canReopen />
          ) : (
            <ul className="divide-y divide-line-soft">
              {data.marks.map((m) => <li key={m.athleteId} className="flex justify-between py-2 text-sm"><span>{m.name}</span><span>{statusLabel(m.status)}</span></li>)}
            </ul>
          )}
        </CardBody>
      </Card>
      {isAdmin && (
        <Card>
          <CardHeader><CardTitle>{t("editOps.attendance.historyTitle")}</CardTitle><span className="text-xs text-ink-3 tnum">{t("editOps.attendance.correctionCount", { count: data.correctionCount })}</span></CardHeader>
          <CardBody>
            {data.history.length === 0 ? <p className="text-sm text-ink-3">{t("editOps.attendance.noHistory")}</p> : (
              <ul className="space-y-2 text-sm">
                {data.history.map((h) => (
                  <li key={h.id} className="border-b border-line-soft pb-2 last:border-0">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-ink">{actionLabel(h.action)}{h.athleteName ? ` · ${h.athleteName}` : ""}</span>
                      <span className="text-xs text-ink-3">{h.actorName} · {f.dateTime(h.at)}</span>
                    </div>
                    {(h.from || h.to) && <p className="text-xs text-ink-2">{statusLabel(h.from)} → {statusLabel(h.to)}{h.noteChanged ? ` · ${t("editOps.attendance.noteChanged")}` : ""}</p>}
                    {h.reason && <p className="text-xs text-ink-3">{t("editOps.common.reasonValue", { reason: h.reason })}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
