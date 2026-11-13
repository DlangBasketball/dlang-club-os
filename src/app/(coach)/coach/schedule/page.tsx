import Link from "next/link";
import { CalendarClock, MapPin, ChevronRight, Dumbbell } from "lucide-react";
import { PageHeader, Card, CardBody, Badge, EmptyState, ErrorState } from "@/components/ui";
import { listCoachSessions, listCoachBookings } from "@/lib/data/coach-sessions";
import { getI18n } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { term, termOr } from "@/lib/tenant/terms";

type Item =
  | { kind: "session"; id: string; title: string; at: string; location: string | null; roster: number | null; href: string }
  | { kind: "booking"; id: string; title: string; at: string; athlete: string | null };

export default async function CoachSchedulePage() {
  const [{ t, f }, tenant, sessions, bookings] = await Promise.all([getI18n(), getTenant(), listCoachSessions(), listCoachBookings()]);
  const title = t("nav.schedule");
  const error = sessions.error ?? bookings.error;
  if (error) return (<div className="animate-fade-up"><PageHeader title={title} /><ErrorState title="Couldn't load your schedule" message={error} /></div>);

  // Upcoming only (listCoachSessions also returns the last week for attendance).
  const now = Date.now() - 2 * 36e5;
  const items: Item[] = [
    ...sessions.data!.filter((s) => new Date(s.startsAt).getTime() >= now).map((s): Item => ({
      kind: "session", id: s.programSessionId, title: s.programName, at: s.startsAt, location: s.location, roster: s.rosterSize, href: `/coach/attendance/${s.programSessionId}`,
    })),
    ...bookings.data!.map((b): Item => ({ kind: "booking", id: b.id, title: b.serviceName, at: b.startsAt, athlete: b.athleteName })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const key = f.date(it.at, { weekday: true });
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  const sessionsWord = termOr(tenant.terminology, "session", "sessions", { plural: true, case: "lower" });

  return (
    <div className="animate-fade-up">
      <PageHeader title={title} description={`Your upcoming ${sessionsWord} and bookings.`} />
      {items.length === 0 ? (
        <EmptyState icon={<CalendarClock className="h-5 w-5" />} title={`No upcoming ${term(tenant.terminology, "session", { plural: true, case: "lower" })}`} />
      ) : (
        <div className="space-y-6">
          {Array.from(groups, ([day, rows]) => (
            <section key={day}>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">{day}</h2>
              <div className="space-y-2">
                {rows.map((s) => {
                  const body = (
                    <Card className="transition-all hover:border-maroon/50">
                      <CardBody className="flex items-center gap-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-surface-elevated text-maroon">
                          {s.kind === "session" ? <CalendarClock className="h-5 w-5" /> : <Dumbbell className="h-5 w-5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-ink">{s.title}</div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
                            <span className="tnum">{f.time(s.at)}</span>
                            {s.kind === "session" && s.location && (<><span>·</span><MapPin className="h-3 w-3" /><span className="truncate">{s.location}</span></>)}
                            {s.kind === "booking" && s.athlete && (<><span>·</span><span className="truncate">{s.athlete}</span></>)}
                          </div>
                        </div>
                        {s.kind === "session" && s.roster !== null && <Badge tone="neutral">{s.roster}</Badge>}
                        {s.kind === "booking" && <Badge tone="maroon">booked</Badge>}
                        {s.kind === "session" && <ChevronRight className="h-4 w-4 text-ink-4" />}
                      </CardBody>
                    </Card>
                  );
                  return s.kind === "session"
                    ? <Link key={`s-${s.id}`} href={s.href} className="block">{body}</Link>
                    : <div key={`b-${s.id}`}>{body}</div>;
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
