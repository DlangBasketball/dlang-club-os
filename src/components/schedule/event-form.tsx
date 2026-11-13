"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { FormError, Select, Textarea } from "@/components/teams/fields";
import { checkEventConflicts, saveEvent, type ConflictWarning, type EventInput } from "@/lib/sportsops/actions";
import { EVENT_TYPES } from "@/lib/sportsops/labels";
import { CLUB_TZ } from "@/lib/sportsops/time";
import { zonedWallTimeToUtc } from "@/lib/format";
import { useFormat, useT } from "@/lib/i18n/client";
import type { EventScope } from "@/lib/club-ops/validation";

type Opt = { id: string; name: string };
type VenueOpt = Opt & { spaces: Opt[] };
type EventType = EventInput["type"];

/** Select values for the place picker besides real venue ids. */
const NEW_VENUE = "__new";
const OTHER = "__other";

export type EventFormValues = {
  teamId: string; type: EventType; title: string; venueId: string; spaceId: string; locationText: string; locationName: string;
  date: string; start: string; end: string; opponent: string; homeAway: "" | "home" | "away" | "neutral"; notes: string;
  status: "scheduled" | "postponed" | "cancelled" | "completed"; repeatWeeks: number;
};

/** Club wall-clock (club time zone) -> ISO instant. */
function toIso(date: string, time: string) {
  if (!date || !time) return "";
  return zonedWallTimeToUtc(date, time, CLUB_TZ)?.toISOString() ?? "";
}

export function EventForm({ eventId, seriesId, initial, teams, venues, returnTo, lockTeam, canCreateVenue }: {
  eventId?: string; seriesId?: string | null; initial?: Partial<EventFormValues>; teams: Opt[]; venues: VenueOpt[]; returnTo: string; lockTeam?: boolean;
  /** Admins can add a club venue from the form ("+ New venue"). */
  canCreateVenue?: boolean;
}) {
  const t = useT();
  const fmt = useFormat();
  const router = useRouter();
  const [f, setF] = React.useState<EventFormValues>({
    teamId: teams.length === 1 ? teams[0].id : "", type: "training", title: "", venueId: "", spaceId: "", locationText: "", locationName: "",
    date: "", start: "17:00", end: "18:30", opponent: "", homeAway: "", notes: "", status: "scheduled", repeatWeeks: 0, ...initial,
  });
  const [place, setPlace] = React.useState<string>(initial?.venueId || (venues.length && !initial?.locationText && !initial?.locationName && !eventId ? venues[0].id : OTHER));
  const [newVenue, setNewVenue] = React.useState({ name: "", address: "", city: "" });
  const [scope, setScope] = React.useState<EventScope>("one");
  const [err, setErr] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<ConflictWarning[]>([]);
  const [confirmed, setConfirmed] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const set = <K extends keyof EventFormValues>(k: K, v: EventFormValues[K]) => { setF((s) => ({ ...s, [k]: v })); setConfirmed(false); };

  const venueId = place !== NEW_VENUE && place !== OTHER ? place : "";
  const venue = venues.find((v) => v.id === venueId);
  const isGame = f.type === "game" || f.type === "tournament";
  const startsAt = toIso(f.date, f.start);
  // An end time earlier than the start rolls over to the next day (late sessions).
  const endsAt = (() => {
    const e = toIso(f.date, f.end);
    if (!e || !startsAt) return "";
    return Date.parse(e) > Date.parse(startsAt) ? e : new Date(Date.parse(e) + 864e5).toISOString();
  })();
  const spaceId = venueId ? f.spaceId : "";

  // Live conflict check (debounced) as venue/time changes.
  React.useEffect(() => {
    if (!venueId || !startsAt || !endsAt) { setWarnings([]); return; }
    const timer = setTimeout(async () => {
      setWarnings(await checkEventConflicts({ venueId, spaceId: spaceId || null, startsAt, endsAt, excludeEventId: eventId ?? null }));
    }, 300);
    return () => clearTimeout(timer);
  }, [venueId, spaceId, startsAt, endsAt, eventId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!startsAt || !endsAt) return setErr(t("editOps.events.enterDateTime"));
    if (place === NEW_VENUE && !newVenue.name.trim()) return setErr(t("editOps.events.newVenueNameRequired"));
    setPending(true); setErr(null);
    const res = await saveEvent(eventId ?? null, {
      teamId: f.teamId || null, type: f.type, title: f.title, venueId: venueId || null, spaceId: spaceId || null,
      locationText: place === OTHER ? f.locationText : "", locationName: place === OTHER ? f.locationName : "",
      newVenue: place === NEW_VENUE ? { name: newVenue.name, address: newVenue.address, city: newVenue.city } : null,
      startsAt, endsAt, opponent: f.opponent, homeAway: f.homeAway || null, notes: f.notes,
      status: f.status, repeatWeeks: eventId ? 0 : f.repeatWeeks,
    }, confirmed, scope);
    setPending(false);
    if (!res.ok) {
      if ("conflicts" in res) { setWarnings(res.conflicts); setErr(t("editOps.events.conflictConfirm")); return; }
      return setErr(res.error);
    }
    router.push(returnTo);
    router.refresh();
  }

  const hardClash = warnings.some((w) => w.sameSpace);
  const timeFmt = (iso: string) => fmt.time(iso);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><Label htmlFor="e-type">{t("editOps.events.type")}</Label>
          <Select id="e-type" value={f.type} onChange={(e) => set("type", e.target.value as EventType)}>
            {EVENT_TYPES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </Select></div>
        <div><Label htmlFor="e-team">{t("editOps.events.team")}</Label>
          <Select id="e-team" value={f.teamId} disabled={lockTeam} onChange={(e) => set("teamId", e.target.value)}>
            {!lockTeam && <option value="">{t("editOps.events.clubWide")}</option>}
            {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select></div>
        <div className="sm:col-span-2"><Label htmlFor="e-title">{t("editOps.events.titleOptional")}</Label><Input id="e-title" maxLength={200} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder={isGame ? t("editOps.events.titlePlaceholderGame") : t("editOps.events.titlePlaceholder")} /></div>
        {isGame && (<>
          <div><Label htmlFor="e-opp">{t("editOps.events.opponent")}</Label><Input id="e-opp" maxLength={200} value={f.opponent} onChange={(e) => set("opponent", e.target.value)} /></div>
          <div><Label htmlFor="e-ha">{t("editOps.events.homeAway")}</Label>
            <Select id="e-ha" value={f.homeAway} onChange={(e) => set("homeAway", e.target.value as EventFormValues["homeAway"])}>
              <option value="">—</option><option value="home">{t("editOps.events.home")}</option><option value="away">{t("editOps.events.away")}</option><option value="neutral">{t("editOps.events.neutral")}</option>
            </Select></div>
        </>)}
        <div><Label htmlFor="e-date">{t("common.date")}</Label><Input id="e-date" type="date" required value={f.date} onChange={(e) => set("date", e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label htmlFor="e-start">{t("editOps.events.start")}</Label><Input id="e-start" type="time" required step={300} value={f.start} onChange={(e) => set("start", e.target.value)} /></div>
          <div><Label htmlFor="e-end">{t("editOps.events.end")}</Label><Input id="e-end" type="time" required step={300} value={f.end} onChange={(e) => set("end", e.target.value)} /></div>
        </div>
        <div><Label htmlFor="e-venue">{t("editOps.events.venue")}</Label>
          <Select id="e-venue" value={place} onChange={(e) => { setPlace(e.target.value); set("spaceId", ""); }}>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            {canCreateVenue && <option value={NEW_VENUE}>{t("editOps.events.newVenueOption")}</option>}
            <option value={OTHER}>{t("editOps.events.otherLocationOption")}</option>
          </Select></div>
        {venueId ? (
          <div><Label htmlFor="e-space">{t("editOps.events.space")}</Label>
            <Select id="e-space" value={f.spaceId} disabled={!venue || venue.spaces.length === 0} onChange={(e) => set("spaceId", e.target.value)}>
              <option value="">{t("editOps.events.wholeVenue")}</option>
              {venue?.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select></div>
        ) : <div className="hidden sm:block" />}
        {place === NEW_VENUE && (
          <div className="grid grid-cols-1 gap-3 rounded-md border border-line p-3 sm:col-span-2 sm:grid-cols-3">
            <div><Label htmlFor="nv-name">{t("editOps.events.newVenueName")}</Label><Input id="nv-name" maxLength={120} value={newVenue.name} onChange={(e) => setNewVenue((s) => ({ ...s, name: e.target.value }))} /></div>
            <div><Label htmlFor="nv-addr">{t("editOps.events.address")}</Label><Input id="nv-addr" maxLength={200} value={newVenue.address} onChange={(e) => setNewVenue((s) => ({ ...s, address: e.target.value }))} /></div>
            <div><Label htmlFor="nv-city">{t("editOps.events.city")}</Label><Input id="nv-city" maxLength={100} value={newVenue.city} onChange={(e) => setNewVenue((s) => ({ ...s, city: e.target.value }))} /></div>
            <p className="text-xs text-ink-3 sm:col-span-3">{t("editOps.events.newVenueHint")}</p>
          </div>
        )}
        {place === OTHER && (
          <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-2">
            <div><Label htmlFor="e-locname">{t("editOps.events.locationName")}</Label><Input id="e-locname" maxLength={200} value={f.locationName} onChange={(e) => set("locationName", e.target.value)} placeholder={t("editOps.events.locationNamePlaceholder")} /></div>
            <div><Label htmlFor="e-loc">{t("editOps.events.address")}</Label><Input id="e-loc" maxLength={200} value={f.locationText} onChange={(e) => set("locationText", e.target.value)} placeholder={t("editOps.events.addressPlaceholder")} /></div>
          </div>
        )}
        {eventId ? (
          <div><Label htmlFor="e-status">{t("common.status")}</Label>
            <Select id="e-status" value={f.status} onChange={(e) => set("status", e.target.value as EventFormValues["status"])}>
              {(["scheduled", "postponed", "cancelled", "completed"] as const).map((s) => <option key={s} value={s}>{t(`editOps.events.statuses.${s}`)}</option>)}
            </Select></div>
        ) : (
          <div><Label htmlFor="e-rep">{t("editOps.events.repeatWeekly")}</Label>
            <Select id="e-rep" value={String(f.repeatWeeks)} onChange={(e) => set("repeatWeeks", Number(e.target.value))}>
              <option value="0">{t("editOps.events.doesNotRepeat")}</option>
              {[3, 7, 11, 15, 19, 39].map((n) => <option key={n} value={n}>{t("editOps.events.weeksTotal", { count: n + 1 })}</option>)}
            </Select></div>
        )}
      </div>
      <div><Label htmlFor="e-notes">{t("editOps.events.notes")}</Label><Textarea id="e-notes" maxLength={2000} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder={t("editOps.events.notesPlaceholder")} /></div>

      {eventId && seriesId && (
        <fieldset className="rounded-md border border-line p-3 text-sm">
          <legend className="px-1 text-xs text-ink-3">{t("editOps.events.applyTo")}</legend>
          <label className="mr-4 inline-flex items-center gap-2 text-ink-2"><input type="radio" name="scope" checked={scope === "one"} onChange={() => setScope("one")} className="accent-[var(--red-primary)]" /> {t("editOps.events.scopeOne")}</label>
          <label className="inline-flex items-center gap-2 text-ink-2"><input type="radio" name="scope" checked={scope === "following"} onChange={() => setScope("following")} className="accent-[var(--red-primary)]" /> {t("editOps.events.scopeFollowing")}</label>
        </fieldset>
      )}

      {warnings.length > 0 && (
        <div role="status" className="rounded-md border border-warning bg-warning-soft p-4 text-sm">
          <div className="flex items-center gap-2 font-medium text-warning"><AlertTriangle className="h-4 w-4" />
            {hardClash ? t("editOps.events.doubleBooking") : t("editOps.events.venueConflict", { venue: venue?.name ?? "" })}
          </div>
          <ul className="mt-2 space-y-1 text-ink-2">
            {warnings.slice(0, 8).map((w, i) => (
              <li key={`${w.eventId}-${i}`}>{w.label} — {fmt.dateTime(w.startsAt)}–{timeFmt(w.endsAt)}{w.spaceName ? ` · ${w.spaceName}` : ` · ${t("editOps.events.wholeVenue")}`}</li>
            ))}
            {warnings.length > 8 && <li>{t("editOps.events.andMore", { count: warnings.length - 8 })}</li>}
          </ul>
          {hardClash ? <p className="mt-2 text-xs text-ink-3">{t("editOps.events.pickAnotherSpace")}</p> : (
            <label className="mt-3 flex items-center gap-2 text-ink-2"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" /> {t("editOps.events.saveAnyway")}</label>
          )}
        </div>
      )}

      <FormError message={err} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || hardClash || (warnings.length > 0 && !confirmed)}>
          {pending ? t("common.saving") : eventId ? t("editOps.events.save") : f.repeatWeeks ? t("editOps.events.createMany", { count: f.repeatWeeks + 1 }) : t("editOps.events.create")}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => router.push(returnTo)}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}
