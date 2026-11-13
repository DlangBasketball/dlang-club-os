import Link from "next/link";
import { Bell, CalendarDays, CalendarClock, CheckSquare, ChevronRight, ClipboardCheck, ClipboardList, MapPin, NotebookPen, Timer } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, EmptyState, statusTone } from "@/components/ui";
import { ClockWidget } from "@/components/staff/clock-widget";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getNavNotifications } from "@/lib/data/notifications";
import { listCoachSessions } from "@/lib/data/coach-sessions";
import { staffDb } from "@/lib/staff/db";
import { getMyClockState, lessonPlansFor } from "@/lib/staff/data";
import { addDayKey, zonedDayKey } from "@/lib/staff/hours";
import { loadCalendarItems, resolveScope } from "@/lib/calendar/data";
import { groupByDay, type CalendarItem } from "@/lib/calendar/aggregate";
import { COACH_EVALUATIONS_HREF } from "@/lib/staff/features";

/**
 * Employee dashboard (coach app home): clock-in, today's classes with the
 * roll-call and lesson-plan shortcuts, the next days, notifications and links
 * to the calendar and roll-call history.
 */
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("staff.dashboard.title") };
}

export default async function CoachHomePage() {
  const [{ t, f }, me] = await Promise.all([getI18n(), getSessionUser()]);
  if (!me?.orgId) return null;
  const tz = f.timeZone;
  const today = zonedDayKey(new Date(), tz);
  const db = await staffDb();
  const scope = await resolveScope(db, me.orgId, me.id, "coach");
  const [items, clock, sessions, notifs] = await Promise.all([
    loadCalendarItems(db, scope, { from: today, to: addDayKey(today, 6), timeZone: tz }, t).catch(() => [] as CalendarItem[]),
    getMyClockState(me.orgId, me.id, tz),
    listCoachSessions({ todayOnly: true }),
    getNavNotifications(),
  ]);
  const days = groupByDay(items, today, addDayKey(today, 6), tz);
  const todays = (days.get(today) ?? []).filter((i) => i.kind !== "shift");
  const upcoming = Array.from(days.entries()).filter(([d]) => d !== today).flatMap(([, list]) => list).filter((i) => i.kind !== "shift" && i.kind !== "club_event").slice(0, 6);
  const attendance = new Map((sessions.data ?? []).map((s) => [s.programSessionId, s.attendanceStatus]));
  const plans = await lessonPlansFor(me.orgId, {
    sessionIds: todays.filter((i) => i.kind === "session").map((i) => i.sourceId),
    eventIds: todays.filter((i) => i.kind === "team_event").map((i) => i.sourceId),
  });
  const first = me.fullName?.split(" ")[0];
  const open = clock.data?.open ?? null;

  const links = [
    { href: "/coach/calendar", icon: CalendarDays, title: t("staff.dashboard.calendar"), hint: t("staff.dashboard.calendarHint") },
    { href: "/coach/roll-calls", icon: ClipboardCheck, title: t("staff.dashboard.rollCalls"), hint: t("staff.dashboard.rollCallsHint") },
    ...(COACH_EVALUATIONS_HREF ? [{ href: COACH_EVALUATIONS_HREF, icon: ClipboardList, title: t("staff.dashboard.evaluations"), hint: t("staff.dashboard.evaluationsHint") }] : []),
    { href: "/coach/attendance", icon: CheckSquare, title: t("staff.dashboard.allSessions"), hint: t("staff.dashboard.allSessionsHint") },
  ];

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={first ? t("staff.dashboard.greeting", { name: first }) : t("staff.dashboard.greetingAnon")} description={t("staff.dashboard.description")} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Timer className="h-4 w-4" /> {t("staff.dashboard.clockCard")}</CardTitle>
          <Link href="/coach/clock" className="text-sm text-brand-primary hover:underline">{t("staff.dashboard.openClock")}</Link>
        </CardHeader>
        <CardBody>
          {(clock.data?.missed.length ?? 0) > 0 && (
            <p role="alert" className="mb-3 text-sm text-warning">{t("staff.clock.missedTitle")}</p>
          )}
          <ClockWidget compact venues={[]}
            open={open ? { clockInAt: open.clockInAt, breaks: open.breaks, linkedTitle: open.linkedTitle, venueName: open.venueName } : null} />
        </CardBody>
      </Card>

      <section className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">{t("staff.dashboard.today")}</h2>
        {todays.length === 0 ? (
          <EmptyState icon={<CalendarClock />} title={t("staff.dashboard.noToday")} />
        ) : (
          todays.map((i) => {
            const rollCall = i.kind === "session" ? `/coach/attendance/${i.sourceId}` : i.kind === "team_event" ? `/coach/team/events/${i.sourceId}` : null;
            const planKind = i.kind === "session" ? "session" : i.kind === "team_event" ? "event" : null;
            const status = i.kind === "session" ? attendance.get(i.sourceId) : undefined;
            const hasPlan = plans.has(i.sourceId);
            return (
              <Card key={i.id} className={i.status === "cancelled" ? "opacity-60" : undefined}>
                <CardBody className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium text-text">{i.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                      <span className="tnum flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{i.allDay ? t("staff.calendar.allDay") : `${f.time(i.start)}–${f.time(i.end)}`}</span>
                      {i.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{i.location}</span>}
                      <span>{t.dynamic(`staff.calendar.kinds.${i.kind}`)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {status && <Badge tone={statusTone(status === "not_started" ? "open" : status)}>{t.dynamic(`staff.dashboard.attendance.${status}`)}</Badge>}
                    {planKind && (
                      <Link href={`/coach/lesson-plans/${planKind}/${i.sourceId}`} className="inline-flex h-10 items-center gap-1.5 rounded border border-border px-3 text-sm text-text hover:border-brand-primary">
                        <NotebookPen className="h-4 w-4" /> {hasPlan ? t("staff.dashboard.lessonPlan") : t("staff.dashboard.lessonPlanAdd")}
                      </Link>
                    )}
                    {rollCall && (
                      <Link href={rollCall} className="inline-flex h-10 items-center gap-1.5 rounded border border-brand-primary bg-brand-primary px-3 text-sm text-on-brand">
                        <CheckSquare className="h-4 w-4" /> {t("staff.dashboard.rollCall")}
                      </Link>
                    )}
                  </div>
                </CardBody>
              </Card>
            );
          })
        )}
      </section>

      {upcoming.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("staff.dashboard.upcoming")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="space-y-2 text-sm">
              {upcoming.map((i) => (
                <li key={i.id}>
                  <Link href={i.href ?? "/coach/calendar"} className="flex items-center justify-between gap-2 hover:text-brand-primary">
                    <span className="min-w-0 truncate text-text">{i.title}</span>
                    <span className="tnum shrink-0 text-text-muted">{f.date(i.start, { weekday: true })}{i.allDay ? "" : ` · ${f.time(i.start)}`}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="block">
            <Card className="h-full transition hover:border-brand-primary/40">
              <CardBody className="flex items-center gap-3 py-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand-primary-soft text-brand-primary"><l.icon className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-text">{l.title}</div>
                  <div className="text-xs text-text-muted">{l.hint}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-text-muted" />
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="h-4 w-4" /> {t("staff.dashboard.notifications")}</CardTitle></CardHeader>
        <CardBody>
          {notifs.items.length === 0 ? (
            <p className="text-sm text-text-muted">{t("staff.dashboard.noNotifications")}</p>
          ) : (
            <ul className="space-y-2.5">
              {notifs.items.slice(0, 5).map((n) => {
                const body = (
                  <div className="text-sm">
                    <div className={n.readAt ? "text-text-muted" : "font-medium text-text"}>{n.title}</div>
                    {n.body && <div className="line-clamp-2 text-xs text-text-muted">{n.body}</div>}
                    <div className="text-[11px] text-text-muted">{f.relative(n.createdAt)}</div>
                  </div>
                );
                return <li key={n.id}>{n.link && n.link.startsWith("/") ? <Link href={n.link} className="block hover:opacity-80">{body}</Link> : body}</li>;
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
