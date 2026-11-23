/**
 * Wording of one attendance change (team_attendance_mark_history row) for the
 * admin session page and the coach sheet history: the entry leads with the
 * action ("Marked present", "Corrected to late", "Marked unexcused absence"),
 * the details give the previous status, the staff member and the time.
 *
 * Returns message keys under `attendanceHistory.*` (en/fr/de/es/it); pure,
 * client + server safe.
 */

export type HistoryPhase = "draft" | "reopened" | "correction";
export type HistoryVerb = "marked" | "changed" | "corrected" | "cleared";
const STATUSES = ["present", "late", "excused", "unexcused", "unmarked"] as const;
export type HistoryStatus = (typeof STATUSES)[number];

const asStatus = (s: string | null | undefined): HistoryStatus =>
  (STATUSES as readonly string[]).includes(s ?? "") ? (s as HistoryStatus) : "unmarked";

/**
 * - first mark on a draft (previous empty / not marked) -> "marked"
 * - a later change while taking attendance -> "changed"
 * - a correction of a final sheet, or a change after reopening -> "corrected"
 * - back to not marked -> "cleared"
 */
export function historyVerb(previous: string | null | undefined, next: string, phase: string): HistoryVerb {
  if (asStatus(next) === "unmarked") return "cleared";
  if (phase === "correction" || phase === "reopened") return "corrected";
  return !previous || asStatus(previous) === "unmarked" ? "marked" : "changed";
}

export type HistoryWording = {
  /** Message key of the headline, e.g. attendanceHistory.marked.present. */
  actionKey: string;
  /** Previous status key for "Previously: {status}" (attendanceHistory.status.*). */
  previousKey: string;
  verb: HistoryVerb;
};

export function historyWording(previous: string | null | undefined, next: string, phase: string): HistoryWording {
  const verb = historyVerb(previous, next, phase);
  return {
    verb,
    actionKey: verb === "cleared" ? "attendanceHistory.cleared" : `attendanceHistory.${verb}.${asStatus(next)}`,
    previousKey: `attendanceHistory.status.${asStatus(previous)}`,
  };
}
