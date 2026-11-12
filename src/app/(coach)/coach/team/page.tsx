import Link from "next/link";
import { CalendarPlus, Shield } from "lucide-react";
import { PageHeader, Button, Card, CardHeader, CardTitle, CardBody, Badge, EmptyState, ErrorState } from "@/components/ui";
import { RosterManager } from "@/components/teams/roster-manager";
import { EventList } from "@/components/schedule/event-views";
import { getMyCoachTeams, listUpcomingEvents, rsvpCounts } from "@/lib/sportsops/data";
import { LABELS } from "@/lib/sportsops/labels";

export const metadata = { title: "My team" };

export default async function CoachTeamPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const sp = await searchParams;
  const teams = await getMyCoachTeams();
  if (teams.error !== null) return <div className="animate-fade-up"><PageHeader title={`My ${LABELS.team.toLowerCase()}`} /><ErrorState message={teams.error} /></div>;
  if (!teams.data.length) {
    return (
      <div className="animate-fade-up">
        <PageHeader title={`My ${LABELS.team.toLowerCase()}`} />
        <EmptyState icon={<Shield className="h-5 w-5" />} title="No team assigned" description="Ask a club admin to add you as a coach on a team." />
      </div>
    );
  }
  const team = teams.data.find((t) => t.id === sp.team) ?? teams.data[0];
  const upcoming = await listUpcomingEvents({ teamIds: [team.id], limit: 12 });
  const counts = await rsvpCounts((upcoming.data ?? []).map((e) => e.id));
  const active = team.roster.filter((r) => r.status !== "inactive");

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={team.name} description={[team.sport, team.ageGroup, team.level, team.seasonName].filter(Boolean).join(" · ") || undefined}
        actions={<Link href={`/coach/team/events/new?team=${team.id}`}><Button size="sm"><CalendarPlus className="h-4 w-4" /> Add event</Button></Link>} />

      {teams.data.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {teams.data.map((t) => (
            <Link key={t.id} href={`/coach/team?team=${t.id}`}><Badge tone={t.id === team.id ? "maroon" : "neutral"}>{t.name}</Badge></Link>
          ))}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Upcoming</CardTitle><span className="text-xs text-ink-3">Tap an event for availability</span></CardHeader>
        <CardBody>
          {upcoming.error !== null ? <ErrorState compact message={upcoming.error} /> :
            <EventList events={upcoming.data} href={(id) => `/coach/team/events/${id}`} rsvp={counts}
              empty={<p className="text-sm text-ink-3">Nothing scheduled yet.</p>} />}
        </CardBody>
      </Card>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{LABELS.roster} <span className="text-sm font-normal text-ink-3">({active.length})</span></h2>
        {/* Coaches maintain jersey/position/status; adding athletes is an admin task (athlete records are org-wide). */}
        <RosterManager teamId={team.id} roster={team.roster} athletes={[]} canAdd={false} />
      </section>
    </div>
  );
}
