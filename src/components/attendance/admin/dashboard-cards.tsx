import Link from "next/link";
import { CalendarCheck2 } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, ErrorState } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { getConfirmedNoShows } from "@/lib/data/dashboard";
import { getFollowups, getSessionsOverview } from "@/lib/attendance/overview";
import { zonedDayKey } from "@/lib/staff/hours";
import { CoverageBadge, coverageLine } from "@/components/attendance/coverage-views";
import { FollowupsCard, needsCompletion } from "./overview-views";
import { getAlertFollowups, getAwaitingSessions, getCorrectionRequests, getSessionAccessList } from "@/lib/attendance/data";
import { sheetState } from "@/lib/attendance/admin-stats";
import { ATTENDANCE_FLAG_CODES } from "@/lib/attendance/review-flags";
import { SheetStateBadge } from "./views";

/*
 * Team attendance cards for the admin dashboard and the follow-up screen.
 * Each item links to the session page (/admin/schedule/<id>/attendance) or
 * the record it is about. Admin only: finance and coaches never see them.
 */

const sessionHref = (eventId: string) => `/admin/schedule/${eventId}/attendance`;

function Line({ href, title, meta, right }: { href: string; title: React.ReactNode; meta?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <li className="border-b border-border-soft last:border-0">
      <Link href={href} className="flex items-start justify-between gap-3 px-5 py-2.5 hover:bg-surface-elevated">
        <span className="min-w-0">
          <span className="block truncate text-sm text-text">{title}</span>
          {meta && <span className="block truncate text-xs text-text-muted">{meta}</span>}
        </span>
        {right && <span className="shrink-0">{right}</span>}
      </Link>
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="flex items-center gap-2 px-5 py-4 text-sm text-text-muted"><CalendarCheck2 className="h-4 w-4" aria-hidden /> {text}</p>;
}

/**
 * Today's sessions (club time zone): the same rows, coaches, roles and counts
 * as the Attendance tab for today (attendance_sessions_overview).
 */
export async function TodayTrainingsCard({ limit = 8 }: { limit?: number }) {
  const { t, f } = await getI18n();
  const today = zonedDayKey(new Date(), f.timeZone);
  const res = await getSessionsOverview({ from: today, to: today, limit: 300 });
  const rows = (res.data ?? []).filter((r) => r.source !== "program").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("adminAttendance.dashboard.today")}</CardTitle>
        <Link href="/admin/attendance" className="text-xs text-maroon hover:underline">{t("attendanceOverview.openTab")}</Link>
      </CardHeader>
      <CardBody className="p-0">
        {res.error !== null ? <div className="p-5"><ErrorState message={t("teamAttendance.errors.generic")} /></div>
          : rows.length === 0 ? <Empty text={t("adminAttendance.dashboard.noToday")} /> : (
            <ul>
              {rows.slice(0, limit).map((e) => (
                <Line key={e.session_id} href={sessionHref(e.session_id)}
                  title={<>{f.time(e.starts_at)}–{f.time(e.ends_at)} · {e.group_name ?? t.dynamic(`adminAttendance.eventType.${e.event_type}`, undefined, e.event_type)}</>}
                  meta={e.workflow_status === "cancelled"
                    ? (e.cancel_reason ? t("adminAttendance.history.cancelReason", { reason: e.cancel_reason }) : t("adminAttendance.sheetState.cancelled"))
                    : [
                      coverageLine(t, e.coverage),
                      t("attendanceOverview.counts", { present: e.present, late: e.late, excused: e.excused, unexcused: e.unexcused, unmarked: e.unmarked }),
                      e.coverage.pendingRequests ? t("adminAttendance.dashboard.pendingRequests", { count: e.coverage.pendingRequests }) : null,
                    ].filter(Boolean).join(" · ")}
                  right={e.workflow_status === "cancelled"
                    ? <SheetStateBadge state="cancelled" />
                    : <CoverageBadge t={t} coverage={e.coverage} />}
                />
              ))}
            </ul>
          )}
      </CardBody>
    </Card>
  );
}

/** Staff follow-ups (unexcused absences) + today's sessions still to complete. */
export async function AttendanceFollowupsCard() {
  const { t, f } = await getI18n();
  const today = zonedDayKey(new Date(), f.timeZone);
  const [followups, todayRows] = await Promise.all([getFollowups("open", 8), getSessionsOverview({ from: today, to: today, limit: 300 })]);
  if (followups.error !== null) return <Card><CardBody><ErrorState message={t("teamAttendance.errors.generic")} /></CardBody></Card>;
  return <FollowupsCard t={t} f={f} followups={followups.data} toComplete={(todayRows.data ?? []).filter((r) => needsCompletion(r)).slice(0, 8)} />;
}

export async function AwaitingAttendanceCard({ limit = 8 }: { limit?: number }) {
  const { t, f } = await getI18n();
  const res = await getAwaitingSessions({ limit });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("adminAttendance.dashboard.awaiting")}</CardTitle>
        <Link href="/admin/attendance/team" className="text-xs text-maroon hover:underline">{t("adminAttendance.dashboard.viewAll")}</Link>
      </CardHeader>
      <CardBody className="p-0">
        {res.error !== null ? <div className="p-5"><ErrorState message={t("teamAttendance.errors.generic")} /></div>
          : res.data.length === 0 ? <Empty text={t("adminAttendance.dashboard.noAwaiting")} /> : (
            <ul>
              {res.data.map((r) => (
                <Line key={r.event_id} href={sessionHref(r.event_id)}
                  title={<>{r.team_name} · {f.date(r.starts_at)} {f.time(r.starts_at)}</>}
                  meta={<>{t("adminAttendance.dashboard.daysSince", { count: r.days_since_end })}{r.sheet_status ? ` · ${t("adminAttendance.history.unmarked", { count: r.unmarked })}` : ""}</>}
                  right={<SheetStateBadge state={sheetState({ event_status: "scheduled", sheet_status: r.sheet_status, ends_at: r.ends_at })} />}
                />
              ))}
            </ul>
          )}
      </CardBody>
    </Card>
  );
}

export async function NoShowsCard({ limit = 8 }: { limit?: number }) {
  const { t, f } = await getI18n();
  const res = await getConfirmedNoShows(14, limit);
  return (
    <Card>
      <CardHeader><CardTitle>{t("adminAttendance.dashboard.noShows")}</CardTitle></CardHeader>
      <CardBody className="p-0">
        {res.error !== null ? <div className="p-5"><ErrorState message={res.error} /></div>
          : res.data.length === 0 ? <Empty text={t("adminAttendance.dashboard.noNoShows")} /> : (
            <ul>
              {res.data.map((r) => (
                <Line key={`${r.eventId}-${r.athleteId}`} href={sessionHref(r.eventId)}
                  title={r.athleteName} meta={<>{r.teamName ?? ""} · {f.date(r.startsAt)}</>}
                  right={<Badge tone="danger">{t("adminAttendance.mark.unexcused")}</Badge>} />
              ))}
            </ul>
          )}
      </CardBody>
    </Card>
  );
}

export async function AlertFollowupCard({ limit = 8 }: { limit?: number }) {
  const { t, f } = await getI18n();
  const db = await createClient();
  const [res, flags] = await Promise.all([
    getAlertFollowups(limit),
    db.from("data_review_flags").select("id", { count: "exact", head: true }).is("resolved_at", null).in("reason_code", [...ATTENDANCE_FLAG_CODES]),
  ]);
  const openFlags = flags.count ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("adminAttendance.dashboard.alerts")}</CardTitle>
        <Link href="/admin/data-review" className="text-xs text-maroon hover:underline">
          {openFlags > 0 ? t("adminAttendance.dashboard.reviewCount", { count: openFlags }) : t("adminAttendance.dashboard.review")}
        </Link>
      </CardHeader>
      <CardBody className="p-0">
        {res.error !== null ? <div className="p-5"><ErrorState message={t("teamAttendance.errors.generic")} /></div>
          : res.data.length === 0 ? <Empty text={t("adminAttendance.dashboard.noAlerts")} /> : (
            <ul>
              {res.data.map((a) => (
                <Line key={a.alert_id} href={sessionHref(a.event_id)}
                  title={<>{a.first_name} {a.last_name} → {a.guardian_name ?? t("adminAttendance.alerts.noGuardian")}</>}
                  meta={<>{a.team_name ?? ""} · {f.date(a.starts_at)}{a.last_error ? ` · ${a.last_error}` : ""}</>}
                  right={<Badge tone={a.status === "failed" ? "danger" : "warning"}>{t.dynamic(`adminAttendance.alerts.status.${a.status}`, undefined, a.status)}</Badge>} />
              ))}
            </ul>
          )}
      </CardBody>
    </Card>
  );
}

export async function RequestsCard({ limit = 8 }: { limit?: number }) {
  const { t, f } = await getI18n();
  const [access, corrections] = await Promise.all([getSessionAccessList("pending"), getCorrectionRequests({ status: "open" })]);
  const a = (access.data ?? []).slice(0, limit);
  const c = (corrections.data ?? []).slice(0, limit);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("adminAttendance.dashboard.requests")}</CardTitle>
        <Link href="/admin/attendance/team" className="text-xs text-maroon hover:underline">{t("adminAttendance.dashboard.viewAll")}</Link>
      </CardHeader>
      <CardBody className="p-0">
        {access.error !== null || corrections.error !== null ? <div className="p-5"><ErrorState message={t("teamAttendance.errors.generic")} /></div>
          : a.length + c.length === 0 ? <Empty text={t("adminAttendance.dashboard.noRequests")} /> : (
            <ul>
              {a.map((r) => (
                <Line key={r.assignment_id} href={sessionHref(r.event_id)}
                  title={t("adminAttendance.dashboard.accessRequest", { coach: r.coach_name })}
                  meta={<>{r.team_name ?? ""} · {f.date(r.starts_at)} {f.time(r.starts_at)}</>}
                  right={<Badge tone="warning">{t("adminAttendance.access.status.pending")}</Badge>} />
              ))}
              {c.map((r) => (
                <Line key={r.request_id} href={sessionHref(r.event_id)}
                  title={t("adminAttendance.dashboard.correctionRequest", { name: `${r.first_name} ${r.last_name}` })}
                  meta={<>{r.team_name} · {f.date(r.starts_at)} · {t.dynamic(`adminAttendance.mark.${r.current_status}`, undefined, r.current_status)} → {r.requested_status ? t.dynamic(`adminAttendance.mark.${r.requested_status}`, undefined, r.requested_status) : "?"}</>}
                  right={<Badge tone="warning">{t("adminAttendance.corrections.status.open")}</Badge>} />
              ))}
            </ul>
          )}
      </CardBody>
    </Card>
  );
}

/** Dashboard section (admin only); keeps the dashboard's card grid. */
export async function TeamAttendanceDashboard() {
  const me = await getSessionUser();
  if (!me?.roles.includes("admin")) return null;
  const { t } = await getI18n();
  return (
    <section className="space-y-4" aria-labelledby="dash-team-attendance">
      <h2 id="dash-team-attendance" className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-3">{t("adminAttendance.dashboard.section")}</h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <TodayTrainingsCard />
        <AwaitingAttendanceCard />
        <NoShowsCard />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <AttendanceFollowupsCard />
        <AlertFollowupCard />
        <RequestsCard />
      </div>
    </section>
  );
}
