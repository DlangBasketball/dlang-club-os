import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, CardTitle, ErrorState } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { getAlertFollowups, getCorrectionRequests, getSessionAccessList } from "@/lib/attendance/data";
import { canRetryAlert } from "@/lib/attendance/admin-stats";
import { DecideAccessButtons, ResolveCorrectionForm, RetryAlertButton } from "./actions";

/*
 * Full follow-up lists with their actions (admin): coach access requests,
 * guardian correction requests and alerts needing follow-up. Used by
 * /admin/attendance/team, /admin/attendance/access (notification target)
 * and /admin/attendance/corrections (notification target).
 */

const sessionHref = (eventId: string) => `/admin/schedule/${eventId}/attendance`;

export async function AccessRequestList() {
  const { t, f } = await getI18n();
  const res = await getSessionAccessList("pending");
  return (
    <Card id="access">
      <CardHeader><CardTitle>{t("adminAttendance.access.title")}</CardTitle></CardHeader>
      <CardBody className="p-0">
        {res.error !== null ? <div className="p-5"><ErrorState message={t("teamAttendance.errors.generic")} /></div>
          : res.data.length === 0 ? <p className="px-5 py-5 text-sm text-text-muted">{t("adminAttendance.access.none")}</p> : (
            <ul>
              {res.data.map((r) => (
                <li key={r.assignment_id} className="flex flex-col gap-2 border-b border-border-soft px-5 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-sm">
                    <span className="font-medium text-text">{r.coach_name}</span>
                    <Link href={sessionHref(r.event_id)} className="ml-2 text-text-muted hover:text-brand-primary">
                      {r.team_name ?? ""} · {f.date(r.starts_at)} {f.time(r.starts_at)}
                    </Link>
                    {r.request_note && <p className="text-xs text-text-muted">“{r.request_note}”</p>}
                  </div>
                  <DecideAccessButtons assignmentId={r.assignment_id} status={r.status} />
                </li>
              ))}
            </ul>
          )}
      </CardBody>
    </Card>
  );
}

export async function CorrectionRequestList() {
  const { t, f } = await getI18n();
  const res = await getCorrectionRequests({ status: "open" });
  const mark = (s: string | null) => (s ? t.dynamic(`adminAttendance.mark.${s}`, undefined, s) : "?");
  return (
    <Card id="corrections">
      <CardHeader><CardTitle>{t("adminAttendance.corrections.title")}</CardTitle></CardHeader>
      <CardBody className="p-0">
        {res.error !== null ? <div className="p-5"><ErrorState message={t("teamAttendance.errors.generic")} /></div>
          : res.data.length === 0 ? <p className="px-5 py-5 text-sm text-text-muted">{t("adminAttendance.corrections.none")}</p> : (
            <ul>
              {res.data.map((r) => (
                <li key={r.request_id} className="space-y-2 border-b border-border-soft px-5 py-3 text-sm last:border-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <Link href={`/admin/athletes/${r.athlete_id}?tab=attendance`} className="font-medium text-text hover:text-brand-primary">{r.first_name} {r.last_name}</Link>
                      <Link href={sessionHref(r.event_id)} className="ml-2 text-text-muted hover:text-brand-primary">{r.team_name} · {f.date(r.starts_at)}</Link>
                    </span>
                    <span className="text-xs text-text-muted">{mark(r.mark_status ?? r.current_status)} → {mark(r.requested_status)}</span>
                  </div>
                  <p className="text-xs text-text-muted">“{r.message}” · {r.requested_by_name ?? ""} · {f.dateTime(r.created_at)}</p>
                  <ResolveCorrectionForm requestId={r.request_id} requestedStatus={r.requested_status} />
                </li>
              ))}
            </ul>
          )}
      </CardBody>
    </Card>
  );
}

export async function AlertFollowupList() {
  const { t, f } = await getI18n();
  const res = await getAlertFollowups(200);
  return (
    <Card id="alerts">
      <CardHeader>
        <CardTitle>{t("adminAttendance.alerts.followupTitle")}</CardTitle>
        <Link href="/admin/data-review" className="text-xs text-maroon hover:underline">{t("adminAttendance.dashboard.review")}</Link>
      </CardHeader>
      <CardBody className="p-0">
        {res.error !== null ? <div className="p-5"><ErrorState message={t("teamAttendance.errors.generic")} /></div>
          : res.data.length === 0 ? <p className="px-5 py-5 text-sm text-text-muted">{t("adminAttendance.dashboard.noAlerts")}</p> : (
            <ul>
              {res.data.map((a) => (
                <li key={a.alert_id} className="flex flex-col gap-2 border-b border-border-soft px-5 py-3 text-sm last:border-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link href={sessionHref(a.event_id)} className="font-medium text-text hover:text-brand-primary">
                      {a.first_name} {a.last_name} → {a.guardian_name ?? t("adminAttendance.alerts.noGuardian")}
                    </Link>
                    <p className="text-xs text-text-muted">
                      {a.team_name ?? ""} · {f.date(a.starts_at)} · {t("adminAttendance.alerts.attempts", { count: a.attempts })}{a.last_error ? ` · ${a.last_error}` : ""}
                    </p>
                  </div>
                  <span className="flex items-center gap-2">
                    <Badge tone={a.status === "failed" ? "danger" : "warning"}>{t.dynamic(`adminAttendance.alerts.status.${a.status}`, undefined, a.status)}</Badge>
                    {canRetryAlert({ status: a.status, guardian_profile_id: a.guardian_profile_id })
                      ? <RetryAlertButton alertId={a.alert_id} eventId={a.event_id} />
                      : <Link href={`/admin/athletes/${a.athlete_id}`} className="text-xs text-brand-primary hover:underline">{t("adminAttendance.alerts.fixContact")}</Link>}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </CardBody>
    </Card>
  );
}
