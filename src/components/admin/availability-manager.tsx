"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus, Pencil } from "lucide-react";
import { Button, Input, Badge } from "@/components/ui";
import { addAvailability, removeAvailability, updateAvailability } from "@/lib/actions/booking";
import { useFormat, useT } from "@/lib/i18n/client";
import { zonedWallTimeToUtc } from "@/lib/format";
import { zonedParts } from "@/lib/club-ops/validation";

type Slot = { id: string; coachId: string; coachName: string; start: string; end: string; isBooked: boolean };

export function AvailabilityManager({ coachId, slots, showCoach }: { coachId: string; slots: Slot[]; showCoach?: boolean }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [date, setDate] = React.useState("");
  const [from, setFrom] = React.useState("17:00");
  const [to, setTo] = React.useState("18:00");
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState<{ id: string; date: string; from: string; to: string } | null>(null);

  // Times are entered in the club's time zone, not the browser's.
  const range = (d: string, a: string, b: string) => {
    const start = zonedWallTimeToUtc(d, a, f.timeZone);
    const end = zonedWallTimeToUtc(d, b, f.timeZone);
    return start && end ? { start: start.toISOString(), end: end.toISOString() } : null;
  };

  async function add() {
    if (!date) { setErr(t("editOps.availability.pickDate")); return; }
    const r = range(date, from, to);
    if (!r) { setErr(t("editOps.errors.invalidDate")); return; }
    setBusy(true); setErr(null);
    const res = await addAvailability(coachId, r.start, r.end);
    setBusy(false);
    if (res.ok) { setDate(""); router.refresh(); } else setErr(res.error);
  }
  async function saveEdit() {
    if (!editing) return;
    const r = range(editing.date, editing.from, editing.to);
    if (!r) { setErr(t("editOps.errors.invalidDate")); return; }
    setBusy(true); setErr(null);
    const res = await updateAvailability(editing.id, r.start, r.end);
    setBusy(false);
    if (res.ok) { setEditing(null); router.refresh(); } else setErr(res.error);
  }
  async function remove(s: Slot) {
    if (!window.confirm(t("editOps.availability.confirmRemove", { when: `${f.date(s.start)} ${f.time(s.start)}` }))) return;
    setBusy(true); setErr(null);
    const res = await removeAvailability(s.id);
    setBusy(false);
    if (res.ok) router.refresh(); else setErr(res.error);
  }
  function startEdit(s: Slot) {
    const a = zonedParts(s.start, f.timeZone);
    const b = zonedParts(s.end, f.timeZone);
    setErr(null);
    setEditing({ id: s.id, date: a.date, from: a.time, to: b.time });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface-elevated/50 p-3">
        <div><label htmlFor="av-date" className="text-xs text-ink-3">{t("common.date")}</label><Input id="av-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" /></div>
        <div><label htmlFor="av-from" className="text-xs text-ink-3">{t("editOps.availability.from")}</label><Input id="av-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="w-28" /></div>
        <div><label htmlFor="av-to" className="text-xs text-ink-3">{t("editOps.availability.to")}</label><Input id="av-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} className="w-28" /></div>
        <Button size="sm" disabled={busy} onClick={add}><Plus className="h-4 w-4" /> {t("editOps.availability.addSlot")}</Button>
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {slots.length === 0 ? <p className="text-sm text-ink-3">{t("editOps.availability.empty")}</p> : (
        <ul className="space-y-1">
          {slots.map((s) => (
            <li key={s.id} className="rounded-lg border border-line px-3 py-2">
              {editing?.id === s.id ? (
                <div className="flex flex-wrap items-end gap-2">
                  <Input aria-label={t("common.date")} type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} className="w-40" />
                  <Input aria-label={t("editOps.availability.from")} type="time" value={editing.from} onChange={(e) => setEditing({ ...editing, from: e.target.value })} className="w-28" />
                  <Input aria-label={t("editOps.availability.to")} type="time" value={editing.to} onChange={(e) => setEditing({ ...editing, to: e.target.value })} className="w-28" />
                  <Button size="sm" disabled={busy} onClick={saveEdit}>{busy ? t("common.saving") : t("common.save")}</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-ink">
                    {showCoach && <span className="text-ink-3">{s.coachName} · </span>}
                    {f.date(s.start)} · {f.time(s.start)}–{f.time(s.end)}
                  </span>
                  <div className="flex items-center gap-1">
                    {s.isBooked ? <Badge tone="warning" title={t("editOps.availability.bookedHint")}>{t("editOps.availability.booked")}</Badge> : (<>
                      <Button size="icon" variant="ghost" disabled={busy} aria-label={t("editOps.availability.editSlot")} onClick={() => startEdit(s)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" disabled={busy} aria-label={t("editOps.availability.removeSlot")} onClick={() => remove(s)} className="hover:text-danger"><Trash2 className="h-4 w-4" /></Button>
                    </>)}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
