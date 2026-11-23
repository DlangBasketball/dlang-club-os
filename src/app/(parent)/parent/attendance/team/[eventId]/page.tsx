import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, SearchX } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardMeta, CardBody, Badge, EmptyState } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { createFormatter } from "@/lib/format";
import { attendancePortalPath } from "@/lib/attendance/types";
import { attendanceTone, uuidParam } from "@/lib/attendance/family";
import { getAttendanceRecord, getMyChildren } from "@/lib/attendance/family-data";
import { AbsenceControl } from "@/components/attendance/family/absence-control";
import { CorrectionRequestForm, WithdrawCorrectionButton } from "@/components/attendance/family/correction-request";

/**
 * One team session of one child — the page behind no-show / correction
 * alerts (attendancePortalPath). Shows the FINALIZED status only, the session
 * (team, date and time in the club time zone, cancel / move), the absence
 * report, and "Request a correction" with the request status and the staff
 * outcome. guardian_attendance_record() checks the guardian on the server; a
 * child of another family or club answers "not found".
 */
export default async function AttendanceRecordPage({ params, searchParams }: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ athlete?: string }>;
}) {
  const [{ eventId }, sp] = await Promise.all([params, searchParams]);
  if (!uuidParam(eventId)) notFound();
  const [{ t, f: userF }, user] = await Promise.all([getI18n(), getSessionUser()]);
  const back = (
    <Link href="/parent/attendance" className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text">
      <ArrowLeft aria-hidden className="h-4 w-4" /> {t("familyAttendance.record.back")}
    </Link>
  );

  const athleteId = uuidParam(sp.athlete);
  if (!athleteId) {
    const kids = user?.orgId ? await getMyChildren(user.id, user.orgId) : [];
    return (
      <div className="animate-fade-up space-y-5">
        {back}
        <PageHeader title={t("familyAttendance.record.chooseChild")} />
        <Card>
          <CardBody className="p-0">
            <ul>
              {kids.map((k) => (
                <li key={k.id} className="border-b border-border last:border-0">
                  <Link href={attendancePortalPath(eventId, k.id)} className="block px-5 py-3 text-sm text-text hover:bg-surface-elevated">
                    {k.first_name} {k.last_name}
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    );
  }

  const { data: rec, error } = await getAttendanceRecord(eventId, athleteId);
  if (error || !rec) {
    return (
      <div className="animate-fade-up space-y-5">
        {back}
        <EmptyState icon={<SearchX className="h-5 w-5" />} title={t("familyAttendance.record.notFound.title")} description={t("familyAttendance.record.notFound.body")} />
      </div>
    );
  }

  const f = createFormatter({ locale: userF.locale, currency: userF.currency, timeZone: rec.timezone || userF.timeZone });
  const ev = rec.event;
  const name = `${rec.athlete.first_name} ${rec.athlete.last_name}`.trim();
  const cancelled = ev.status === "cancelled";
  const lastAlert = rec.alerts.find((a) => a.sent_at);
  const statusLabel = (s: string) => t.dynamic(`teamAttendance.statuses.${s}`, undefined, s);

  return (
    <div className="animate-fade-up space-y-5">
      {back}
      <PageHeader
        eyebrow={`${t.dynamic(`familyAttendance.upcoming.types.${ev.type}`, undefined, ev.type)} · ${ev.team_name ?? ""}`}
        title={name}
        description={f.dateTime(ev.starts_at, "full")}
      />

      <Card>
        <CardBody>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="eyebrow">{t("familyAttendance.record.status")}</dt>
              <dd className="mt-1.5">
                {rec.attendance ? (
                  <Badge tone={attendanceTone(rec.attendance.status)}>{statusLabel(rec.attendance.status)}</Badge>
                ) : cancelled ? (
                  <Badge tone="danger">
                    {ev.cancel_reason ? t("familyAttendance.upcoming.cancelledReason", { reason: ev.cancel_reason }) : t("familyAttendance.upcoming.cancelled")}
                  </Badge>
                ) : (
                  <span className="text-sm text-text-muted">{ev.ended ? t("familyAttendance.record.notFinal") : t("familyAttendance.record.notStarted")}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">{t("familyAttendance.record.team")}</dt>
              <dd className="mt-1.5 text-sm text-text">{ev.team_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="eyebrow">{t("familyAttendance.record.when")}</dt>
              <dd className="mt-1.5 text-sm text-text">
                {f.dateTime(ev.starts_at, "full")} – {f.time(ev.ends_at)}
                {ev.rescheduled_from && (
                  <div className="mt-1 text-xs text-warning">{t("familyAttendance.upcoming.rescheduled", { when: f.dateTime(ev.rescheduled_from, "medium") })}</div>
                )}
              </dd>
            </div>
            {ev.location && (
              <div>
                <dt className="eyebrow">{t("familyAttendance.record.location")}</dt>
                <dd className="mt-1.5 text-sm text-text">{ev.location}</dd>
              </div>
            )}
          </dl>
          <div className="mt-4 space-y-1 text-xs text-text-muted">
            {rec.attendance?.is_guest && <p>{t("familyAttendance.record.guest", { name: rec.athlete.first_name })}</p>}
            {rec.attendance?.corrected && <p>{t("familyAttendance.record.corrected")}</p>}
            {lastAlert?.sent_at && <p>{t("familyAttendance.record.alertSent", { date: f.dateTime(lastAlert.sent_at, "medium") })}</p>}
          </div>
        </CardBody>
      </Card>

      {!cancelled && (rec.can_report || rec.report) && !ev.ended && (
        <Card>
          <CardHeader><CardTitle>{t("familyAttendance.absence.report")}</CardTitle></CardHeader>
          <CardBody>
            <AbsenceControl eventId={ev.id} athleteId={rec.athlete.id} report={rec.report} canReport={rec.can_report} />
          </CardBody>
        </Card>
      )}

      {(rec.can_request_correction || rec.requests.length > 0) && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t("familyAttendance.correction.title")}</CardTitle>
              <CardMeta>{t("familyAttendance.correction.intro")}</CardMeta>
            </div>
          </CardHeader>
          <CardBody className="space-y-5">
            {rec.requests.length > 0 && (
              <ul className="space-y-3">
                {rec.requests.map((q) => (
                  <li key={q.request_id} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-text-muted">{t("familyAttendance.correction.sentOn", { date: f.dateTime(q.created_at, "medium") })}</span>
                      <Badge tone={q.status === "accepted" ? "success" : q.status === "rejected" ? "danger" : q.status === "open" ? "info" : "neutral"}>
                        {t.dynamic(`familyAttendance.correction.status.${q.status}`, undefined, q.status)}
                      </Badge>
                    </div>
                    <p className="mt-2 whitespace-pre-line text-sm text-text">{q.message}</p>
                    {q.requested_status && (
                      <p className="mt-1 text-xs text-text-muted">{t("familyAttendance.correction.requestedStatus", { status: statusLabel(q.requested_status) })}</p>
                    )}
                    {q.resolution_note && (
                      <p className="mt-2 text-sm text-text">{t("familyAttendance.correction.outcome", { note: q.resolution_note })}</p>
                    )}
                    {q.resolved_at && (
                      <p className="mt-1 text-xs text-text-muted">{t("familyAttendance.correction.decidedOn", { date: f.dateTime(q.resolved_at, "medium") })}</p>
                    )}
                    {q.status === "open" && q.mine && <div className="mt-2"><WithdrawCorrectionButton requestId={q.request_id} /></div>}
                  </li>
                ))}
              </ul>
            )}
            {rec.can_request_correction && rec.attendance && (
              <CorrectionRequestForm eventId={ev.id} athleteId={rec.athlete.id} currentStatus={rec.attendance.status} />
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
