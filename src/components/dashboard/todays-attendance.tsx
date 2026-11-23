import Link from "next/link";
import { CheckSquare } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, ErrorState, SkeletonCard } from "@/components/ui";
import { getSessionsOverview, overviewTotals } from "@/lib/attendance/overview";
import { getI18n } from "@/lib/i18n/server";
import { zonedDayKey } from "@/lib/staff/hours";

/**
 * Today's attendance totals (club time zone). Same read as the Attendance
 * tab (attendance_sessions_overview, today, all teams), so both show the same
 * numbers. Staff without attendance access (finance) see nothing.
 */
export async function TodaysAttendance() {
  const { t, f } = await getI18n();
  const today = zonedDayKey(new Date(), f.timeZone);
  const res = await getSessionsOverview({ from: today, to: today, limit: 300 });
  if (res.error === "NOT_AUTHORIZED") return null;
  if (res.error !== null) return <ErrorState title={t("dashboard.widgets.attendance.loadError")} message={t("teamAttendance.errors.generic")} />;
  const a = overviewTotals(res.data);
  const cells = [
    { key: "total", label: t("dashboard.widgets.attendance.sessions"), value: a.sessions, tone: "text-ink" },
    { key: "final", label: t("attendanceOverview.workflow.final"), value: a.final, tone: "text-success" },
    { key: "open", label: t("dashboard.widgets.attendance.pending"), value: a.open, tone: "text-warning" },
    { key: "present", label: t("adminAttendance.mark.present"), value: a.present, tone: "text-success" },
    { key: "late", label: t("adminAttendance.mark.late"), value: a.late, tone: "text-warning" },
    { key: "excused", label: t("adminAttendance.mark.excused"), value: a.excused, tone: "text-info" },
    { key: "unexcused", label: t("adminAttendance.mark.unexcused"), value: a.unexcused, tone: "text-danger" },
    { key: "unmarked", label: t("adminAttendance.mark.unmarked"), value: a.unmarked, tone: "text-ink-3" },
    { key: "followups", label: t("attendanceOverview.followups.short"), value: a.openFollowups, tone: "text-danger" },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dashboard.widgets.attendance.title")}</CardTitle>
        <Link href="/admin/attendance" className="text-xs text-maroon hover:underline">{t("dashboard.widgets.attendance.open")}</Link>
      </CardHeader>
      <CardBody>
        {a.sessions === 0 ? (
          <p className="flex items-center gap-2 py-2 text-sm text-ink-3">
            <CheckSquare className="h-4 w-4" /> {t("dashboard.widgets.attendance.none")}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {cells.map((c) => (
              <div key={c.key} className="rounded-md bg-surface-elevated px-3 py-3 text-center">
                <div className={`tnum text-xl font-semibold ${c.tone}`}>{f.number(c.value)}</div>
                <div className="mt-1 text-xs text-ink-3">{c.label}</div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export { SkeletonCard as TodaysAttendanceSkeleton };
