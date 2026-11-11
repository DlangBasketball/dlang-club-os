import Link from "next/link";
import { PageHeader, Card, CardBody, ErrorState } from "@/components/ui";
import { listCoaches, listAvailability } from "@/lib/data/training-admin";
import { AvailabilityManager } from "@/components/admin/availability-manager";

export default async function AdminAvailabilityPage({ searchParams }: { searchParams: Promise<{ coach?: string }> }) {
  const { coach } = await searchParams;
  const { data: coaches, error } = await listCoaches();
  if (error) return (<div className="animate-fade-up"><PageHeader title="Availability" /><ErrorState title="Couldn't load" message={error} /></div>);
  const selected = coach ?? coaches?.[0]?.id ?? "";
  const { data: slots } = await listAvailability(selected);

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title="Coach availability" description="Manage bookable slots for each coach." />
      <div className="flex flex-wrap gap-2">
        {(coaches ?? []).map((c) => (
          <Link key={c.id} href={`/admin/availability?coach=${c.id}`}
            className={`rounded-full border px-3 py-1.5 text-sm ${c.id === selected ? "border-maroon bg-maroon/10 text-ink" : "border-line text-ink-3 hover:text-ink"}`}>{c.name}</Link>
        ))}
      </div>
      {selected && (
        <Card><CardBody><AvailabilityManager coachId={selected} slots={slots ?? []} /></CardBody></Card>
      )}
    </div>
  );
}
