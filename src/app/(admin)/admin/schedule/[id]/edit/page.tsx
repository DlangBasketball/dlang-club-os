import { notFound } from "next/navigation";
import { PageHeader, Card, CardBody, ErrorState } from "@/components/ui";
import { EventForm } from "@/components/schedule/event-form";
import { getEvent, listTeams, listVenues } from "@/lib/sportsops/data";
import { localParts } from "@/lib/sportsops/time";

export const metadata = { title: "Edit event" };

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ev, teams, venues] = await Promise.all([getEvent(id), listTeams({ includeInactive: true }), listVenues()]);
  const error = ev.error ?? teams.error ?? venues.error;
  if (error) return <div className="animate-fade-up"><PageHeader title="Edit event" /><ErrorState message={error} /></div>;
  const e = ev.data;
  if (!e) notFound();
  const s = localParts(e.startsAt);
  const en = localParts(e.endsAt);
  return (
    <div className="animate-fade-up max-w-2xl">
      <PageHeader title="Edit event" />
      <Card><CardBody>
        <EventForm eventId={e.id} returnTo={`/admin/schedule/${e.id}`}
          initial={{
            teamId: e.teamId ?? "", type: e.type, title: e.title ?? "", venueId: e.venueId ?? "", spaceId: e.spaceId ?? "",
            locationText: e.locationText ?? "", date: s.date, start: s.time, end: en.time, opponent: e.opponent ?? "",
            homeAway: e.homeAway ?? "", notes: e.notes ?? "", status: e.status,
          }}
          teams={teams.data!.map((t) => ({ id: t.id, name: t.name }))}
          venues={venues.data!.map((v) => ({ id: v.id, name: v.name, spaces: v.spaces }))} />
      </CardBody></Card>
    </div>
  );
}
