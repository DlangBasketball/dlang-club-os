import Link from "next/link";
import { CheckSquare, ChevronRight } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardMeta, CardTitle, EmptyState, Label, Select, StatCard, StatGrid } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { createFormatter } from "@/lib/format";
import { attendancePortalPath } from "@/lib/attendance/types";
import { attendanceTone, filterHistory, historyOptions, isBookedSession, summarize } from "@/lib/attendance/family";
import type { FamilyOverview } from "@/lib/attendance/family-data";
import { AbsenceControl } from "./absence-control";

/*
 * Parent / player portal sections (server components). They only render
 * what the overview RPCs return: the caller's own child (or self), finalized
 * values, no staff notes or other players. Times are shown in the club's
 * time zone (overview.timezone).
 */

async function clubFormatter(timeZone: string) {
  const { t, f } = await getI18n();
  return { t, f: createFormatter({ locale: f.locale, currency: f.currency, timeZone: timeZone || f.timeZone }) };
}

/** Upcoming sessions of all the child's teams: cancelled shown with reason, moved shown at the new time. */
export async function UpcomingSessions({ overview, athleteId }: { overview: FamilyOverview; athleteId: string }) {
  const { t, f } = await clubFormatter(overview.timezone);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("familyAttendance.upcoming.title")}</CardTitle>
          <CardMeta>{t("familyAttendance.upcoming.hint")}</CardMeta>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {overview.upcoming.length === 0 ? (
          <p className="px-5 py-6 text-sm text-text-muted">{t("familyAttendance.upcoming.empty")}</p>
        ) : (
          <ul>
            {overview.upcoming.map((s) => {
              const cancelled = s.status === "cancelled";
              const booked = isBookedSession(s);
              return (
                <li key={s.event_id} className="border-b border-border px-5 py-3 last:border-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className={cancelled ? "text-sm text-text-muted line-through" : "text-sm text-text"}>
                        {f.dateTime(s.starts_at, "full")}
                      </div>
                      <div className="text-xs text-text-muted">
                        {booked ? t("bookingPortal.bookedSession") : t.dynamic(`familyAttendance.upcoming.types.${s.type}`, undefined, s.type)} · {s.team_name}
                        {s.location ? ` · ${s.location}` : ""}
                      </div>
                      {s.rescheduled_from && !cancelled && (
                        <div className="mt-1 text-xs text-warning">{t("familyAttendance.upcoming.rescheduled", { when: f.dateTime(s.rescheduled_from, "medium") })}</div>
                      )}
                    </div>
                    {cancelled ? (
                      <Badge tone="danger">
                        {s.cancel_reason ? t("familyAttendance.upcoming.cancelledReason", { reason: s.cancel_reason }) : t("familyAttendance.upcoming.cancelled")}
                      </Badge>
                    ) : s.status === "postponed" ? (
                      <Badge tone="warning">{t("familyAttendance.upcoming.postponed")}</Badge>
                    ) : s.today_state === "in_progress" ? (
                      <Badge tone="info">{t("familyAttendance.upcoming.inProgress")}</Badge>
                    ) : s.today_state === "awaiting_attendance" ? (
                      <Badge tone="neutral">{t("familyAttendance.upcoming.awaitingAttendance")}</Badge>
                    ) : null}
                  </div>
                  {/* Team sessions and booked sessions (since 20250420104700) take absence reports until they start. */}
                  {!cancelled && !s.today_state && (
                    <AbsenceControl eventId={s.event_id} athleteId={athleteId} report={s.report} canReport={s.can_report} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Finalized attendance history with team / season filters (plain GET form)
 * and totals. `recordLinks`: link each row to the guardian record page.
 */
export async function AttendanceHistory({ overview, basePath, hidden, teamId, seasonId, recordLinks }: {
  overview: FamilyOverview;
  basePath: string;
  /** Extra query params to keep (e.g. athlete). */
  hidden?: Record<string, string>;
  teamId: string | null;
  seasonId: string | null;
  recordLinks: boolean;
}) {
  const { t, f } = await clubFormatter(overview.timezone);
  const options = historyOptions(overview.history);
  const rows = filterHistory(overview.history, { teamId, seasonId });
  const totals = summarize(rows);
  return (
    <section className="space-y-4" aria-labelledby="attendance-history">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="attendance-history" className="font-display text-xl font-medium text-text">{t("familyAttendance.history.title")}</h2>
          <p className="text-xs text-text-muted">{t("familyAttendance.history.hint")}</p>
        </div>
        {(options.teams.length > 1 || options.seasons.length > 1) && (
          <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
            {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            {options.teams.length > 1 && (
              <div>
                <Label htmlFor="history-team">{t("familyAttendance.history.team")}</Label>
                <Select id="history-team" name="team" defaultValue={teamId ?? ""} className="w-auto">
                  <option value="">{t("familyAttendance.history.allTeams")}</option>
                  {options.teams.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              </div>
            )}
            {options.seasons.length > 1 && (
              <div>
                <Label htmlFor="history-season">{t("familyAttendance.history.season")}</Label>
                <Select id="history-season" name="season" defaultValue={seasonId ?? ""} className="w-auto">
                  <option value="">{t("familyAttendance.history.allSeasons")}</option>
                  {options.seasons.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              </div>
            )}
            <Button type="submit" size="sm" variant="secondary">{t("familyAttendance.history.filter")}</Button>
          </form>
        )}
      </div>

      <StatGrid className="lg:grid-cols-3">
        <StatCard label={t("familyAttendance.totals.sessions")} value={f.number(totals.sessions)} />
        <StatCard label={t("familyAttendance.totals.rate")} value={totals.rate === null ? "—" : f.percent(totals.rate)} hint={t("familyAttendance.totals.rateHint")} tone="accent" />
        <StatCard label={t("familyAttendance.totals.present")} value={f.number(totals.present)} tone="success" />
        <StatCard label={t("familyAttendance.totals.late")} value={f.number(totals.late)} tone="warning" />
        <StatCard label={t("familyAttendance.totals.excused")} value={f.number(totals.excused)} tone="brand" />
        <StatCard label={t("familyAttendance.totals.unexcused")} value={f.number(totals.unexcused)} tone="danger" />
      </StatGrid>

      {rows.length === 0 ? (
        <EmptyState icon={<CheckSquare className="h-5 w-5" />} title={t("familyAttendance.history.empty")} />
      ) : (
        <Card>
          <CardBody className="p-0">
            <ul>
              {rows.map((r) => {
                const booked = isBookedSession(r);
                // Team and booked sessions share the record page (correction requests included).
                const link = recordLinks;
                const inner = (
                  <>
                    <div className="min-w-0">
                      <div className="text-sm text-text">{f.dateTime(r.starts_at, "medium")}</div>
                      <div className="text-xs text-text-muted">
                        {booked ? t("bookingPortal.bookedSession") : t.dynamic(`familyAttendance.upcoming.types.${r.type}`, undefined, r.type)} · {r.team_name}
                        {r.season_name ? ` · ${r.season_name}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      {r.is_guest && <Badge>{t("familyAttendance.history.guest")}</Badge>}
                      {r.open_request && <Badge tone="info">{t("familyAttendance.history.correctionOpen")}</Badge>}
                      <Badge tone={attendanceTone(r.status)}>{t.dynamic(`teamAttendance.statuses.${r.status}`, undefined, r.status)}</Badge>
                      {link && <ChevronRight aria-hidden className="h-4 w-4 text-text-subtle" />}
                    </div>
                  </>
                );
                return (
                  <li key={r.event_id} className="border-b border-border last:border-0">
                    {link ? (
                      <Link href={attendancePortalPath(r.event_id, overview.athlete.id)}
                        className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-elevated focus-visible:bg-surface-elevated focus-visible:outline-none">
                        {inner}
                      </Link>
                    ) : (
                      <div className="flex items-center justify-between gap-3 px-5 py-3">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      )}
    </section>
  );
}

