import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui";
import { CalendarX2 } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { countsInTotals, sheetState, type SessionAttendanceRow, type SheetState, type Totals } from "@/lib/attendance/admin-stats";

/*
 * Server-rendered admin attendance views shared by the team page, the player
 * profile and the follow-up screens. Totals never include cancelled sessions
 * or sheets that were never finalized (src/lib/attendance/admin-stats.ts).
 */

const STATE_TONE: Record<SheetState, "success" | "warning" | "neutral" | "danger" | "info"> = {
  final: "success", reopened: "warning", draft: "info", missing: "danger", upcoming: "neutral", cancelled: "neutral",
};

export async function SheetStateBadge({ state }: { state: SheetState }) {
  const { t } = await getI18n();
  return <Badge tone={STATE_TONE[state]}>{t.dynamic(`adminAttendance.sheetState.${state}`, undefined, state)}</Badge>;
}

export async function TotalsSummary({ totals, caption }: { totals: Totals; caption?: string }) {
  const { t, f } = await getI18n();
  const cells = [
    { k: "sessions", label: t("adminAttendance.totals.sessions"), v: f.number(totals.sessions), tone: "text-text" },
    { k: "present", label: t("adminAttendance.mark.present"), v: f.number(totals.present), tone: "text-success" },
    { k: "late", label: t("adminAttendance.mark.late"), v: f.number(totals.late), tone: "text-warning" },
    { k: "excused", label: t("adminAttendance.mark.excused"), v: f.number(totals.excused), tone: "text-info" },
    { k: "unexcused", label: t("adminAttendance.mark.unexcused"), v: f.number(totals.unexcused), tone: "text-danger" },
    { k: "rate", label: t("adminAttendance.totals.rate"), v: totals.rate === null ? "—" : f.percent(totals.rate, 0), tone: "text-text" },
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {cells.map((c) => (
          <div key={c.k} className="rounded-md bg-surface-elevated px-3 py-3 text-center">
            <div className={`tnum text-xl font-semibold ${c.tone}`}>{c.v}</div>
            <div className="mt-0.5 text-xs text-text-muted">{c.label}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-text-muted">{caption ?? t("adminAttendance.totals.rule")}</p>
    </div>
  );
}

/**
 * Session history: one line per session (newest first) with its sheet state
 * and counts. `mode="player"` shows the player's own status instead of the
 * team counts.
 */
export async function SessionHistoryList({ rows, mode, showTeam = false }: { rows: SessionAttendanceRow[]; mode: "team" | "player"; showTeam?: boolean }) {
  const { t, f } = await getI18n();
  if (!rows.length) {
    return <EmptyState icon={<CalendarX2 className="h-5 w-5" />} title={t("adminAttendance.history.emptyTitle")} description={t("adminAttendance.history.emptyHint")} />;
  }
  const now = Date.now();
  const mark = (s: string) => t.dynamic(`adminAttendance.mark.${s}`, undefined, s);
  return (
    <ul className="divide-y divide-border-soft rounded-md border border-border-soft">
      {rows.map((r) => {
        const state = sheetState(r, now);
        const counted = countsInTotals(r);
        const status = r.athlete_status;
        return (
          <li key={r.event_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Link href={`/admin/schedule/${r.event_id}/attendance`} className="text-sm font-medium text-text hover:text-brand-primary">
                {f.date(r.starts_at, { weekday: true })} · {f.time(r.starts_at)}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                <span>{t.dynamic(`adminAttendance.eventType.${r.event_type}`, undefined, r.event_type)}</span>
                {showTeam && r.team_name && <span>· {r.team_name}</span>}
                {r.title && <span className="truncate">· {r.title}</span>}
                {r.event_status === "cancelled" && r.cancel_reason && <span>· {t("adminAttendance.history.cancelReason", { reason: r.cancel_reason })}</span>}
                {!counted && state !== "cancelled" && state !== "upcoming" && <span className="italic">· {t("adminAttendance.history.notCounted")}</span>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <SheetStateBadge state={state} />
              {mode === "team" && r.total > 0 && (
                <span className="tnum text-xs text-text-muted">
                  {t("adminAttendance.history.counts", { present: r.present, late: r.late, excused: r.excused, unexcused: r.unexcused })}
                  {r.unmarked > 0 && <> · {t("adminAttendance.history.unmarked", { count: r.unmarked })}</>}
                </span>
              )}
              {mode === "player" && status && (
                <Badge tone={status === "present" ? "success" : status === "late" ? "warning" : status === "excused" ? "info" : status === "unexcused" ? "danger" : "neutral"}>
                  {mark(status)}{r.athlete_is_guest ? ` · ${t("adminAttendance.sheet.guest")}` : ""}
                </Badge>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
