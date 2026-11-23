"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Avatar, Badge, Button } from "@/components/ui";
import { FieldHint, Label, Textarea } from "@/components/ui/input";
import { correctAttendance } from "@/lib/actions/team-attendance";
import { type AttendanceSheet, type FinalStatus, type SheetMark } from "@/lib/attendance/types";
import { newRequestId } from "@/lib/billing/request-id";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { ModalDialog } from "./modal-dialog";
import { ReportedAbsenceNote } from "./reported-absence";
import { StatusPicker, STATUS_TONE } from "./status-picker";
import { draftStorageKey } from "./draft-storage";

/** A final sheet: read-only, with a per-player Correct action (reason required) for authorized staff. */
export function FinalAttendanceSheet({ eventId, sheet, userId }: { eventId: string; sheet: AttendanceSheet; userId: string }) {
  const t = useT();
  const [correcting, setCorrecting] = React.useState<SheetMark | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [leftover, setLeftover] = React.useState<string[]>([]);
  const key = draftStorageKey(userId, eventId);

  // Changes kept on this device that could not be saved before the sheet became final.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      const d = raw ? (JSON.parse(raw) as { pending?: Record<string, { status: string }> }) : null;
      const ids = Object.keys(d?.pending ?? {}).filter((id) => {
        const m = sheet.marks.find((x) => x.athlete_id === id);
        return m && m.finalized_status !== d?.pending?.[id]?.status;
      });
      setLeftover(ids);
      if (!ids.length && raw) window.localStorage.removeItem(key);
    } catch { /* storage unavailable */ }
  }, [key, sheet.marks]);

  const canCorrect = sheet.access.can_correct;
  return (
    <div>
      <p className="mb-3 text-sm text-text-secondary">
        {canCorrect ? t("coachTrainings.final.readOnly") : t("coachTrainings.final.readOnlyNoCorrect")}
      </p>
      <div aria-live="polite">
        {message && <p className="mb-3 rounded-md border border-success/30 bg-success-soft p-3 text-sm text-text">{message}</p>}
      </div>
      {leftover.length > 0 && (
        <div role="alert" className="mb-3 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-text">
          <p>{t("coachTrainings.final.leftover", { count: leftover.length })}</p>
          <ul className="my-2 list-inside list-disc">
            {leftover.map((id) => {
              const m = sheet.marks.find((x) => x.athlete_id === id)!;
              return <li key={id}>{m.first_name} {m.last_name}</li>;
            })}
          </ul>
          <Button type="button" size="sm" variant="secondary"
                  onClick={() => { try { window.localStorage.removeItem(key); } catch { /* ignore */ } setLeftover([]); }}>
            {t("coachTrainings.common.dismiss")}
          </Button>
        </div>
      )}
      <ul className="space-y-2">
        {sheet.marks.map((m) => {
          const st = (m.finalized_status ?? m.status) as FinalStatus | "unmarked";
          const name = `${m.first_name} ${m.last_name}`;
          return (
            <li key={m.athlete_id} className="rounded-lg border border-border bg-surface p-3">
              <div className="flex items-center gap-3">
                <Avatar name={name} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-text">
                    {m.jersey_number !== null && <span className="mr-1.5 font-mono text-text-muted">{t("coachTrainings.sheet.jersey", { number: m.jersey_number })}</span>}
                    {name}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-1.5">
                    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                                        st === "unmarked" ? "border-border text-text-muted" : STATUS_TONE[st])}>
                      {t(`teamAttendance.statuses.${st}`)}
                    </span>
                    {m.is_guest && <Badge tone="accent">{t("coachTrainings.sheet.guest")}</Badge>}
                  </p>
                </div>
                {canCorrect && (
                  <Button type="button" variant="outline" size="md" onClick={() => { setMessage(null); setCorrecting(m); }}
                          aria-label={t("coachTrainings.final.correctNamed", { name })}>
                    {t("coachTrainings.final.correct")}
                  </Button>
                )}
              </div>
              {m.reported_absence && <div className="mt-2"><ReportedAbsenceNote report={m.reported_absence} /></div>}
            </li>
          );
        })}
      </ul>
      <CorrectDialog eventId={eventId} mark={correcting} onClose={() => setCorrecting(null)}
                     onDone={() => { setCorrecting(null); setMessage(t("teamAttendance.messages.corrected")); }} />
    </div>
  );
}

function CorrectDialog({ eventId, mark, onClose, onDone }: { eventId: string; mark: SheetMark | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const router = useRouter();
  const [status, setStatusValue] = React.useState<FinalStatus | null>(null);
  const [reason, setReason] = React.useState("");
  const [ack, setAck] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const requestId = React.useRef<string>("");

  React.useEffect(() => {
    if (!mark) return;
    requestId.current = newRequestId(); // one id per correction intent, reused on retry
    setStatusValue(null); setReason(""); setAck(false); setError(null);
  }, [mark]);

  if (!mark) return <ModalDialog open={false} onClose={onClose} title=""><span /></ModalDialog>;
  const name = `${mark.first_name} ${mark.last_name}`;
  const current = (mark.finalized_status ?? mark.status) as FinalStatus;
  const needAck = status === "unexcused" && Boolean(mark.reported_absence);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!status || status === current) { setError(t("coachTrainings.final.chooseNew")); return; }
    if (reason.trim().length < 3) { setError(t("teamAttendance.errors.REASON_REQUIRED")); return; }
    if (needAck && !ack) { setError(t("coachTrainings.final.reportedAckRequired")); return; }
    setBusy(true);
    setError(null);
    const r = await correctAttendance({ eventId, athleteId: mark!.athlete_id, status, reason: reason.trim(), requestId: requestId.current, ackReported: needAck && ack })
      .catch(() => null);
    setBusy(false);
    if (!r) { setError(t("coachTrainings.final.networkFailed")); return; }
    if (!r.ok) { setError(r.error); return; }
    onDone();
    router.refresh();
  }

  return (
    <ModalDialog open onClose={onClose} title={t("coachTrainings.final.correctTitle", { name })}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-text-secondary">{t("coachTrainings.final.currentStatus", { status: t(`teamAttendance.statuses.${current}`) })}</p>
        <fieldset>
          <legend className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("coachTrainings.final.newStatus")}</legend>
          <StatusPicker value={status ?? current} onChange={(s) => setStatusValue(s)} label={t("coachTrainings.final.newStatus")} />
        </fieldset>
        <div>
          <Label htmlFor="correct-reason">{t("coachTrainings.final.reason")}</Label>
          <Textarea id="correct-reason" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
                    aria-describedby="correct-reason-hint" />
          <FieldHint id="correct-reason-hint">{t("coachTrainings.final.reasonHint")}</FieldHint>
        </div>
        {needAck && (
          <label className="flex items-start gap-3 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-text">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--danger)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>{t("coachTrainings.final.reportedAck", { name })}</span>
          </label>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" size="lg" onClick={onClose}>{t("coachTrainings.common.cancel")}</Button>
          <Button type="submit" size="lg" loading={busy} disabled={!status || status === current}>{t("coachTrainings.final.save")}</Button>
        </div>
      </form>
    </ModalDialog>
  );
}

