import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, MapPin, Pencil } from "lucide-react";
import { PageHeader, Button, Card, CardHeader, CardTitle, CardBody, Badge, ErrorState } from "@/components/ui";
import { EventStatusControl, ResultForm, RsvpButtons } from "@/components/schedule/event-controls";
import { getEvent, listEvents } from "@/lib/sportsops/data";
import { eventTitle, eventTone, eventTypeLabel, RSVP_LABEL } from "@/lib/sportsops/labels";
import { dayKey, fmtRange, fmtTime } from "@/lib/sportsops/time";
import { getSessionUser } from "@/lib/auth/get-user";

export const metadata = { title: "Event" };

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ev, me] = await Promise.all([getEvent(id), getSessionUser()]);
  if (ev.error !== null) return <div className="animate-fade-up"><PageHeader title="Event" /><ErrorState message={ev.error} /></div>;
  const e = ev.data;
  if (!e) notFound();
  const isAdmin = !!me?.roles.includes("admin");
  const isGame = e.type === "game" || e.type === "tournament";

  // Resolve the clashing events for display.
  let clashes: { id: string; label: string; time: string }[] = [];
  if (e.conflictsWith.length) {
    const k = dayKey(e.startsAt);
    const around = await listEvents({ fromKey: k, toKey: dayKey(e.endsAt) });
    clashes = (around.data ?? []).filter((x) => e.conflictsWith.includes(x.id)).map((x) => ({
      id: x.id, label: eventTitle({ ...x, home_away: x.homeAway }), time: `${fmtTime(x.startsAt)}–${fmtTime(x.endsAt)}${x.spaceName ? ` · ${x.spaceName}` : ""}`,
    }));
  }
  const tally = { going: 0, maybe: 0, not_going: 0, none: 0 };
  for (const r of e.rsvps) tally[r.status ?? "none"] += 1;
  const where = e.venueName ? `${e.venueName}${e.spaceName ? ` · ${e.spaceName}` : ""}` : e.locationText ?? "Location TBC";
  const open = e.status !== "cancelled" && e.status !== "completed" && Date.parse(e.endsAt) > Date.now();

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={eventTitle({ ...e, home_away: e.homeAway })} description={fmtRange(e.startsAt, e.endsAt)}
        actions={isAdmin ? <Link href={`/admin/schedule/${e.id}/edit`}><Button size="sm" variant="secondary"><Pencil className="h-4 w-4" /> Edit</Button></Link> : undefined} />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={eventTone(e.type)}>{eventTypeLabel(e.type)}</Badge>
        {e.teamName && e.teamId && <Link href={`/admin/teams/${e.teamId}`}><Badge tone="neutral">{e.teamName}</Badge></Link>}
        {e.homeAway && <Badge>{e.homeAway}</Badge>}
        <span className="flex items-center gap-1 text-sm text-ink-2"><MapPin className="h-3.5 w-3.5" />{where}</span>
        <span className="ml-auto">{isAdmin && <EventStatusControl eventId={e.id} status={e.status} canDelete />}</span>
      </div>

      {clashes.length > 0 && (
        <Card className="border-warning"><CardBody className="py-4 text-sm">
          <div className="flex items-center gap-2 font-medium text-warning"><AlertTriangle className="h-4 w-4" /> Overlaps other bookings at {e.venueName}</div>
          <ul className="mt-1 text-ink-2">{clashes.map((c) => <li key={c.id}><Link className="hover:text-ink" href={`/admin/schedule/${c.id}`}>{c.label} · {c.time}</Link></li>)}</ul>
        </CardBody></Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Availability</CardTitle>
            <span className="text-xs text-ink-3 tnum"><span className="text-success">{tally.going} going</span> · {tally.maybe} maybe · {tally.not_going} out · {tally.none} no reply</span>
          </CardHeader>
          <CardBody className="space-y-3">
            {e.rsvps.length === 0 && <p className="text-sm text-ink-3">{e.teamId ? "No athletes on this team's roster yet." : "Club-wide event — RSVPs appear as families respond."}</p>}
            {e.rsvps.map((r) => (
              <div key={r.athleteId} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft pb-2 last:border-0">
                <div className="min-w-0">
                  <span className="font-mono text-xs text-ink-3">{r.jerseyNumber ?? ""}</span> <span className="text-sm text-ink">{r.name}</span>
                  {r.note && <p className="text-xs text-ink-3">“{r.note}”</p>}
                </div>
                {open && isAdmin ? <RsvpButtons eventId={e.id} athleteId={r.athleteId} current={r.status} compact />
                  : <Badge tone={r.status === "going" ? "success" : r.status === "not_going" ? "danger" : r.status === "maybe" ? "warning" : "neutral"}>{r.status ? RSVP_LABEL[r.status] : "No reply"}</Badge>}
              </div>
            ))}
          </CardBody>
        </Card>

        <div className="space-y-4">
          {isGame && (
            <Card>
              <CardHeader><CardTitle>Result</CardTitle>{e.result && <Badge tone={e.result.outcome === "win" ? "success" : e.result.outcome === "loss" ? "danger" : "neutral"}>{e.result.outcome}</Badge>}</CardHeader>
              <CardBody>
                {isAdmin ? <ResultForm eventId={e.id} scoreFor={e.result?.scoreFor} scoreAgainst={e.result?.scoreAgainst} notes={e.resultNotes} />
                  : e.result ? <p className="text-2xl font-semibold tnum">{e.result.scoreFor} – {e.result.scoreAgainst}</p> : <p className="text-sm text-ink-3">Not recorded yet.</p>}
              </CardBody>
            </Card>
          )}
          {e.notes && <Card><CardHeader><CardTitle>Notes</CardTitle></CardHeader><CardBody><p className="whitespace-pre-wrap text-sm text-ink-2">{e.notes}</p></CardBody></Card>}
        </div>
      </div>
    </div>
  );
}
