import { CalendarClock, MapPin } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, EmptyState, ErrorState, SkeletonCard } from "@/components/ui";
import { getUpcomingSessions } from "@/lib/data/dashboard";
import { formatDate, formatTime } from "@/lib/utils";

export async function UpcomingSessions() {
  const { data, error } = await getUpcomingSessions(5);
  if (error) return <ErrorState title="Couldn't load sessions" message={error} />;
  const sessions = data!;
  return (
    <Card>
      <CardHeader><CardTitle>Upcoming sessions</CardTitle></CardHeader>
      <CardBody className="p-0">
        {sessions.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<CalendarClock className="h-5 w-5" />} title="Nothing scheduled" description="No upcoming sessions on the calendar." />
          </div>
        ) : (
          <ul>
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 border-b border-line-soft px-5 py-3 last:border-0">
                <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-md bg-surface-elevated text-maroon">
                  <CalendarClock className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{s.programName}</div>
                  <div className="flex items-center gap-2 text-xs text-ink-3">
                    {s.coachName && <span>{s.coachName}</span>}
                    {s.location && (<><MapPin className="h-3 w-3" /><span className="truncate">{s.location}</span></>)}
                  </div>
                </div>
                <div className="text-right text-xs">
                  <div className="text-ink">{formatDate(s.startsAt)}</div>
                  <div className="tnum text-ink-3">{formatTime(s.startsAt)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export { SkeletonCard as UpcomingSessionsSkeleton };
