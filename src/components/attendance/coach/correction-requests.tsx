"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/ui";
import { Label, Select, Textarea } from "@/components/ui/input";
import { resolveCorrectionRequest } from "@/lib/actions/team-attendance";
import { FINAL_STATUSES, type FinalStatus } from "@/lib/attendance/types";
import { useFormat, useT } from "@/lib/i18n/client";

export type CorrectionRequestRow = {
  request_id: string; status: string; event_id: string; starts_at: string; team_name: string; athlete_id: string;
  first_name: string; last_name: string; current_status: string; requested_status: string | null; mark_status: string | null;
  message: string; requested_by_name: string | null; created_at: string; resolved_at: string | null; resolved_by_name: string | null;
  resolution_note: string | null;
};

const TONE: Record<string, "warning" | "success" | "danger" | "neutral"> = { open: "warning", accepted: "success", rejected: "danger", withdrawn: "neutral" };
const isFinal = (s: string | null): s is FinalStatus => Boolean(s) && (FINAL_STATUSES as readonly string[]).includes(s as string);

/** Parent correction requests with accept / decline for staff who may resolve them. */
export function CorrectionRequestList({ rows, canResolve, showSession }: { rows: CorrectionRequestRow[]; canResolve: boolean; showSession?: boolean }) {
  const t = useT();
  const f = useFormat();
  if (!rows.length) return <p className="text-sm text-text-muted">{t("coachTrainings.requests.none")}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.request_id} className="rounded-lg border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto font-medium text-text">{r.first_name} {r.last_name}</p>
            <Badge tone={TONE[r.status] ?? "neutral"}>{t.dynamic(`coachTrainings.requests.statuses.${r.status}`, undefined, r.status)}</Badge>
          </div>
          {showSession && (
            <p className="text-xs text-text-muted">
              <Link href={`/coach/trainings/${r.event_id}`} className="text-brand-primary hover:underline">
                {r.team_name} · {f.dateTime(r.starts_at, "short")}
              </Link>
            </p>
          )}
          <p className="mt-1 text-xs text-text-muted">
            {t("coachTrainings.requests.from", { name: r.requested_by_name ?? t("coachTrainings.common.someone"), when: f.dateTime(r.created_at, "short") })}
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-text">{r.message}</p>
          <p className="mt-2 text-sm text-text-secondary">
            {t("coachTrainings.requests.recorded", { status: t.dynamic(`teamAttendance.statuses.${r.mark_status ?? r.current_status}`, undefined, r.current_status) })}
            {r.requested_status && <> · {t("coachTrainings.requests.requested", { status: t.dynamic(`teamAttendance.statuses.${r.requested_status}`, undefined, r.requested_status) })}</>}
          </p>
          {r.status !== "open" && r.resolved_at && (
            <p className="mt-1 text-xs text-text-muted">
              {t("coachTrainings.requests.resolved", { name: r.resolved_by_name ?? t("coachTrainings.common.someone"), when: f.dateTime(r.resolved_at, "short") })}
              {r.resolution_note && <> · {r.resolution_note}</>}
            </p>
          )}
          {canResolve && r.status === "open" && <ResolveForm row={r} />}
        </li>
      ))}
    </ul>
  );
}

function ResolveForm({ row }: { row: CorrectionRequestRow }) {
  const t = useT();
  const router = useRouter();
  const current = row.mark_status ?? row.current_status;
  const [newStatus, setNewStatus] = React.useState<FinalStatus>(
    isFinal(row.requested_status) ? row.requested_status : (FINAL_STATUSES.find((s) => s !== current) ?? "present"));
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<"accept" | "reject" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const id = row.request_id;

  async function resolve(accept: boolean) {
    if (!accept && !note.trim()) { setError(t("teamAttendance.errors.NOTE_REQUIRED")); return; }
    setBusy(accept ? "accept" : "reject");
    setError(null);
    const r = await resolveCorrectionRequest({ requestId: id, accept, newStatus: accept ? newStatus : null, note: note.trim() || null }).catch(() => null);
    setBusy(null);
    if (!r) { setError(t("coachTrainings.requests.networkFailed")); return; }
    if (!r.ok) { setError(r.error); return; }
    setDone(accept ? t("coachTrainings.requests.acceptedDone") : t("coachTrainings.requests.rejectedDone"));
    router.refresh();
  }

  if (done) return <p role="status" className="mt-3 text-sm text-success">{done}</p>;
  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`rs-${id}`}>{t("coachTrainings.requests.correctTo")}</Label>
          <Select id={`rs-${id}`} value={newStatus} onChange={(e) => setNewStatus(e.target.value as FinalStatus)}>
            {FINAL_STATUSES.map((s) => <option key={s} value={s}>{t(`teamAttendance.statuses.${s}`)}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`rn-${id}`}>{t("coachTrainings.requests.note")}</Label>
          <Textarea id={`rn-${id}`} className="min-h-[44px]" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
                    aria-describedby={`rn-${id}-hint`} />
          <p id={`rn-${id}-hint`} className="mt-1 text-xs text-text-muted">{t("coachTrainings.requests.noteHint")}</p>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="lg" onClick={() => resolve(true)} loading={busy === "accept"} disabled={busy !== null}>
          {t("coachTrainings.requests.accept")}
        </Button>
        <Button type="button" size="lg" variant="secondary" onClick={() => resolve(false)} loading={busy === "reject"} disabled={busy !== null}>
          {t("coachTrainings.requests.reject")}
        </Button>
      </div>
    </div>
  );
}
