import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, MapPin, Plus } from "lucide-react";
import { PageHeader, Button, ErrorState, Card, CardBody } from "@/components/ui";
import { selectClass } from "@/components/teams/fields";
import { EventList, WeekView } from "@/components/schedule/event-views";
import { listEvents, listTeams, rsvpCounts } from "@/lib/sportsops/data";
import { eventTitle } from "@/lib/sportsops/labels";
import { addDays, dayKey, fmtDayKey, fmtTime, isDayKey, weekStart } from "@/lib/sportsops/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Schedule" };

type SP = { view?: string; week?: string; team?: string };

export default async function SchedulePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const view = sp.view === "list" ? "list" : "week";
  const start = weekStart(isDayKey(sp.week) ? sp.week : dayKey(new Date()));
  const end = view === "week" ? addDays(start, 6) : addDays(start, 27);
  const teamFilter = sp.team && /^[0-9a-f-]{36}$/i.test(sp.team) ? sp.team : undefined;

  const [events, teams] = await Promise.all([
    listEvents({ fromKey: start, toKey: end, teamIds: teamFilter ? [teamFilter] : undefined, includeCancelled: view === "list" }),
    listTeams(),
  ]);
  if (events.error !== null) return <div className="animate-fade-up"><PageHeader title="Schedule" /><ErrorState message={events.error} /></div>;
  // Exact day range (events were fetched with a timezone pad).
  const inRange = events.data.filter((e) => { const k = dayKey(e.startsAt); return k >= start && k <= end; });
  const conflicts = inRange.filter((e) => e.conflictsWith.length > 0);
  const counts = view === "list" ? await rsvpCounts(inRange.map((e) => e.id)) : undefined;

  const step = view === "week" ? 7 : 28;
  const q = (over: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged = { view, week: start, team: teamFilter, ...over };
    Object.entries(merged).forEach(([k, v]) => { if (v) p.set(k, v); });
    return `/admin/schedule?${p.toString()}`;
  };
  const href = (id: string) => `/admin/schedule/${id}`;

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title="Schedule" description="Trainings, games and club events across all teams and venues."
        actions={<>
          <Link href="/admin/schedule/venues"><Button size="sm" variant="secondary"><MapPin className="h-4 w-4" /> Venues</Button></Link>
          <Link href={`/admin/schedule/new${teamFilter ? `?team=${teamFilter}` : ""}`}><Button size="sm"><Plus className="h-4 w-4" /> New event</Button></Link>
        </>} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Link href={q({ week: addDays(start, -step) })} aria-label="Previous"><Button size="icon" variant="secondary" className="h-9 w-9"><ChevronLeft className="h-4 w-4" /></Button></Link>
          <Link href={q({ week: dayKey(new Date()) })}><Button size="sm" variant="secondary" className="h-9">Today</Button></Link>
          <Link href={q({ week: addDays(start, step) })} aria-label="Next"><Button size="icon" variant="secondary" className="h-9 w-9"><ChevronRight className="h-4 w-4" /></Button></Link>
        </div>
        <span className="text-sm font-medium text-ink">{fmtDayKey(start)} – {fmtDayKey(end)}</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded border border-line p-0.5 text-xs">
            {(["week", "list"] as const).map((v) => (
              <Link key={v} href={q({ view: v })} className={cn("rounded px-3 py-1.5 capitalize", view === v ? "bg-maroon text-inverse" : "text-ink-2 hover:text-ink")}>{v}</Link>
            ))}
          </div>
          <form method="get" className="flex items-center gap-2">
            <input type="hidden" name="view" value={view} /><input type="hidden" name="week" value={start} />
            <select name="team" defaultValue={teamFilter ?? ""} className={`${selectClass} h-9 w-48`} aria-label="Team filter">
              <option value="">All teams</option>
              {(teams.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <Button size="sm" variant="secondary" type="submit" className="h-9">Apply</Button>
          </form>
        </div>
      </div>

      {conflicts.length > 0 && (
        <Card className="border-warning">
          <CardBody className="space-y-1 py-4 text-sm">
            <div className="flex items-center gap-2 font-medium text-warning"><AlertTriangle className="h-4 w-4" /> {conflicts.length} booking conflict{conflicts.length === 1 ? "" : "s"} this period</div>
            <ul className="text-ink-2">
              {conflicts.slice(0, 6).map((e) => (
                <li key={e.id}>
                  <Link href={href(e.id)} className="hover:text-ink">{fmtDayKey(dayKey(e.startsAt))} {fmtTime(e.startsAt)} · {eventTitle({ ...e, home_away: e.homeAway })} at {e.venueName}{e.spaceName ? ` (${e.spaceName})` : ""}</Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {view === "week" ? <WeekView start={start} events={inRange} href={href} /> : <EventList events={inRange} href={href} rsvp={counts} />}
    </div>
  );
}
