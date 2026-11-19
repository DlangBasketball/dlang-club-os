import { PageHeader, Card, CardBody, ErrorState } from "@/components/ui";
import { EventForm } from "@/components/schedule/event-form";
import { listTeams, listVenues } from "@/lib/sportsops/data";
import { dayKey, isDayKey } from "@/lib/sportsops/time";

export const metadata = { title: "New event" };

export default async function NewEventPage({ searchParams }: { searchParams: Promise<{ team?: string; date?: string }> }) {
  const sp = await searchParams;
  const [teams, venues] = await Promise.all([listTeams(), listVenues()]);
  const error = teams.error ?? venues.error;
  if (error) return <div className="animate-fade-up"><PageHeader title="New event" /><ErrorState message={error} /></div>;
  const teamId = teams.data!.some((t) => t.id === sp.team) ? sp.team! : "";
  return (
    <div className="animate-fade-up max-w-2xl">
      <PageHeader title="New event" description="Overlapping bookings at the same venue are flagged before you save." />
      <Card><CardBody>
        <EventForm returnTo="/admin/schedule" canCreateVenue
          initial={{ teamId, date: isDayKey(sp.date) ? sp.date : dayKey(new Date()) }}
          teams={teams.data!.map((t) => ({ id: t.id, name: t.name }))}
          venues={venues.data!.filter((v) => v.isActive).map((v) => ({ id: v.id, name: v.name, spaces: v.spaces }))} />
      </CardBody></Card>
    </div>
  );
}
