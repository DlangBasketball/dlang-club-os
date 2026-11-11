import { ErrorState } from "@/components/ui";
import { getRosterForProgramSession } from "@/lib/data/coach-sessions";
import { AttendanceRoster } from "@/components/attendance/attendance-roster";

export default async function RosterPage({ params }: { params: Promise<{ programSessionId: string }> }) {
  const { programSessionId } = await params;
  const { data, error } = await getRosterForProgramSession(programSessionId);
  if (error) return <ErrorState title="Couldn't open session" message={error} />;
  const d = data!;
  return (
    <div className="animate-fade-up">
      <AttendanceRoster
        attendanceSessionId={d.attendanceSessionId}
        programName={d.programName}
        initialRoster={d.roster}
        locked={d.status === "locked"}
      />
    </div>
  );
}
