"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import { Button, Input, Badge } from "@/components/ui";
import { addAvailability, removeAvailability } from "@/lib/actions/booking";
import { useFormat } from "@/lib/i18n/client";
import { zonedWallTimeToUtc } from "@/lib/format";

type Slot = { id: string; coachId: string; coachName: string; start: string; end: string; isBooked: boolean };
export function AvailabilityManager({ coachId, slots, showCoach }: { coachId: string; slots: Slot[]; showCoach?: boolean }) {
  const f = useFormat();
  const router = useRouter();
  const [date, setDate] = React.useState("");
  const [from, setFrom] = React.useState("17:00");
  const [to, setTo] = React.useState("18:00");
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function add() {
    if (!date) { setErr("Pick a date."); return; }
    setBusy(true); setErr(null);
    // Times are entered in the club's time zone, not the browser's.
    const start = zonedWallTimeToUtc(date, from, f.timeZone);
    const end = zonedWallTimeToUtc(date, to, f.timeZone);
    if (!start || !end) { setBusy(false); setErr("Enter a valid date and time."); return; }
    const startISO = start.toISOString();
    const endISO = end.toISOString();
    const res = await addAvailability(coachId, startISO, endISO);
    setBusy(false);
    if (res.ok) { setDate(""); router.refresh(); } else setErr(res.error);
  }
  async function remove(id: string) {
    setBusy(true); const res = await removeAvailability(id); setBusy(false);
    if (res.ok) router.refresh(); else setErr(res.error);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface-elevated/50 p-3">
        <div><label className="text-xs text-ink-3">Date</label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" /></div>
        <div><label className="text-xs text-ink-3">From</label><Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="w-28" /></div>
        <div><label className="text-xs text-ink-3">To</label><Input type="time" value={to} onChange={(e) => setTo(e.target.value)} className="w-28" /></div>
        <Button size="sm" disabled={busy} onClick={add}><Plus className="h-4 w-4" /> Add slot</Button>
      </div>
      {err && <p className="text-sm text-danger">{err}</p>}
      {slots.length === 0 ? <p className="text-sm text-ink-3">No availability yet.</p> : (
        <ul className="space-y-1">
          {slots.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
              <span className="text-sm text-ink">
                {showCoach && <span className="text-ink-3">{s.coachName} · </span>}
                {f.date(s.start)} · {f.time(s.start)}–{f.time(s.end)}
              </span>
              <div className="flex items-center gap-2">
                {s.isBooked ? <Badge tone="warning">booked</Badge> : (
                  <button onClick={() => remove(s.id)} disabled={busy} className="text-ink-3 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
