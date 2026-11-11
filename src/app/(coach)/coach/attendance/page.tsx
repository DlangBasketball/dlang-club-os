import Link from "next/link";
import { CalendarClock, MapPin, ChevronRight } from "lucide-react";
import { PageHeader, Card, CardBody, Badge, statusTone, EmptyState, ErrorState } from "@/components/ui";
import { listCoachSessions } from "@/lib/data/coach-sessions";
import { formatDate, formatTime } from "@/lib/utils";

const LABEL: Record<string, string> = { not_started: "Take attendance", open: "In progress", submitted: "Submitted", locked: "Locked" };

export default async function CoachSessionListPage() {
  const { data, error } = await listCoachSessions();
  if (error) return (<div className="animate-fade-up"><PageHeader title="Attendance" /><ErrorState title="Couldn't load sessions" message={error} /></div>);
  const sessions = data!;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const groups = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const key = formatDate(s.startsAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="Attendance" description="Pick a session to take the register." />
      {sessions.length === 0 ? (
        <EmptyState icon={<CalendarClock className="h-5 w-5" />} title="No sessions assigned" />
      ) : (
        <div className="space-y-6">
          {Array.from(groups.entries()).map(([day, rows]) => (
            <section key={day}>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">{day}</h2>
              <div className="space-y-2">
                {rows.map((s) => (
                  <Link key={s.programSessionId} href={`/coach/attendance/${s.programSessionId}`} className="block">
                    <Card className="transition active:scale-[0.99] hover:border-maroon/40">
                      <CardBody className="flex items-center justify-between py-3.5">
                        <div className="min-w-0">
                          <div className="font-medium text-ink">{s.programName}</div>
                          <div className="mt-0.5 flex items-center gap-x-3 text-xs text-ink-3">
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
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
