"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { FormError, Select, Textarea } from "@/components/teams/fields";
import { checkEventConflicts, saveEvent, type ConflictWarning, type EventInput } from "@/lib/sportsops/actions";
import { EVENT_TYPES } from "@/lib/sportsops/labels";

type Opt = { id: string; name: string };
type VenueOpt = Opt & { spaces: Opt[] };
type EventType = EventInput["type"];

export type EventFormValues = {
  teamId: string; type: EventType; title: string; venueId: string; spaceId: string; locationText: string;
  date: string; start: string; end: string; opponent: string; homeAway: "" | "home" | "away" | "neutral"; notes: string;
  status: "scheduled" | "postponed" | "cancelled" | "completed"; repeatWeeks: number;
};

/** Local (browser) wall-clock -> ISO with offset. */
function toIso(date: string, time: string) {
  if (!date || !time) return "";
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
function fmt(iso: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function EventForm({ eventId, initial, teams, venues, returnTo, lockTeam }: {
  eventId?: string; initial?: Partial<EventFormValues>; teams: Opt[]; venues: VenueOpt[]; returnTo: string; lockTeam?: boolean;
}) {
  const router = useRouter();
  const [f, setF] = React.useState<EventFormValues>({
    teamId: teams.length === 1 ? teams[0].id : "", type: "training", title: "", venueId: "", spaceId: "", locationText: "",
    date: "", start: "17:00", end: "18:30", opponent: "", homeAway: "", notes: "", status: "scheduled", repeatWeeks: 0, ...initial,
  });
  const [err, setErr] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<ConflictWarning[]>([]);
  const [confirmed, setConfirmed] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const set = <K extends keyof EventFormValues>(k: K, v: EventFormValues[K]) => { setF((s) => ({ ...s, [k]: v })); setConfirmed(false); };

  const venue = venues.find((v) => v.id === f.venueId);
  const isGame = f.type === "game" || f.type === "tournament";
  const startsAt = toIso(f.date, f.start);
  // An end time earlier than the start rolls over to the next day (late sessions).
  const endsAt = (() => {
    const e = toIso(f.date, f.end);
    if (!e || !startsAt) return "";
    return Date.parse(e) > Date.parse(startsAt) ? e : new Date(Date.parse(e) + 864e5).toISOString();
  })();

  // Live conflict check (debounced) as venue/time changes.
  React.useEffect(() => {
    if (!f.venueId || !startsAt || !endsAt) { setWarnings([]); return; }
    const t = setTimeout(async () => {
      setWarnings(await checkEventConflicts({ venueId: f.venueId, spaceId: f.spaceId || null, startsAt, endsAt, excludeEventId: eventId ?? null }));
    }, 300);
    return () => clearTimeout(t);
  }, [f.venueId, f.spaceId, startsAt, endsAt, eventId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!startsAt || !endsAt) return setErr("Enter a date and time.");
    setPending(true); setErr(null);
    const res = await saveEvent(eventId ?? null, {
      teamId: f.teamId || null, type: f.type, title: f.title, venueId: f.venueId || null, spaceId: f.spaceId || null,
      locationText: f.locationText, startsAt, endsAt, opponent: f.opponent, homeAway: f.homeAway || null, notes: f.notes,
      status: f.status, repeatWeeks: eventId ? 0 : f.repeatWeeks,
    }, confirmed);
    setPending(false);
    if (!res.ok) {
      if ("conflicts" in res) { setWarnings(res.conflicts); setErr("This overlaps other bookings at the venue. Review and confirm to save anyway."); return; }
      return setErr(res.error);
    }
    router.push(returnTo);
    router.refresh();
  }

  const hardClash = warnings.some((w) => w.sameSpace);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><Label htmlFor="e-type">Type</Label>
          <Select id="e-type" value={f.type} onChange={(e) => set("type", e.target.value as EventType)}>
            {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select></div>
        <div><Label htmlFor="e-team">Team</Label>
          <Select id="e-team" value={f.teamId} disabled={lockTeam} onChange={(e) => set("teamId", e.target.value)}>
            {!lockTeam && <option value="">Club-wide (no team)</option>}
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select></div>
        <div className="sm:col-span-2"><Label htmlFor="e-title">Title (optional)</Label><Input id="e-title" maxLength={200} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder={isGame ? "Defaults to “Team vs Opponent”" : "Defaults to “Team · Training”"} /></div>
        {isGame && (<>
          <div><Label htmlFor="e-opp">Opponent</Label><Input id="e-opp" maxLength={200} value={f.opponent} onChange={(e) => set("opponent", e.target.value)} /></div>
          <div><Label htmlFor="e-ha">Home / away</Label>
            <Select id="e-ha" value={f.homeAway} onChange={(e) => set("homeAway", e.target.value as EventFormValues["homeAway"])}>
              <option value="">—</option><option value="home">Home</option><option value="away">Away</option><option value="neutral">Neutral</option>
            </Select></div>
        </>)}
        <div><Label htmlFor="e-date">Date</Label><Input id="e-date" type="date" required value={f.date} onChange={(e) => set("date", e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label htmlFor="e-start">Start</Label><Input id="e-start" type="time" required step={300} value={f.start} onChange={(e) => set("start", e.target.value)} /></div>
          <div><Label htmlFor="e-end">End</Label><Input id="e-end" type="time" required step={300} value={f.end} onChange={(e) => set("end", e.target.value)} /></div>
        </div>
        <div><Label htmlFor="e-venue">Venue</Label>
          <Select id="e-venue" value={f.venueId} onChange={(e) => { set("venueId", e.target.value); set("spaceId", ""); }}>
            <option value="">No venue / other location</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select></div>
        <div><Label htmlFor="e-space">Court / field</Label>
          <Select id="e-space" value={f.spaceId} disabled={!venue || venue.spaces.length === 0} onChange={(e) => set("spaceId", e.target.value)}>
            <option value="">Whole venue</option>
            {venue?.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select></div>
        {!f.venueId && <div className="sm:col-span-2"><Label htmlFor="e-loc">Location</Label><Input id="e-loc" maxLength={200} value={f.locationText} onChange={(e) => set("locationText", e.target.value)} placeholder="Address for away games or off-site events" /></div>}
        {eventId ? (
          <div><Label htmlFor="e-status">Status</Label>
            <Select id="e-status" value={f.status} onChange={(e) => set("status", e.target.value as EventFormValues["status"])}>
              <option value="scheduled">Scheduled</option><option value="postponed">Postponed</option><option value="cancelled">Cancelled</option><option value="completed">Completed</option>
            </Select></div>
        ) : (
          <div><Label htmlFor="e-rep">Repeat weekly</Label>
            <Select id="e-rep" value={String(f.repeatWeeks)} onChange={(e) => set("repeatWeeks", Number(e.target.value))}>
              <option value="0">Does not repeat</option>
              {[3, 7, 11, 15, 19, 39].map((n) => <option key={n} value={n}>{`${n + 1} weeks in total`}</option>)}
            </Select></div>
        )}
      </div>
      <div><Label htmlFor="e-notes">Notes for families</Label><Textarea id="e-notes" maxLength={2000} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Kit, meeting time, transport…" /></div>

      {warnings.length > 0 && (
        <div role="status" className="rounded-md border border-warning bg-warning-soft p-4 text-sm">
          <div className="flex items-center gap-2 font-medium text-warning"><AlertTriangle className="h-4 w-4" />
            {hardClash ? "Double booking: this court/field is already taken" : `Venue conflict: ${venue?.name ?? "this venue"} is already booked`}
          </div>
          <ul className="mt-2 space-y-1 text-ink-2">
            {warnings.slice(0, 8).map((w, i) => (
              <li key={`${w.eventId}-${i}`}>{w.label} — {fmt(w.startsAt)}–{new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(w.endsAt))}{w.spaceName ? ` · ${w.spaceName}` : " · whole venue"}</li>
            ))}
            {warnings.length > 8 && <li>…and {warnings.length - 8} more</li>}
          </ul>
          {hardClash ? <p className="mt-2 text-xs text-ink-3">Pick another court/field or time — the same space can&apos;t be booked twice.</p> : (
            <label className="mt-3 flex items-center gap-2 text-ink-2"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" /> The venue can host both — save anyway</label>
          )}
        </div>
      )}

      <FormError message={err} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || hardClash || (warnings.length > 0 && !confirmed)}>{pending ? "Saving…" : eventId ? "Save event" : f.repeatWeeks ? `Create ${f.repeatWeeks + 1} events` : "Create event"}</Button>
        <Button type="button" variant="ghost" onClick={() => router.push(returnTo)}>Cancel</Button>
      </div>
    </form>
  );
}
