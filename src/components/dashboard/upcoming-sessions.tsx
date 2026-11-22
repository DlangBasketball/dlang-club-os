import Link from "next/link";
import { CalendarClock, MapPin } from "lucide-react";
import { Avatar, Card, CardHeader, CardTitle, CardBody, EmptyState, ErrorState, SkeletonCard } from "@/components/ui";
import { photoUrlsForCoaches } from "@/lib/people/server";
import { getUpcomingSessions } from "@/lib/data/dashboard";
import { getI18n } from "@/lib/i18n/server";

/** Next programme sessions and team events (trainings, games ...), soonest first. */
export async function UpcomingSessions() {
  const { t, f } = await getI18n();
  const { data, error } = await getUpcomingSessions(5);
  if (error) return <ErrorState title={t("dashboard.widgets.upcoming.loadError")} message={error} />;
  const sessions = data!;
  const coachPhotos = await photoUrlsForCoaches(sessions.map((s) => s.coachId));
  const name = (s: (typeof sessions)[number]) =>
    s.title ?? (s.eventType ? t.dynamic(`staff.calendar.eventTypes.${s.eventType}`, undefined, s.eventType) : t("dashboard.widgets.upcoming.untitled"));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dashboard.widgets.upcoming.title")}</CardTitle>
        <Link href="/admin/calendar?view=list" className="text-xs text-maroon hover:underline">{t("dashboard.widgets.upcoming.viewCalendar")}</Link>
      </CardHeader>
      <CardBody className="p-0">
        {sessions.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<CalendarClock className="h-5 w-5" />} title={t("dashboard.widgets.upcoming.emptyTitle")} description={t("dashboard.widgets.upcoming.emptyBody")} />
          </div>
        ) : (
          <ul>
            {sessions.map((s) => (
              <li key={`${s.kind}:${s.id}`} className="border-b border-line-soft last:border-0">
                <Link href={s.href} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-elevated/60">
                  <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-md bg-surface-elevated text-maroon">
                    <CalendarClock className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{name(s)}</div>
                    <div className="flex items-center gap-2 text-xs text-ink-3">
                      {s.teamName && s.teamName !== s.title && <span className="truncate">{s.teamName}</span>}
                      {s.coachName && <span className="flex items-center gap-1.5"><Avatar name={s.coachName} src={s.coachId ? coachPhotos[s.coachId] ?? null : null} size="sm" />{s.coachName}</span>}
                      {s.location && (<><MapPin className="h-3 w-3" /><span className="truncate">{s.location}</span></>)}
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <div className="text-ink">{f.date(s.startsAt)}</div>
                    <div className="tnum text-ink-3">{f.time(s.startsAt)}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export { SkeletonCard as UpcomingSessionsSkeleton };
