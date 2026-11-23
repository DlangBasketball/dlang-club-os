"use client";

import { CalendarX2 } from "lucide-react";
import type { SheetMark } from "@/lib/attendance/types";
import { useFormat, useT } from "@/lib/i18n/client";

/** Inline reported absence on a player row: category, reason, who and when. */
export function ReportedAbsenceNote({ report }: { report: NonNullable<SheetMark["reported_absence"]> }) {
  const t = useT();
  const f = useFormat();
  const when = f.dateTime(report.created_at, "short");
  return (
    <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info-soft px-2.5 py-2 text-sm text-text">
      <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">
          {t("coachTrainings.absence.reported")}
          {" · "}
          {t(`teamAttendance.absenceCategories.${report.reason_category}`)}
        </p>
        {report.reason && <p className="break-words text-text-secondary">{report.reason}</p>}
        <p className="text-xs text-text-muted">
          {report.reporter_kind === "player"
            ? t("coachTrainings.absence.byPlayer", { when })
            : t("coachTrainings.absence.byGuardian", { when })}
          {report.status === "acknowledged" && <> · {t("coachTrainings.absence.acknowledged")}</>}
        </p>
        {report.needs_review && <p className="text-xs text-warning">{t("coachTrainings.absence.needsReview")}</p>}
      </div>
    </div>
  );
}
