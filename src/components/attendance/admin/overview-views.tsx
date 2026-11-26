import Link from "next/link";
import { ChevronDown, ClipboardCheck, ExternalLink, UserX } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import type { FollowupRow, OverviewRow, OverviewTotals, RosterRow } from "@/lib/attendance/overview";
import type { Formatter } from "@/lib/format";
import type { Translator } from "@/lib/i18n/translator";
import { CoverageBadge, coverageLine } from "@/components/attendance/coverage-views";

const markTone = (s: string): "success" | "warning" | "info" | "danger" | "neutral" =>
  s === "present" ? "success" : s === "late" ? "warning" : s === "excused" ? "info" : s === "unexcused" ? "danger" : "neutral";

/*
 * Attendance overview views (Attendance tab, Dashboard). Server components;
 * every number comes from attendance_sessions_overview so the tab, the
 * dashboard and the player history agree.
 */

export const WORKFLOW_TONE: Record<OverviewRow["workflow_status"], "success" | "warning" | "info" | "neutral" | "danger"> = {
  final: "success", reopened: "warning", draft: "info", not_started: "neutral", cancelled: "danger",
};

/** Page of the original session: team / booked session -> session attendance page; programme session -> its legacy page. */
export function sessionHref(r: Pick<OverviewRow, "source" | "session_id">): string {
  return r.source === "program" ? `/admin/attendance/${r.session_id}` : `/admin/schedule/${r.session_id}/attendance`;
}

/** Ended, not cancelled, and not final yet (or players still not marked): attendance to complete. */
export function needsCompletion(r: Pick<OverviewRow, "workflow_status" | "ends_at" | "unmarked">, now = Date.now()): boolean {
  if (r.workflow_status === "cancelled" || Date.parse(r.ends_at) > now) return false;
  return r.workflow_status !== "final" || r.unmarked > 0;
}

export function TotalsTiles({ t, f, totals }: { t: Translator; f: Formatter; totals: OverviewTotals }) {
  const cells = [
    { k: "sessions", label: t("attendanceOverview.totals.sessions"), v: totals.sessions, tone: "text-text" },
    { k: "present", label: t("adminAttendance.mark.present"), v: totals.present, tone: "text-success" },
    { k: "late", label: t("adminAttendance.mark.late"), v: totals.late, tone: "text-warning" },
    { k: "excused", label: t("adminAttendance.mark.excused"), v: totals.excused, tone: "text-info" },
    { k: "unexcused", label: t("adminAttendance.mark.unexcused"), v: totals.unexcused, tone: "text-danger" },
    { k: "unmarked", label: t("adminAttendance.mark.unmarked"), v: totals.unmarked, tone: "text-text-muted" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {cells.map((c) => (
        <div key={c.k} className="rounded-md bg-surface-elevated px-3 py-3 text-center">
          <div className={`tnum text-xl font-semibold ${c.tone}`}>{f.number(c.v)}</div>
          <div className="mt-0.5 text-xs text-text-muted">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

function Counts({ t, r }: { t: Translator; r: OverviewRow }) {
  if (r.workflow_status === "cancelled") return null;
  return (
    <span className="tnum text-xs text-text-muted">
      {t("attendanceOverview.counts", { present: r.present, late: r.late, excused: r.excused, unexcused: r.unexcused, unmarked: r.unmarked })}
    </span>
  );
}

/** One session: summary line + expandable roster with each player's current status. */
export function SessionOverviewItem({ t, f, r, roster, showDate }: {
  t: Translator; f: Formatter; r: OverviewRow; roster: RosterRow[] | undefined; showDate: boolean;
}) {
  const typeLabel = r.source === "booking" ? t("attendanceOverview.source.booking")
    : r.source === "program" ? t("attendanceOverview.source.program")
    : t.dynamic(`adminAttendance.eventType.${r.event_type}`, undefined, r.event_type);
  return (
    <li className="border-b border-border-soft last:border-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-col gap-1.5 px-4 py-3 hover:bg-surface-elevated sm:flex-row sm:items-center sm:justify-between">
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <ChevronDown className="h-4 w-4 shrink-0 text-text-muted transition-transform group-open:rotate-180" aria-hidden />
              <span className="font-medium text-text">{r.group_name ?? t("attendance.admin.untitled")}</span>
              <Badge tone="neutral">{typeLabel}</Badge>
              <Badge tone={WORKFLOW_TONE[r.workflow_status]}>{t(`attendanceOverview.workflow.${r.workflow_status}`)}</Badge>
              {r.open_followups > 0 && <Badge tone="danger">{t("attendanceOverview.openFollowups", { count: r.open_followups })}</Badge>}
            </span>
            <span className="mt-0.5 block text-xs text-text-muted">
              {showDate && <>{f.date(r.starts_at, { weekday: true })} · </>}
              {f.time(r.starts_at)}{r.source !== "program" && <>–{f.time(r.ends_at)}</>}
              {r.title && r.source === "team" && <> · {r.title}</>}
              {" · "}{coverageLine(t, r.coverage)}
              {r.workflow_status === "cancelled" && r.cancel_reason && <> · {t("adminAttendance.history.cancelReason", { reason: r.cancel_reason })}</>}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2 pl-6 sm:justify-end sm:pl-0">
            <Counts t={t} r={r} />
            {r.source !== "program" && <CoverageBadge t={t} coverage={r.coverage} />}
          </span>
        </summary>
        <div className="space-y-2 px-4 pb-4 pl-10">
          {r.source === "program" && <p className="text-xs text-text-muted">{t("attendanceOverview.legacyNote")}</p>}
          {!roster || roster.length === 0 ? (
            <p className="text-sm text-text-muted">{t("attendanceOverview.noRoster")}</p>
          ) : (
            <ul className="divide-y divide-border-soft rounded-md border border-border-soft">
              {roster.map((p) => (
                <li key={p.athlete_id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                  <Link href={`/admin/athletes/${p.athlete_id}?tab=attendance`} className="min-w-0 truncate text-text hover:text-brand-primary">
                    {p.jersey_number !== null && <span className="mr-1.5 font-mono text-xs text-text-muted">{p.jersey_number}</span>}
                    {p.first_name} {p.last_name}
                    {p.is_guest && <span className="ml-1.5 text-xs text-text-muted">({t("adminAttendance.sheet.guest")})</span>}
                  </Link>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {p.followup_status === "open" && <Badge tone="danger">{t("attendanceOverview.followupOpen")}</Badge>}
                    <Badge tone={markTone(p.status)}>{t.dynamic(`adminAttendance.mark.${p.status}`, undefined, p.status)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href={sessionHref(r)} className="inline-flex items-center gap-1 text-sm text-brand-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> {t("attendanceOverview.openSession")}
          </Link>
        </div>
      </details>
    </li>
  );
}

export function SessionOverviewList({ t, f, rows, rosters, showDate }: {
  t: Translator; f: Formatter; rows: OverviewRow[]; rosters: Map<string, RosterRow[]>; showDate: boolean;
}) {
  if (!rows.length) {
    return <EmptyState icon={<ClipboardCheck className="h-5 w-5" />} title={t("attendanceOverview.emptyTitle")} description={t("attendanceOverview.emptyBody")} />;
  }
  return (
    <Card>
      <CardBody className="p-0">
        <ul>{rows.map((r) => <SessionOverviewItem key={`${r.source}-${r.session_id}`} t={t} f={f} r={r} roster={rosters.get(r.session_id)} showDate={showDate} />)}</ul>
      </CardBody>
    </Card>
  );
}

/** Staff follow-ups (unexcused absences) and sessions whose attendance is still to complete. */
export function FollowupsCard({ t, f, followups, toComplete, title }: {
  t: Translator; f: Formatter; followups: FollowupRow[]; toComplete: OverviewRow[]; title?: string;
}) {
  return (
    <Card>
      <CardHeader><CardTitle>{title ?? t("attendanceOverview.followups.title")}</CardTitle></CardHeader>
      <CardBody className="p-0">
        {followups.length === 0 && toComplete.length === 0 ? (
          <p className="flex items-center gap-2 px-5 py-4 text-sm text-text-muted"><UserX className="h-4 w-4" aria-hidden /> {t("attendanceOverview.followups.none")}</p>
        ) : (
          <ul>
            {followups.map((x) => (
              <li key={x.followup_id} className="border-b border-border-soft last:border-0">
                <Link href={`/admin/schedule/${x.event_id}/attendance`} className="flex items-start justify-between gap-3 px-5 py-2.5 hover:bg-surface-elevated">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-text">{t("attendanceOverview.followups.unexcused", { name: `${x.first_name} ${x.last_name}` })}</span>
                    <span className="block truncate text-xs text-text-muted">
                      {x.group_name ?? ""} · {f.date(x.starts_at)} {f.time(x.starts_at)}
                      {x.reopen_count > 0 && <> · {t("attendanceOverview.followups.reopened")}</>}
                    </span>
                  </span>
                  <Badge tone="danger">{t("attendanceOverview.followups.open")}</Badge>
                </Link>
              </li>
            ))}
            {toComplete.map((r) => (
              <li key={`c-${r.source}-${r.session_id}`} className="border-b border-border-soft last:border-0">
                <Link href={sessionHref(r)} className="flex items-start justify-between gap-3 px-5 py-2.5 hover:bg-surface-elevated">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-text">{t("attendanceOverview.followups.toComplete", { name: r.group_name ?? "" })}</span>
                    <span className="block truncate text-xs text-text-muted">
                      {f.date(r.starts_at)} {f.time(r.starts_at)} · {t("adminAttendance.history.unmarked", { count: r.unmarked })}
                    </span>
                  </span>
                  <Badge tone={WORKFLOW_TONE[r.workflow_status]}>{t(`attendanceOverview.workflow.${r.workflow_status}`)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
