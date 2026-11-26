import { historyWording } from "@/lib/attendance/history-wording";
import type { Formatter } from "@/lib/format";
import type { Translator } from "@/lib/i18n/translator";

/**
 * One attendance change, leading with the action: "Marked present",
 * "Corrected to late", "Marked unexcused absence"; then "Previously: Not
 * marked", the staff member and the date / time (club time zone through the
 * formatter). History rows are append-only; this only renders them.
 */
export function HistoryEntry({ t, f, name, previous, next, phase, by, at, reason }: {
  t: Translator; f: Formatter; name: string; previous: string | null; next: string; phase: string;
  by: string; at: string; reason?: string | null;
}) {
  const w = historyWording(previous, next, phase);
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <p className="text-text">
        <span className="font-medium">{t.dynamic(w.actionKey, undefined, next)}</span>
        <span className="text-text-muted"> · {name}</span>
      </p>
      <p className="text-xs text-text-muted">
        {t("attendanceHistory.previously", { status: t.dynamic(w.previousKey, undefined, previous ?? "") })}
        {" · "}{t("attendanceHistory.byAt", { name: by, when: f.dateTime(at) })}
      </p>
      {reason && <p className="break-words text-xs text-text-secondary">{t("attendanceHistory.reason", { reason })}</p>}
    </div>
  );
}
