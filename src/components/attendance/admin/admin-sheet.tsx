"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCheck, Lock, RotateCcw } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, FieldHint, Input, Label, Select } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import {
  correctAttendance, finalizeAttendance, markAllPresent, openAttendance, reopenAttendance, saveAttendance,
} from "@/lib/actions/team-attendance";
import { newRequestId } from "@/lib/billing/request-id";
import { FINAL_STATUSES, type AttendanceSheet, type FinalStatus, type MarkStatus } from "@/lib/attendance/types";
import { cn } from "@/lib/utils";

/**
 * Admin attendance sheet (take / correct attendance on the session page).
 * A simple admin version of the coach sheet, on the same server actions:
 * draft saves merge per mark (conflicts are shown, never overwritten), the
 * finalize refusals (unmarked players, reported absences, version) are
 * explained, and final sheets take per-player corrections with a reason.
 */

const TONE: Record<MarkStatus, string> = {
  unmarked: "border-border text-text-muted",
  present: "border-success/40 bg-success-soft text-success",
  late: "border-warning/40 bg-warning-soft text-warning",
  excused: "border-info/40 bg-info-soft text-info",
  unexcused: "border-danger/40 bg-danger-soft text-danger",
};

export function markTone(s: string): "success" | "warning" | "info" | "danger" | "neutral" {
  return s === "present" ? "success" : s === "late" ? "warning" : s === "excused" ? "info" : s === "unexcused" ? "danger" : "neutral";
}

export function AdminAttendanceSheet({ sheet, coaches }: { sheet: AttendanceSheet; coaches: { id: string; name: string }[] }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Record<string, MarkStatus>>({});
  const [ack, setAck] = React.useState(false);
  const [ledBy, setLedBy] = React.useState(sheet.sheet?.led_by_coach_id ?? "");
  const [correcting, setCorrecting] = React.useState<string | null>(null);
  const [reopenReason, setReopenReason] = React.useState("");
  const [showReopen, setShowReopen] = React.useState(false);

  React.useEffect(() => { setDraft({}); }, [sheet.sheet?.version]);

  const s = sheet.sheet;
  const cancelled = sheet.event.status === "cancelled";
  const editable = !!s && s.status !== "final" && sheet.access.can_edit && !cancelled;
  const final = s?.status === "final";
  const label = (st: string) => t.dynamic(`adminAttendance.mark.${st}`, undefined, st);
  const dirty = Object.keys(draft).length > 0;

  async function guard<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true); setError(null); setNotice(null);
    try { return await fn(); } finally { setBusy(false); }
  }

  async function open() {
    const res = await guard(() => openAttendance(sheet.event.id));
    if (res && !res.ok) setError(res.error); else router.refresh();
  }

  async function save(): Promise<boolean> {
    if (!s) return false;
    const marks = sheet.marks.filter((m) => draft[m.athlete_id] && draft[m.athlete_id] !== m.status)
      .map((m) => ({ athleteId: m.athlete_id, status: draft[m.athlete_id], baseRev: m.rev }));
    if (!marks.length) return true;
    const res = await guard(() => saveAttendance({ eventId: sheet.event.id, marks, expectedVersion: s.version, requestId: newRequestId(), ackReported: ack }));
    if (!res) return false;
    if (!res.ok) { setError(res.error); return false; }
    const d = res.data;
    if (d && d.conflicts.length) setNotice(t("adminAttendance.sheet.conflicts", { count: d.conflicts.length }));
    else if (d && d.warnings.some((w) => !w.acknowledged)) setNotice(t("adminAttendance.sheet.reportedWarning"));
    router.refresh();
    return true;
  }

  async function allPresent() {
    if (!s) return;
    const res = await guard(() => markAllPresent({ eventId: sheet.event.id, expectedVersion: s.version, requestId: newRequestId() }));
    if (res && !res.ok) setError(res.error);
    else if (res && (res.data as { ok?: boolean } | undefined)?.ok === false) setError(t("teamAttendance.errors.VERSION_CONFLICT"));
    router.refresh();
  }

  async function finalize() {
    if (!s) return;
    if (dirty && !(await save())) return;
    const res = await guard(() => finalizeAttendance({
      eventId: sheet.event.id, ledByCoachId: ledBy || null, expectedVersion: s.version, requestId: newRequestId(), ackReported: ack,
    }));
    if (!res) return;
    if (!res.ok) { setError(res.error); return; }
    const d = res.data;
    if (d && !d.ok) {
      if (d.code === "UNMARKED_PLAYERS") setError(t("adminAttendance.sheet.unmarkedLeft", { names: d.unmarked.map((u) => `${u.first_name} ${u.last_name}`).join(", ") }));
      else if (d.code === "REPORTED_ABSENCE_UNACKNOWLEDGED") {
        setError(t("adminAttendance.sheet.reportedNeedAck", { names: d.athletes.map((u) => `${u.first_name} ${u.last_name}`).join(", ") }));
      } else setError(t("teamAttendance.errors.VERSION_CONFLICT"));
    } else setNotice(res.message ?? null);
    router.refresh();
  }

  async function reopen() {
    const res = await guard(() => reopenAttendance({ eventId: sheet.event.id, reason: reopenReason }));
    if (res && !res.ok) setError(res.error);
    else { setShowReopen(false); setReopenReason(""); router.refresh(); }
  }

  if (cancelled) {
    return (
      <Card><CardBody className="text-sm text-text-muted">{t("adminAttendance.sheet.cancelled")}</CardBody></Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("adminAttendance.sheet.title")}</CardTitle>
        <span className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          {s ? <Badge tone={final ? "success" : s.status === "reopened" ? "warning" : "neutral"}>{t.dynamic(`adminAttendance.sheetStatus.${s.status}`, undefined, s.status)}</Badge>
            : <Badge>{t("adminAttendance.sheetStatus.none")}</Badge>}
          {s && <span className="tnum">{t("adminAttendance.sheet.version", { version: s.version })}</span>}
        </span>
      </CardHeader>
      <CardBody className="space-y-4">
        {!s && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-muted">{t("adminAttendance.sheet.preview", { count: sheet.marks.length })}</p>
            {sheet.access.can_edit && <Button size="sm" onClick={() => void open()} disabled={busy}>{t("adminAttendance.sheet.open")}</Button>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-6">
          {(["present", "late", "excused", "unexcused", "unmarked"] as const).map((k) => (
            <div key={k} className="rounded-md bg-surface-elevated px-2 py-2">
              <div className="tnum text-lg font-semibold text-text">{f.number(sheet.counts[k])}</div>
              <div className="text-text-muted">{label(k)}</div>
            </div>
          ))}
          <div className="rounded-md bg-surface-elevated px-2 py-2">
            <div className="tnum text-lg font-semibold text-text">{f.number(sheet.counts.reported_absences)}</div>
            <div className="text-text-muted">{t("adminAttendance.sheet.reported")}</div>
          </div>
        </div>

        <ul className="divide-y divide-border-soft rounded-md border border-border-soft">
          {sheet.marks.map((m) => {
            const current = draft[m.athlete_id] ?? m.status;
            const shown = final ? (m.finalized_status ?? m.status) : current;
            return (
              <li key={m.athlete_id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/admin/athletes/${m.athlete_id}?tab=attendance`} className="text-sm font-medium text-text hover:text-brand-primary">
                    <span className="mr-1.5 font-mono text-xs text-text-muted">{m.jersey_number ?? ""}</span>{m.first_name} {m.last_name}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                    {m.is_guest && <Badge tone="info">{t("adminAttendance.sheet.guest")}</Badge>}
                    {m.reported_absence && (
                      <span className="inline-flex items-center gap-1 text-warning">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        {t("adminAttendance.sheet.reportedAbsence", { category: t.dynamic(`adminAttendance.category.${m.reported_absence.reason_category}`, undefined, m.reported_absence.reason_category) })}
                      </span>
                    )}
                    {m.updated_by_name && m.updated_at && <span>{t("adminAttendance.sheet.lastBy", { name: m.updated_by_name, date: f.dateTime(m.updated_at) })}</span>}
                  </div>
                </div>
                {editable ? (
                  <div className="flex flex-wrap gap-1" role="group" aria-label={t("adminAttendance.sheet.statusFor", { name: `${m.first_name} ${m.last_name}` })}>
                    {FINAL_STATUSES.map((st) => (
                      <button key={st} type="button" disabled={busy} aria-pressed={current === st}
                        onClick={() => setDraft((d) => ({ ...d, [m.athlete_id]: st }))}
                        className={cn("h-8 rounded-md border px-2.5 text-xs font-medium transition-colors",
                          current === st ? TONE[st] : "border-border bg-surface text-text-muted hover:text-text")}>
                        {label(st)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Badge tone={markTone(shown)}>{label(shown)}</Badge>
                    {final && sheet.access.can_correct && (
                      <Button size="sm" variant="ghost" onClick={() => setCorrecting(correcting === m.athlete_id ? null : m.athlete_id)}>
                        {t("adminAttendance.sheet.correct")}
                      </Button>
                    )}
                  </div>
                )}
                {final && correcting === m.athlete_id && (
                  <CorrectForm eventId={sheet.event.id} athleteId={m.athlete_id} current={(m.finalized_status ?? "present") as FinalStatus}
                    onDone={() => { setCorrecting(null); router.refresh(); }} />
                )}
              </li>
            );
          })}
          {sheet.marks.length === 0 && <li className="px-3 py-6 text-center text-sm text-text-muted">{t("adminAttendance.sheet.empty")}</li>}
        </ul>

        {editable && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-text-muted">
              <input type="checkbox" className="h-4 w-4 accent-[var(--red-primary)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              {t("adminAttendance.sheet.ackReported")}
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => void save()} disabled={busy || !dirty}>{t("adminAttendance.sheet.save")}</Button>
              <Button size="sm" variant="secondary" onClick={() => void allPresent()} disabled={busy || dirty || sheet.counts.unmarked === 0}>
                <CheckCheck className="h-4 w-4" aria-hidden /> {t("adminAttendance.sheet.allPresent")}
              </Button>
              <div className="min-w-[12rem]">
                <Label htmlFor="led-by">{t("adminAttendance.sheet.ledBy")}</Label>
                <Select id="led-by" value={ledBy} onChange={(e) => setLedBy(e.target.value)} disabled={busy}>
                  <option value="">{t("adminAttendance.sheet.ledByNone")}</option>
                  {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              <Button size="sm" onClick={() => void finalize()} disabled={busy}>
                <Lock className="h-4 w-4" aria-hidden /> {t("adminAttendance.sheet.finalize")}
              </Button>
            </div>
            {!sheet.event.ended && <FieldHint>{t("adminAttendance.sheet.notEnded")}</FieldHint>}
          </div>
        )}

        {final && sheet.access.can_correct && (
          <div className="space-y-2 border-t border-border-soft pt-3">
            {!showReopen ? (
              <Button size="sm" variant="ghost" onClick={() => setShowReopen(true)}><RotateCcw className="h-4 w-4" aria-hidden /> {t("adminAttendance.sheet.reopen")}</Button>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Label htmlFor="reopen-reason">{t("adminAttendance.sheet.reopenReason")}</Label>
                  <Input id="reopen-reason" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} maxLength={500} />
                </div>
                <Button size="sm" variant="secondary" disabled={busy || reopenReason.trim().length < 3} onClick={() => void reopen()}>{t("adminAttendance.sheet.reopen")}</Button>
              </div>
            )}
          </div>
        )}

        {error && <FieldHint error>{error}</FieldHint>}
        {notice && <FieldHint>{notice}</FieldHint>}
      </CardBody>
    </Card>
  );
}

function CorrectForm({ eventId, athleteId, current, onDone }: { eventId: string; athleteId: string; current: FinalStatus; onDone: () => void }) {
  const t = useT();
  const [status, setStatus] = React.useState<FinalStatus>(current);
  const [reason, setReason] = React.useState("");
  const [ack, setAck] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [requestId] = React.useState(() => newRequestId());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await correctAttendance({ eventId, athleteId, status, reason, requestId, ackReported: ack });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else onDone();
  }

  return (
    <form onSubmit={submit} className="w-full space-y-2 rounded-md bg-surface-elevated p-3 sm:basis-full">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[9rem_1fr_auto]">
        <Select aria-label={t("adminAttendance.corrections.newStatus")} value={status} onChange={(e) => setStatus(e.target.value as FinalStatus)} disabled={busy}>
          {FINAL_STATUSES.map((s) => <option key={s} value={s}>{t.dynamic(`adminAttendance.mark.${s}`, undefined, s)}</option>)}
        </Select>
        <Input aria-label={t("adminAttendance.sheet.correctionReason")} placeholder={t("adminAttendance.sheet.correctionReason")} value={reason}
          onChange={(e) => setReason(e.target.value)} maxLength={500} disabled={busy} />
        <Button type="submit" size="sm" disabled={busy || reason.trim().length < 3 || status === current}>{t("adminAttendance.sheet.applyCorrection")}</Button>
      </div>
      <label className="flex items-center gap-2 text-xs text-text-muted">
        <input type="checkbox" className="h-4 w-4 accent-[var(--red-primary)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        {t("adminAttendance.sheet.ackReported")}
      </label>
      {error && <FieldHint error>{error}</FieldHint>}
    </form>
  );
}
