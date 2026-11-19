import Link from "next/link";
import { NotebookPen } from "lucide-react";
import { ErrorState } from "@/components/ui";
import { getTranslations } from "@/lib/i18n/server";
import { getRosterForProgramSession } from "@/lib/data/coach-sessions";
import { AttendanceRoster } from "@/components/attendance/attendance-roster";
import { photoUrlsForAthletes } from "@/lib/people/server";

export default async function RosterPage({ params }: { params: Promise<{ programSessionId: string }> }) {
  const { programSessionId } = await params;
  const { data, error } = await getRosterForProgramSession(programSessionId);
  if (error) return <ErrorState title="Couldn't open session" message={error} />;
  const d = data!;
  // Identification photos: Storage RLS lets a coach read only athletes he can access.
  const [photos, t] = await Promise.all([photoUrlsForAthletes(d.roster.map((r) => r.athleteId)), getTranslations()]);
  return (
    <div className="animate-fade-up">
      <div className="mb-3 flex justify-end">
        <Link href={`/coach/lesson-plans/session/${programSessionId}`} className="inline-flex items-center gap-1.5 text-sm text-brand-primary hover:underline">
          <NotebookPen className="h-4 w-4" /> {t("staff.dashboard.lessonPlan")}
        </Link>
      </div>
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
