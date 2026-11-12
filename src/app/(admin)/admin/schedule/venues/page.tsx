import { MapPin } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, EmptyState, ErrorState } from "@/components/ui";
import { VenueEditButton, VenueForm, VenueRowActions } from "@/components/schedule/venue-form";
import { listVenues } from "@/lib/sportsops/data";

export const metadata = { title: "Venues" };

export default async function VenuesPage() {
  const venues = await listVenues();
  if (venues.error !== null) return <div className="animate-fade-up"><PageHeader title="Venues" /><ErrorState message={venues.error} /></div>;
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title="Venues & facilities" description="Gyms, arenas and fields. Split a venue into courts/fields so two teams can share it without clashing." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {venues.data.length === 0 && <EmptyState icon={<MapPin className="h-5 w-5" />} title="No venues yet" description="Add the places your teams train and play." />}
          {venues.data.map((v) => (
            <Card key={v.id}>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{v.name} {!v.isActive && <Badge className="ml-1">inactive</Badge>}</h3>
                    <p className="text-xs text-ink-3">{[v.address, v.city].filter(Boolean).join(", ") || "No address"}{v.capacity ? ` · capacity ${v.capacity}` : ""}</p>
                  </div>
                  <VenueRowActions venueId={v.id} isActive={v.isActive} />
                </div>
                <VenueEditButton venue={v} />
                <div className="flex flex-wrap gap-1.5">
                  {v.spaces.length === 0 ? <span className="text-xs text-ink-4">Booked as a whole venue</span> : v.spaces.map((s) => <Badge key={s.id} tone="neutral">{s.name}</Badge>)}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
        <Card className="h-fit">
          <CardHeader><CardTitle>Add venue</CardTitle></CardHeader>
          <CardBody><VenueForm /></CardBody>
        </Card>
      </div>
    </div>
  );
}
