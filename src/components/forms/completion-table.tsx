import Link from "next/link";
import { Badge } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import type { AssignmentCompletion } from "@/lib/forms/data";
import type { CompletionStatus } from "@/lib/forms/logic";

const TONE: Record<CompletionStatus, "success" | "warning" | "danger" | "neutral"> = {
  complete: "success", expiring: "warning", expired: "danger", missing: "neutral", overdue: "danger",
};

export function StatusBadge({ status, label }: { status: CompletionStatus; label: string }) {
  return <Badge tone={TONE[status]}>{label}</Badge>;
}

/** Completion per assignment with the athletes still missing / expired. */
export async function CompletionTable({ rows, showForm = false }: { rows: AssignmentCompletion[]; showForm?: boolean }) {
  const { t, f } = await getI18n();
  return (
    <div className="space-y-4">
      {rows.map((r) => {
        const open = r.athletes.filter((a) => a.status !== "complete");
        return (
          <details key={r.assignment.id} className="rounded border border-line">
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="text-ink">
                {showForm && <Link href={`/admin/forms/${r.formId}`} className="font-medium hover:text-maroon">{r.formTitle} · </Link>}
                {r.assignment.scope === "all_members" ? t("forms.scopes.all_members") : `${t.dynamic(`forms.scopes.${r.assignment.scope}`)} · ${r.assignment.targetName ?? "–"}`}
              </span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-ink-3">{t("forms.completion.counts", { done: r.summary.complete + r.summary.expiring, total: r.summary.total })}</span>
                <span className="h-2 w-24 overflow-hidden rounded bg-surface-elevated" aria-hidden>
                  <span className="block h-full bg-success" style={{ width: `${r.summary.pct}%` }} />
                </span>
                <span className="tnum w-10 text-right text-sm font-semibold text-ink">{r.summary.pct}%</span>
              </span>
            </summary>
            {open.length === 0 ? <p className="px-3 pb-3 text-xs text-ink-3">{t("forms.completion.allDone")}</p> : (
              <ul className="divide-y divide-line-soft border-t border-line text-sm">
                {open.map((a) => (
                  <li key={a.athleteId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <Link href={`/admin/athletes/${a.athleteId}`} className="text-ink hover:text-maroon">{a.name}</Link>
                    <span className="flex items-center gap-2 text-xs text-ink-3">
                      {a.validUntil && t("forms.completion.validUntil", { date: f.date(a.validUntil) })}
                      {a.submissionId && <Link href={`/admin/forms/submissions/${a.submissionId}`} className="text-maroon hover:underline">{t("forms.completion.view")}</Link>}
                      <StatusBadge status={a.status} label={t.dynamic(`forms.completionStatus.${a.status}`)} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        );
      })}
    </div>
  );
}
