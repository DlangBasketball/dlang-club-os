import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui";
import { coachesByRole, type CoverageSummary } from "@/lib/attendance/coverage";
import type { Translator } from "@/lib/i18n/translator";

/*
 * Coach coverage display shared by the admin session page, the Attendance
 * tab, the Dashboard, the Schedule and the coach Today list. The data comes
 * from the SQL ac_coverage (or its TS mirror), so every screen says the same.
 */

const TONE = { assigned: "success", substitute: "info", missing: "danger" } as const;

export function CoverageBadge({ t, coverage }: { t: Translator; coverage: CoverageSummary }) {
  return <Badge tone={TONE[coverage.coverage]}>{t(`adminAttendance.coverage.${coverage.coverage}`)}</Badge>;
}

/** "Led by X" (with "(default)" when not chosen on the sheet), or "No lead coach". */
export function ledByLabel(t: Translator, coverage: CoverageSummary): string {
  if (!coverage.ledByName) return t("attendanceCoverage.noLead");
  return coverage.ledBySource === "sheet" || coverage.ledBySource === "program"
    ? t("attendanceCoverage.ledBy", { name: coverage.ledByName })
    : t("attendanceCoverage.ledByAuto", { name: coverage.ledByName });
}

/** One line: "Led by X · Assistant: Y · Substitute: Z". */
export function coverageLine(t: Translator, coverage: CoverageSummary): string {
  if (coverage.coverage === "missing") return t("adminAttendance.coverage.missing");
  const parts = [ledByLabel(t, coverage)];
  for (const g of coachesByRole(coverage.coaches)) {
    const names = g.role === "lead" ? g.names.filter((n) => n !== coverage.ledByName) : g.names;
    if (names.length) parts.push(t(`attendanceCoverage.roleList.${g.role}`, { names: names.join(", ") }));
  }
  return parts.join(" · ");
}

/** Effective coaches with their role for this session (lead / assistant / substitute). */
export function CoachRoleList({ t, coverage }: { t: Translator; coverage: CoverageSummary }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-text">{ledByLabel(t, coverage)}</p>
      {coverage.coaches.length === 0 ? (
        <p className="text-warning">{t("adminAttendance.coverage.missing")}</p>
      ) : (
        <ul className="space-y-1">
          {coverage.coaches.map((c) => (
            <li key={c.coachId} className="flex justify-between gap-2">
              <span className="text-text">{c.name}</span>
              <span className="text-xs text-text-muted">
                {t(`attendanceCoverage.role.${c.role}`)} · {t(`attendanceCoverage.source.${c.source}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {coverage.multipleLeads && (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {t("attendanceCoverage.multipleLeads")}
        </p>
      )}
    </div>
  );
}
