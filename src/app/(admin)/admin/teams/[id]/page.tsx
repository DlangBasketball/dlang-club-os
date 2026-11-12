import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, Pencil } from "lucide-react";
import { PageHeader, Button, Card, CardHeader, CardTitle, CardBody, Badge, ErrorState } from "@/components/ui";
import { RosterManager } from "@/components/teams/roster-manager";
import { EventList } from "@/components/schedule/event-views";
import { getTeam, listAthleteOptions, listUpcomingEvents, rsvpCounts } from "@/lib/sportsops/data";
import { labelsFor } from "@/lib/sportsops/labels";
import { getTenant } from "@/lib/tenant/server";

export const metadata = { title: "Team" };

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const LABELS = labelsFor((await getTenant()).terminology);
  const { id } = await params;
  const [team, athletes, upcoming] = await Promise.all([getTeam(id), listAthleteOptions(), listUpcomingEvents({ teamIds: [id], limit: 8 })]);
  const error = team.error ?? athletes.error ?? upcoming.error;
  if (error) return <div className="animate-fade-up"><PageHeader title={LABELS.team} /><ErrorState message={error} /></div>;
  const t = team.data;
  if (!t) notFound();
  const counts = await rsvpCounts(upcoming.data!.map((e) => e.id));

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t.name}
        description={[t.sport, t.ageGroup, t.gender, t.level, t.seasonName].filter(Boolean).join(" · ") || undefined}
        actions={<>
          <Link href={`/admin/schedule/new?team=${t.id}`}><Button size="sm" variant="secondary"><CalendarPlus className="h-4 w-4" /> Add event</Button></Link>
          <Link href={`/admin/teams/${t.id}/edit`}><Button size="sm" variant="secondary"><Pencil className="h-4 w-4" /> Edit</Button></Link>
        </>} />

      <div className="flex flex-wrap gap-2">
        {t.coaches.length === 0 && <Badge tone="warning">No coach assigned</Badge>}
        {t.coaches.map((c) => <Badge key={c.id} tone="maroon">{c.name} · {c.role}</Badge>)}
        {!t.isActive && <Badge>inactive</Badge>}
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{LABELS.roster} <span className="text-sm font-normal text-ink-3">({t.roster.filter((r) => r.status !== "inactive").length})</span></h2>
        <RosterManager teamId={t.id} roster={t.roster} athletes={athletes.data!} />
      </section>

      <Card>
        <CardHeader><CardTitle>Upcoming</CardTitle><Link href={`/admin/schedule?view=list&team=${t.id}`} className="text-xs text-ink-3 hover:text-ink">Full schedule →</Link></CardHeader>
        <CardBody>
          <EventList events={upcoming.data!} href={(eid) => `/admin/schedule/${eid}`} rsvp={counts}
            empty={<p className="text-sm text-ink-3">Nothing scheduled for this team yet.</p>} />
        </CardBody>
      </Card>
      {t.notes && <Card><CardBody><p className="whitespace-pre-wrap text-sm text-ink-2">{t.notes}</p></CardBody></Card>}
    </div>
  );
}
