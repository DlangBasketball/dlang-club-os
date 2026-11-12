import { ErrorState } from "@/components/ui";
import { getRosterForProgramSession } from "@/lib/data/coach-sessions";
import { AttendanceRoster } from "@/components/attendance/attendance-roster";
import { photoUrlsForAthletes } from "@/lib/people/server";

export default async function RosterPage({ params }: { params: Promise<{ programSessionId: string }> }) {
  const { programSessionId } = await params;
  const { data, error } = await getRosterForProgramSession(programSessionId);
  if (error) return <ErrorState title="Couldn't open session" message={error} />;
  const d = data!;
  // Identification photos: Storage RLS lets a coach read only athletes he can access.
  const photos = await photoUrlsForAthletes(d.roster.map((r) => r.athleteId));
  return (
    <div className="animate-fade-up">
      <AttendanceRoster
        attendanceSessionId={d.attendanceSessionId}
        programName={d.programName}
        initialRoster={d.roster}
        locked={d.status === "locked"}
        photos={photos}
      />
    </div>
  );
}
