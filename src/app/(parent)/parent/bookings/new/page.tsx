import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageHeader, ErrorState } from "@/components/ui";
import { getWizardData } from "@/lib/data/booking";
import { BookingWizard } from "@/components/booking/booking-wizard";

export default async function NewBookingPage() {
  const { data, error } = await getWizardData();
  if (error) return (<div className="animate-fade-up"><PageHeader title="Book a session" /><ErrorState title="Couldn't load" message={error} /></div>);
  return (
    <div className="animate-fade-up">
      <Link href="/parent/bookings" className="mb-2 inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> Bookings</Link>
      <PageHeader title="Book a session" description="Choose a child, service and time." />
      <BookingWizard data={data!} />
    </div>
  );
}
