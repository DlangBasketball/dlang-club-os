"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RotateCcw, Trash2, UserPlus } from "lucide-react";
import { Badge, Button, Input, Label, statusTone } from "@/components/ui";
import { Select } from "@/components/teams/fields";
import { ReasonDialog } from "@/components/club-ops/reason-dialog";
import { correctAttendance, reopenAttendanceSession } from "@/lib/actions/attendance";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "@/lib/club-ops/validation";
import { useT } from "@/lib/i18n/client";

type Mark = { athleteId: string; name: string; status: string; notes: string | null; injury: boolean; correctedAt: string | null };
type Row = { athleteId: string; name: string; status: AttendanceStatus | null; notes: string; injury: boolean; isNew?: boolean; original?: Mark };

/** Admin / session-coach correction of a session's marks, with audit. */
export function AttendanceCorrection({ sessionId, status, marks, addable, canReopen }: {
  sessionId: string; status: string; marks: Mark[]; addable: { id: string; name: string }[]; canReopen: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const initial = React.useCallback((): Row[] => marks.map((m) => ({
    athleteId: m.athleteId, name: m.name, status: m.status as AttendanceStatus, notes: m.notes ?? "", injury: m.injury, original: m,
  })), [marks]);
  const [rows, setRows] = React.useState<Row[]>(initial);
  const [addId, setAddId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [reopenOpen, setReopenOpen] = React.useState(false);
  const [reopenErr, setReopenErr] = React.useState<string | null>(null);
  React.useEffect(() => { setRows(initial()); }, [initial]);

  const changed = rows.filter((r) => {
    const o = r.original;
    if (!o) return r.status !== null;
    return r.status !== o.status || r.notes.trim() !== (o.notes ?? "") || r.injury !== o.injury;
  });
  const update = (id: string, patch: Partial<Row>) => { setMsg(null); setRows((rs) => rs.map((r) => (r.athleteId === id ? { ...r, ...patch } : r))); };
  const remaining = addable.filter((a) => !rows.some((r) => r.athleteId === a.id));

  function addLate() {
    const a = addable.find((x) => x.id === addId);
    if (!a) return;
    setRows((rs) => [...rs, { athleteId: a.id, name: a.name, status: "late", notes: "", injury: false, isNew: true }]);
    setAddId("");
  }
  function removeRow(r: Row) {
    if (r.isNew) { setRows((rs) => rs.filter((x) => x.athleteId !== r.athleteId)); return; }
    if (!window.confirm(t("editOps.attendance.confirmRemove", { name: r.name }))) return;
    update(r.athleteId, { status: null });
  }
  async function save() {
    if (!changed.length) { setMsg({ tone: "err", text: t("editOps.errors.nothingToSave") }); return; }
    setBusy(true); setMsg(null);
    const res = await correctAttendance({
      sessionId, reason,
      marks: changed.map((r) => ({ athleteId: r.athleteId, status: r.status, notes: r.notes, injuryFlag: r.injury })),
    });
    setBusy(false);
    if (!res.ok) { setMsg({ tone: "err", text: res.error }); return; }
    setReason("");
    setMsg({ tone: "ok", text: t("editOps.attendance.saved", { count: res.changed }) });
    router.refresh();
  }
  async function reopen(r: string) {
    setBusy(true); setReopenErr(null);
    const res = await reopenAttendanceSession(sessionId, r);
    setBusy(false);
    if (!res.ok) { setReopenErr(res.error); return; }
    setReopenOpen(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line-soft">
        {rows.map((r) => (
          <li key={r.athleteId} className={`space-y-2 py-3 ${r.status === null ? "opacity-50" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-ink">
                {r.name}
                {r.injury && <AlertTriangle className="h-4 w-4 text-danger" aria-label={t("editOps.attendance.injury")} />}
                {r.isNew && <Badge tone="warning">{t("editOps.attendance.added")}</Badge>}
                {r.original?.correctedAt && <Badge tone="neutral">{t("editOps.attendance.corrected")}</Badge>}
              </span>
              <div className="flex items-center gap-2">
                <Select aria-label={t("editOps.attendance.statusFor", { name: r.name })} className="h-8 w-36" value={r.status ?? ""} disabled={busy}
                  onChange={(e) => update(r.athleteId, { status: (e.target.value || null) as AttendanceStatus | null })}>
                  {r.status === null && <option value="">{t("editOps.attendance.removed")}</option>}
                  {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{t(`editOps.attendance.statuses.${s}`)}</option>)}
                </Select>
                {r.status !== null && (
                  <Button size="icon" variant="ghost" disabled={busy} aria-label={t("editOps.attendance.removeMark", { name: r.name })} onClick={() => removeRow(r)}><Trash2 className="h-4 w-4" /></Button>
                )}
              </div>
            </div>
            {r.status !== null && (
              <div className="flex flex-wrap items-center gap-3">
                <Input aria-label={t("editOps.attendance.noteFor", { name: r.name })} className="h-8 min-w-[12rem] flex-1" maxLength={1000} value={r.notes} disabled={busy}
                  placeholder={t("editOps.attendance.notePlaceholder")} onChange={(e) => update(r.athleteId, { notes: e.target.value })} />
                <label className="flex items-center gap-1.5 text-xs text-ink-2">
                  <input type="checkbox" checked={r.injury} disabled={busy} onChange={(e) => update(r.athleteId, { injury: e.target.checked })} className="h-4 w-4 accent-[var(--red-primary)]" />
                  {t("editOps.attendance.injury")}
                </label>
              </div>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="py-6 text-center text-sm text-ink-3">{t("editOps.attendance.noMarks")}</li>}
      </ul>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3">
        <div className="min-w-[14rem] flex-1">
          <Label htmlFor="att-add">{t("editOps.attendance.addLate")}</Label>
          <Select id="att-add" value={addId} disabled={busy || remaining.length === 0} onChange={(e) => setAddId(e.target.value)}>
            <option value="">{t("editOps.attendance.pickAthlete")}</option>
            {remaining.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </div>
        <Button size="sm" variant="secondary" disabled={busy || !addId} onClick={addLate}><UserPlus className="h-4 w-4" /> {t("common.add")}</Button>
      </div>

      <div>
        <Label htmlFor="att-reason">{t("editOps.common.reasonOptional")}</Label>
        <Input id="att-reason" maxLength={500} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} placeholder={t("editOps.attendance.reasonPlaceholder")} />
      </div>
      {msg && <p role={msg.tone === "err" ? "alert" : "status"} className={msg.tone === "err" ? "text-sm text-danger" : "text-sm text-success"}>{msg.text}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || changed.length === 0} onClick={save}>{busy ? t("common.saving") : t("editOps.attendance.saveCorrections", { count: changed.length })}</Button>
        {changed.length > 0 && <Button variant="ghost" disabled={busy} onClick={() => { setRows(initial()); setMsg(null); }}>{t("editOps.common.discard")}</Button>}
        {canReopen && status !== "open" && (
          <Button variant="secondary" disabled={busy} onClick={() => { setReopenErr(null); setReopenOpen(true); }} className="ml-auto">
            <RotateCcw className="h-4 w-4" /> {t("editOps.attendance.reopen")}
          </Button>
        )}
        <Badge tone={statusTone(status)} className={canReopen && status !== "open" ? "" : "ml-auto"}>{t.dynamic(`editOps.attendance.sessionStatuses.${status}`, undefined, status)}</Badge>
      </div>

      <ReasonDialog open={reopenOpen} title={t("editOps.attendance.reopenTitle")} description={t("editOps.attendance.reopenDescription")}
        confirmLabel={t("editOps.attendance.reopen")} pending={busy} error={reopenErr} danger={false}
        onClose={() => setReopenOpen(false)} onConfirm={reopen} />
    </div>
  );
}
