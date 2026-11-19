import { PageHeader, Card, CardBody, EmptyState, ErrorState } from "@/components/ui";
import { EventForm } from "@/components/schedule/event-form";
import { getMyCoachTeams, listVenues } from "@/lib/sportsops/data";
import { dayKey } from "@/lib/sportsops/time";

export const metadata = { title: "New event" };

export default async function CoachNewEventPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const sp = await searchParams;
  const [teams, venues] = await Promise.all([getMyCoachTeams(), listVenues()]);
  const error = teams.error ?? venues.error;
  if (error) return <div className="animate-fade-up"><PageHeader title="New event" /><ErrorState message={error} /></div>;
  if (!teams.data!.length) return <div className="animate-fade-up"><PageHeader title="New event" /><EmptyState title="No team assigned" /></div>;
  const teamId = teams.data!.find((t) => t.id === sp.team)?.id ?? teams.data![0].id;
  return (
    <div className="animate-fade-up max-w-2xl">
      <PageHeader title="New event" />
      <Card><CardBody>
        <EventForm returnTo={`/coach/team?team=${teamId}`} lockTeam={teams.data!.length === 1}
          initial={{ teamId, date: dayKey(new Date()) }}
          teams={teams.data!.map((t) => ({ id: t.id, name: t.name }))}
          venues={venues.data!.filter((v) => v.isActive).map((v) => ({ id: v.id, name: v.name, spaces: v.spaces }))} />
      </CardBody></Card>
    </div>
  );
}
