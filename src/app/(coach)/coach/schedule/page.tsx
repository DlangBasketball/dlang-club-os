import { CalendarClock, MapPin, ChevronRight } from "lucide-react";
import Link from "next/link";
import { PageHeader, Card, CardBody, Badge } from "@/components/ui";

const SESSIONS = [
  { id: "1", program: "Big Ballers (U12)", time: "Today · 17:00", location: "Lancy Sports Centre", roster: 18, status: "open" },
  { id: "2", program: "Shooting Lab · Lucas", time: "Tomorrow · 16:00", location: "SPSA Arena", roster: 1, status: "booked" },
];

export default function CoachSchedulePage() {
  return (
    <div className="animate-fade-up">
      <PageHeader title="My schedule" description="Your upcoming sessions and bookings." />
      <div className="space-y-3">
        {SESSIONS.map((s) => (
          <Link key={s.id} href="/coach/attendance">
            <Card className="transition-all hover:border-maroon/50">
              <CardBody className="flex items-center gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-md bg-surface-elevated text-maroon">
                  <CalendarClock className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink">{s.program}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
                    <span>{s.time}</span><span>·</span>
                    <MapPin className="h-3 w-3" /><span className="truncate">{s.location}</span>
                  </div>
                </div>
                <Badge tone="neutral">{s.roster}</Badge>
                <ChevronRight className="h-4 w-4 text-ink-4" />
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
