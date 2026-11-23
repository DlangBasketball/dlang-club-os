import Link from "next/link";
import { CalendarClock, MapPin, ChevronRight, Dumbbell } from "lucide-react";
import { PageHeader, Card, CardBody, Badge, EmptyState, ErrorState } from "@/components/ui";
import { sessionKindLabel } from "@/components/booking/portal/coach-session";
import { listCoachSessions } from "@/lib/data/coach-sessions";
import { getCoachAgenda } from "@/lib/booking/data";
import { toBookedSessionInfo, type BookedSessionInfo } from "@/lib/booking/portal";
import { getI18n } from "@/lib/i18n/server";

type Item =
  | { kind: "session"; id: string; title: string; at: string; location: string | null; roster: number | null; href: string }
  | { kind: "booked"; id: string; title: string; at: string; location: string | null; session: BookedSessionInfo; href: string | null };

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("nav.schedule") };
}

/**
 * Coach schedule: upcoming programme sessions and the booked private / group
 * sessions the coach leads (coach_booking_agenda: service, time, place and
 * participants' names; no price, payer or invoice). Booked sessions open the
 * trainings page of their event, where attendance is taken.
 */
export default async function CoachSchedulePage() {
  const [{ t, f }, sessions, agenda] = await Promise.all([
    getI18n(), listCoachSessions(),
    getCoachAgenda({ from: new Date(Date.now() - 2 * 36e5).toISOString(), to: new Date(Date.now() + 60 * 864e5).toISOString() }),
  ]);
  const title = t("nav.schedule");
  if (sessions.error) {
    return (<div className="animate-fade-up"><PageHeader title={title} /><ErrorState title={t("bookingPortal.schedule.loadError")} message={sessions.error} /></div>);
  }

  // Upcoming only (listCoachSessions also returns the last week for attendance).
  const now = Date.now() - 2 * 36e5;
  const items: Item[] = [
    ...(sessions.data ?? []).filter((s) => new Date(s.startsAt).getTime() >= now).map((s): Item => ({
      kind: "session", id: s.programSessionId, title: s.programName, at: s.startsAt, location: s.location, roster: s.rosterSize, href: `/coach/attendance/${s.programSessionId}`,
    })),
    ...(agenda.data ?? []).map(toBookedSessionInfo).filter((s) => s.status !== "cancelled").map((s): Item => ({
      kind: "booked", id: s.sessionId, title: s.serviceName, at: s.startsAt, location: s.location, session: s,
      href: s.eventId ? `/coach/trainings/${s.eventId}` : null,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const key = f.date(it.at, { weekday: true });
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title={title} description={t("bookingPortal.schedule.description")} />
      {items.length === 0 ? (
        <EmptyState icon={<CalendarClock className="h-5 w-5" />} title={t("bookingPortal.schedule.empty")} />
      ) : (
        <div className="space-y-6">
          {Array.from(groups, ([day, rows]) => (
            <section key={day}>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">{day}</h2>
              <div className="space-y-2">
                {rows.map((s) => {
                  const names = s.kind === "booked" ? s.session.participants.map((p) => p.name).join(", ") : "";
                  const body = (
                    <Card className="transition-all hover:border-brand-primary/50">
                      <CardBody className="flex items-center gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-surface-elevated text-brand-primary">
                          {s.kind === "session" ? <CalendarClock className="h-5 w-5" aria-hidden /> : <Dumbbell className="h-5 w-5" aria-hidden />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-text">{s.title}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
                            <span className="tnum">{f.time(s.at)}</span>
                            {s.location && (<><span aria-hidden>·</span><MapPin className="h-3 w-3" aria-hidden /><span className="truncate">{s.location}</span></>)}
                            {names && (<><span aria-hidden>·</span><span className="truncate">{names}</span></>)}
                          </div>
                        </div>
                        {s.kind === "session" && s.roster !== null && <Badge tone="neutral">{s.roster}</Badge>}
                        {s.kind === "booked" && <Badge tone="accent">{sessionKindLabel(s.session.kind, t)}</Badge>}
                        {s.href && <ChevronRight className="h-4 w-4 text-text-subtle" aria-hidden />}
                      </CardBody>
                    </Card>
                  );
                  return s.href
                    ? <Link key={`${s.kind}-${s.id}`} href={s.href} className="block">{body}</Link>
                    : <div key={`${s.kind}-${s.id}`}>{body}</div>;
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
