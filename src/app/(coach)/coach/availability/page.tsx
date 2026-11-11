import { CalendarClock } from "lucide-react";
import { PageHeader, Card, CardBody, EmptyState } from "@/components/ui";
import { getMyCoach, listAvailability } from "@/lib/data/training-admin";
import { AvailabilityManager } from "@/components/admin/availability-manager";

export default async function CoachAvailabilityPage() {
  const me = await getMyCoach();
  if (!me) return (<div className="animate-fade-up"><PageHeader title="My availability" /><EmptyState icon={<CalendarClock className="h-5 w-5" />} title="No coach profile" description="Your account isn't linked to a coach profile yet." /></div>);
  const { data: slots } = await listAvailability(me.id);
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title="My availability" description="Add the slots when you're free for private sessions." />
      <Card><CardBody><AvailabilityManager coachId={me.id} slots={slots ?? []} /></CardBody></Card>
    </div>
  );
}
