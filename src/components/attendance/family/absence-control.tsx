"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Label, Select, Textarea, FieldHint, Badge } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { reportAbsence, withdrawAbsence } from "@/lib/actions/team-attendance";
import { ABSENCE_CATEGORIES, type AbsenceCategory } from "@/lib/attendance/types";

export type ActiveReport = {
  report_id: string; status: string; reason: string | null; reason_category: string; needs_review: boolean;
};

/**
 * Report / change / withdraw an absence for one upcoming session (guardian or
 * player). The server re-checks access and the cut-off (session start); the
 * button disappears once reporting is closed.
 */
export function AbsenceControl({ eventId, athleteId, report, canReport }: {
  eventId: string;
  athleteId: string;
  report: ActiveReport | null;
  canReport: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const id = `absence-${eventId}-${athleteId}`;
  const category = (ABSENCE_CATEGORIES as readonly string[]).includes(report?.reason_category ?? "") ? (report!.reason_category as AbsenceCategory) : "other";

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setMsg(null);
    start(async () => {
      const res = await reportAbsence({
        eventId, athleteId, category: String(fd.get("category") ?? "other") as AbsenceCategory, reason: String(fd.get("reason") ?? ""),
      });
      setMsg(res.ok ? { ok: true, text: res.message ?? t("familyAttendance.absence.reported") } : { ok: false, text: res.error });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  };

  const withdraw = () => {
    if (!report) return;
    setMsg(null);
    start(async () => {
      const res = await withdrawAbsence(report.report_id);
      setMsg(res.ok ? { ok: true, text: res.message ?? t("teamAttendance.messages.absenceWithdrawn") } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="mt-2 space-y-2">
      {report && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <Badge tone={report.status === "acknowledged" ? "success" : "info"}>
            {report.status === "acknowledged" ? t("familyAttendance.absence.acknowledged") : t("familyAttendance.absence.reported")}
          </Badge>
          <span>{t.dynamic(`teamAttendance.absenceCategories.${report.reason_category}`, undefined, report.reason_category)}</span>
          {report.needs_review && <span className="text-warning">{t("familyAttendance.absence.needsReview")}</span>}
        </div>
      )}
      {canReport && !open && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={report ? "secondary" : "outline"} onClick={() => setOpen(true)} disabled={pending}>
            {report ? t("familyAttendance.absence.edit") : t("familyAttendance.absence.report")}
          </Button>
          {report && (
            <Button type="button" size="sm" variant="ghost" onClick={withdraw} disabled={pending} aria-busy={pending}>
              {t("familyAttendance.absence.withdraw")}
            </Button>
          )}
        </div>
      )}
      {canReport && open && (
        <form onSubmit={submit} className="space-y-3 rounded-md border border-border bg-surface-elevated p-3">
          <div>
            <Label htmlFor={`${id}-cat`}>{t("familyAttendance.absence.category")}</Label>
            <Select id={`${id}-cat`} name="category" defaultValue={category}>
              {ABSENCE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(`teamAttendance.absenceCategories.${c}`)}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`${id}-reason`}>{t("familyAttendance.absence.reason")}</Label>
            <Textarea id={`${id}-reason`} name="reason" maxLength={500} defaultValue={report?.reason ?? ""} aria-describedby={`${id}-hint`} />
            <FieldHint id={`${id}-hint`}>{t("familyAttendance.absence.reasonHint")}</FieldHint>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>{pending ? t("common.saving") : t("familyAttendance.absence.submit")}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>{t("familyAttendance.absence.cancel")}</Button>
          </div>
        </form>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-xs text-success" : "text-xs text-danger"}>{msg.text}</p>}
    </div>
  );
}
