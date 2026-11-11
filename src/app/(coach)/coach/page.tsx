import Link from "next/link";
import { CalendarClock, MapPin, ChevronRight, CheckSquare } from "lucide-react";
import { PageHeader, Card, CardBody, Badge, statusTone, EmptyState, ErrorState } from "@/components/ui";
import { listCoachSessions } from "@/lib/data/coach-sessions";
import { getSessionUser } from "@/lib/auth/get-user";
import { formatTime } from "@/lib/utils";

const LABEL: Record<string, string> = { not_started: "Take attendance", open: "In progress", submitted: "Submitted", locked: "Locked" };

export default async function CoachHomePage() {
  const me = await getSessionUser();
  const { data, error } = await listCoachSessions({ todayOnly: true });
  if (error) return (<div className="animate-fade-up"><PageHeader title="Today" /><ErrorState title="Couldn't load sessions" message={error} /></div>);
  const sessions = data!;

  return (
    <div className="animate-fade-up">
      <PageHeader title={`Hi${me?.fullName ? `, ${me.fullName.split(" ")[0]}` : ""}`} description="Your sessions for today." />
      {sessions.length === 0 ? (
        <EmptyState icon={<CalendarClock className="h-5 w-5" />} title="No sessions today" description="Enjoy the day off — check Attendance for upcoming sessions." />
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <Link key={s.programSessionId} href={`/coach/attendance/${s.programSessionId}`} className="block">
              <Card className="transition active:scale-[0.99] hover:border-maroon/40">
                <CardBody className="flex items-center justify-between py-4">
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{s.programName}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                      <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{formatTime(s.startsAt)}</span>
                      {s.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{s.location}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={statusTone(s.attendanceStatus === "not_started" ? "open" : s.attendanceStatus)}>{LABEL[s.attendanceStatus]}</Badge>
                    <ChevronRight className="h-5 w-5 text-ink-4" />
                  </div>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <div className="mt-6">
        <Link href="/coach/attendance" className="flex items-center gap-2 text-sm text-maroon hover:underline"><CheckSquare className="h-4 w-4" /> All sessions & attendance</Link>
      </div>
    </div>
  );
}
