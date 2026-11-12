"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, X, ShieldOff, NotebookPen, AlertTriangle, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { saveAttendance, type AttendanceMarkInput } from "@/lib/actions/attendance";
import type { RosterEntry } from "@/lib/data/coach-sessions";
import { Avatar } from "@/components/ui";

type Status = "present" | "late" | "absent" | "excused";
type Row = RosterEntry & { dirty?: boolean };

const OPTS: { value: Status; label: string; Icon: React.ComponentType<{ className?: string }>; cls: string; sel: string }[] = [
  { value: "present", label: "Present", Icon: Check, cls: "text-success border-success/40", sel: "bg-success text-white border-success" },
  { value: "late", label: "Late", Icon: Clock, cls: "text-warning border-warning/40", sel: "bg-warning text-black border-warning" },
  { value: "absent", label: "Absent", Icon: X, cls: "text-danger border-danger/40", sel: "bg-danger text-white border-danger" },
  { value: "excused", label: "Excused", Icon: ShieldOff, cls: "text-ink-2 border-line", sel: "bg-ink-2 text-bg border-ink-2" },
];

export function AttendanceRoster({
  attendanceSessionId, programName, initialRoster, locked, photos,
}: {
  attendanceSessionId: string;
  programName: string;
  initialRoster: RosterEntry[];
  locked: boolean;
  /** athleteId -> short-lived signed photo URL (identification only). */
  photos?: Record<string, string>;
}) {
  const router = useRouter();
  const [rows, setRows] = React.useState<Row[]>(initialRoster);
  const [noteFor, setNoteFor] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"save" | "submit" | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  const counts = React.useMemo(() => ({
    present: rows.filter((r) => r.status === "present").length,
    late: rows.filter((r) => r.status === "late").length,
    absent: rows.filter((r) => r.status === "absent").length,
    excused: rows.filter((r) => r.status === "excused").length,
    marked: rows.filter((r) => r.status).length,
  }), [rows]);

  const setStatus = (id: string, status: Status) =>
    setRows((rs) => rs.map((r) => (r.athleteId === id ? { ...r, status, dirty: true } : r)));
  const setNote = (id: string, notes: string, injuryFlag: boolean) =>
    setRows((rs) => rs.map((r) => (r.athleteId === id ? { ...r, notes, injuryFlag, dirty: true } : r)));

  async function persist(submit: boolean) {
    const marks: AttendanceMarkInput[] = rows
      .filter((r) => r.status)
      .map((r) => ({ athlete_id: r.athleteId, status: r.status as Status, notes: r.notes ?? undefined, injury_flag: r.injuryFlag }));
    if (submit && marks.length < rows.length) {
      if (!window.confirm(`${rows.length - marks.length} athlete(s) unmarked. Submit anyway?`)) return;
    }
    setBusy(submit ? "submit" : "save");
    setMsg(null);
    const res = await saveAttendance(attendanceSessionId, marks, submit);
    setBusy(null);
    if (!res.ok) { setMsg(res.error); return; }
    if (submit) router.push("/coach/attendance");
    else { setMsg("Saved"); router.refresh(); }
  }

  const noteRow = rows.find((r) => r.athleteId === noteFor) ?? null;

  return (
    <div className="pb-28">
      <div className="mb-4 flex items-center gap-2">
        <Link href="/coach/attendance" className="text-ink-3 hover:text-ink"><ChevronLeft className="h-5 w-5" /></Link>
        <div>
          <h1 className="font-display text-xl font-semibold">{programName}</h1>
          <p className="text-xs text-ink-3">{counts.marked}/{rows.length} marked{locked ? " · locked" : ""}</p>
        </div>
      </div>

      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.athleteId} className="rounded-xl border border-line bg-surface-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Avatar name={r.fullName} src={photos?.[r.athleteId] ?? null} size="lg" />
                <span className="font-medium text-ink">{r.fullName}</span>
                {(r.allergies || r.conditions) && (
                  <span title={`${r.allergies ?? ""} ${r.conditions ?? ""}`.trim()} className="rounded bg-warning-soft px-1.5 py-0.5 text-[10px] text-warning">medical</span>
                )}
                {r.injuryFlag && <AlertTriangle className="h-4 w-4 text-danger" />}
              </div>
              <button onClick={() => setNoteFor(r.athleteId)} disabled={locked}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${r.notes ? "text-maroon" : "text-ink-3"} hover:text-ink disabled:opacity-40`}>
                <NotebookPen className="h-3.5 w-3.5" /> {r.notes ? "Note" : "Add note"}
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {OPTS.map((o) => {
                const active = r.status === o.value;
                return (
                  <button key={o.value} disabled={locked} onClick={() => setStatus(r.athleteId, o.value)}
                    className={`flex h-12 flex-col items-center justify-center gap-0.5 rounded-lg border text-[11px] font-medium transition active:scale-95 disabled:opacity-50 ${active ? o.sel : `bg-surface-elevated ${o.cls}`}`}>
                    <o.Icon className="h-4 w-4" /> {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Sticky submit bar */}
      {!locked && (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <div className="text-xs text-ink-3">
              <span className="text-success">{counts.present}P</span> · <span className="text-warning">{counts.late}L</span> · <span className="text-danger">{counts.absent}A</span> · {counts.excused}E
              {msg && <span className="ml-2 text-ink-2">{msg}</span>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => persist(false)} disabled={busy !== null}
                className="rounded-lg border border-line px-4 py-2.5 text-sm text-ink-2 active:scale-95 disabled:opacity-50">
                {busy === "save" ? "Saving…" : "Save"}
              </button>
              <button onClick={() => persist(true)} disabled={busy !== null}
                className="rounded-lg bg-maroon px-5 py-2.5 text-sm font-semibold text-white active:scale-95 disabled:opacity-50">
                {busy === "submit" ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Note / injury sheet */}
      {noteRow && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setNoteFor(null)}>
          <div className="w-full max-w-md rounded-t-2xl border border-line bg-surface-card p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-ink">{noteRow.fullName}</h3>
            {(noteRow.allergies || noteRow.conditions || noteRow.emergencyContactPhone) && (
              <div className="mt-2 rounded-md bg-warning-soft/50 p-2 text-xs text-ink-2">
                {noteRow.allergies && <div>Allergies: {noteRow.allergies}</div>}
                {noteRow.conditions && <div>Conditions: {noteRow.conditions}</div>}
                {noteRow.emergencyContactPhone && <div>Emergency: {noteRow.emergencyContactName} · {noteRow.emergencyContactPhone}</div>}
              </div>
            )}
            <label className="mt-3 block text-xs text-ink-3">Private coach note</label>
            <textarea defaultValue={noteRow.notes ?? ""} id="note-text" rows={3}
              className="mt-1 w-full rounded-lg border border-line bg-surface-input p-3 text-sm text-ink" placeholder="Only visible to coaches and admins" />
            <label className="mt-3 flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" id="injury-flag" defaultChecked={noteRow.injuryFlag} className="h-4 w-4 accent-[var(--red-primary)]" />
              <AlertTriangle className="h-4 w-4 text-danger" /> Flag injury / medical issue
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setNoteFor(null)} className="rounded-lg px-4 py-2 text-sm text-ink-3">Cancel</button>
              <button onClick={() => {
                const t = (document.getElementById("note-text") as HTMLTextAreaElement)?.value ?? "";
                const inj = (document.getElementById("injury-flag") as HTMLInputElement)?.checked ?? false;
                setNote(noteRow.athleteId, t, inj);
                setNoteFor(null);
              }} className="rounded-lg bg-maroon px-4 py-2 text-sm font-semibold text-white">Save note</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
