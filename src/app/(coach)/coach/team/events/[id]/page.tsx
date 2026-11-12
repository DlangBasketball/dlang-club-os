import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { EventCancelNote, EventPlaceView } from "@/components/schedule/event-place";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, ErrorState } from "@/components/ui";
import { EventStatusControl, ResultForm, RsvpButtons } from "@/components/schedule/event-controls";
import { getEvent, getMyCoachTeams } from "@/lib/sportsops/data";
import { eventTitle, eventTone, eventTypeLabel } from "@/lib/sportsops/labels";
import { fmtRange } from "@/lib/sportsops/time";

export const metadata = { title: "Event" };

export default async function CoachEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ev, mine] = await Promise.all([getEvent(id), getMyCoachTeams()]);
  if (ev.error !== null) return <div className="animate-fade-up"><PageHeader title="Event" /><ErrorState message={ev.error} /></div>;
  const e = ev.data;
  if (!e) notFound();
  const manages = !!e.teamId && (mine.data ?? []).some((t) => t.id === e.teamId);
  const isGame = e.type === "game" || e.type === "tournament";
  const open = e.status !== "cancelled" && e.status !== "completed" && Date.parse(e.endsAt) > Date.now();
  const tally = { going: 0, maybe: 0, not_going: 0, none: 0 };
  for (const r of e.rsvps) tally[r.status ?? "none"] += 1;

  return (
    <div className="animate-fade-up space-y-5">
      <Link href="/coach/team" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> My team</Link>
      <PageHeader title={eventTitle({ ...e, home_away: e.homeAway })} description={fmtRange(e.startsAt, e.endsAt)} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={eventTone(e.type)}>{eventTypeLabel(e.type)}</Badge>
        <EventPlaceView e={e} withMap className="text-sm text-ink-2" iconClassName="h-3.5 w-3.5" />
        {manages && <span className="ml-auto"><EventStatusControl eventId={e.id} status={e.status} seriesId={e.seriesId} /></span>}
      </div>
      {e.status === "cancelled" && <EventCancelNote reason={e.cancelReason} />}
      {e.notes && <p className="whitespace-pre-wrap text-sm text-ink-2">{e.notes}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Availability</CardTitle>
          <span className="text-xs text-ink-3 tnum"><span className="text-success">{tally.going}</span> / {tally.maybe} / {tally.not_going} · {tally.none} no reply</span>
        </CardHeader>
        <CardBody className="space-y-2.5">
          {e.rsvps.length === 0 && <p className="text-sm text-ink-3">No roster athletes.</p>}
          {e.rsvps.map((r) => (
            <div key={r.athleteId} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft pb-2 last:border-0">
              <div><span className="font-mono text-xs text-ink-3">{r.jerseyNumber ?? ""}</span> <span className="text-sm text-ink">{r.name}</span>{r.note && <p className="text-xs text-ink-3">“{r.note}”</p>}</div>
              {manages && open ? <RsvpButtons eventId={e.id} athleteId={r.athleteId} current={r.status} compact />
                : <Badge tone={r.status === "going" ? "success" : r.status === "not_going" ? "danger" : r.status === "maybe" ? "warning" : "neutral"}>{r.status ?? "no reply"}</Badge>}
            </div>
          ))}
        </CardBody>
      </Card>

      {isGame && (
        <Card>
          <CardHeader><CardTitle>Result</CardTitle></CardHeader>
          <CardBody>
            {manages ? <ResultForm eventId={e.id} scoreFor={e.result?.scoreFor} scoreAgainst={e.result?.scoreAgainst} notes={e.resultNotes} />
              : e.result ? <p className="text-2xl font-semibold tnum">{e.result.scoreFor} – {e.result.scoreAgainst}</p> : <p className="text-sm text-ink-3">Not recorded yet.</p>}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
