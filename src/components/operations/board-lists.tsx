import { Badge } from "@/components/ui";
import { OpsButton } from "@/components/operations/ops-form";
import { getI18n } from "@/lib/i18n/server";
import { zonedDayKey } from "@/lib/staff/hours";
import type { CommitteeMemberRow, DecisionRow } from "@/lib/operations/db";
import { setDecisionStatus } from "@/lib/actions/operations-board";

const NEXT: Record<DecisionRow["status"], DecisionRow["status"][]> = {
  open: ["in_progress", "done", "cancelled"],
  in_progress: ["done", "cancelled"],
  done: ["open"],
  cancelled: ["open"],
};

/** Decisions log as a task list: owner, due date, status changes. */
export async function DecisionList({ decisions, members }: { decisions: DecisionRow[]; members: Pick<CommitteeMemberRow, "id" | "display_name">[] }) {
  const { t, f } = await getI18n();
  const today = zonedDayKey(new Date(), f.timeZone);
  const owner = new Map(members.map((m) => [m.id, m.display_name]));
  if (!decisions.length) return <p className="text-sm text-text-muted">{t("operations.board.noDecisions")}</p>;
  return (
    <ul className="space-y-2 text-sm">
      {decisions.map((d) => {
        const late = d.due_on && d.due_on < today && (d.status === "open" || d.status === "in_progress");
        return (
          <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-2 last:border-0">
            <div>
              <span className={d.status === "done" || d.status === "cancelled" ? "text-text-muted line-through" : "font-medium"}>{d.title}</span>
              <div className="text-xs text-text-muted">
                {[d.owner_member_id ? owner.get(d.owner_member_id) : null, d.due_on ? t("operations.board.dueOn", { date: f.date(d.due_on) }) : null,
                  t("operations.board.decidedOn", { date: f.date(d.decided_on) })].filter(Boolean).join(" · ")}
              </div>
              {d.description && <p className="mt-1 whitespace-pre-line text-text-secondary">{d.description}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Badge tone={late ? "danger" : d.status === "done" ? "success" : d.status === "in_progress" ? "info" : "neutral"}>{t.dynamic(`operations.board.decisionStatuses.${d.status}`)}</Badge>
              {NEXT[d.status].map((s) => (
                <OpsButton key={s} action={setDecisionStatus.bind(null, d.id, s)} label={t.dynamic(`operations.board.decisionMoves.${s}`)} variant="ghost" />
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
