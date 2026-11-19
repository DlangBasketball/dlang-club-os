import { zonedWallTimeToUtc } from "@/lib/format";

/**
 * Bookable training times, computed from real availability. Pure (no I/O):
 * used by the parent / admin wizards, the public booking page and the unit
 * tests. The database re-checks every booking with the same rules
 * (public.training_slot_window + training_check_slot), so this module only
 * decides what to SHOW.
 *
 * Rules
 *  - Weekly templates are wall-clock windows in the club's time zone (the
 *    org time zone, never the browser's); one-off windows are instants.
 *  - A slot starts every `stepMin` minutes from the window start and must
 *    end inside the window, inside the venue's opening hours, outside any
 *    blackout (club-wide, the coach's, or the venue's) and after now + lead.
 *  - Capacity = min(window capacity, service max participants). A coach with
 *    another overlapping session is busy; the same service at the same start
 *    is the same group, so it only counts towards the capacity.
 */

/** Opening hours: ISO weekday ("1" = Monday) -> [["10:00","18:00"], ...]. null = no bounds. */
export type OpeningHours = Record<string, [string, string][]> | null;

export type SlotService = {
  id: string;
  durationMin: number;
  maxParticipants: number;
  minParticipants: number;
  venueId: string | null;
};
export type SlotTemplate = {
  coachId: string;
  venueId: string | null;
  serviceId: string | null;
  weekday: number; // 1 = Monday ... 7 = Sunday
  startTime: string; // HH:MM
  endTime: string;
  capacity: number;
  validFrom?: string | null;
  validUntil?: string | null;
};
export type SlotWindow = { coachId: string; venueId: string | null; serviceId: string | null; startsAt: string; endsAt: string; capacity: number };
export type SlotBlackout = { coachId: string | null; venueId: string | null; startsAt: string; endsAt: string };
export type SlotBusy = { coachId: string; serviceId: string; start: string; end: string; booked: number };

export type GenerateInput = {
  timeZone: string;
  /** First local date (YYYY-MM-DD) in the club's time zone. */
  fromDate: string;
  days: number;
  service: SlotService;
  /** Coaches that offer the service (filtered by the caller). */
  coachIds: string[];
  templates: SlotTemplate[];
  windows: SlotWindow[];
  blackouts: SlotBlackout[];
  busy: SlotBusy[];
  venueHours: Record<string, OpeningHours>;
  stepMin: number;
  now: Date;
  leadMinutes?: number;
};

export type Slot = {
  coachId: string;
  start: string; // ISO (UTC)
  end: string;
  venueId: string | null;
  capacity: number;
  booked: number;
  spotsLeft: number;
};

const MIN = 60_000;

export function parseHm(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  return h * 60 + mi;
}

export function formatHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** YYYY-MM-DD plus n days (calendar arithmetic, time-zone free). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a calendar date. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Local calendar date + minutes since local midnight of an instant. */
export function localParts(ms: number, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}

/** Today's date in the club's time zone. */
export function localToday(now: Date, timeZone: string): string {
  return localParts(now.getTime(), timeZone).date;
}

/** Is [fromMin, toMin) (minutes since local midnight) inside the opening hours of that weekday? */
export function withinOpeningHours(hours: OpeningHours | undefined, weekday: number, fromMin: number, toMin: number): boolean {
  if (!hours || Object.keys(hours).length === 0) return true;
  const day = hours[String(weekday)];
  if (!Array.isArray(day)) return false;
  return day.some(([a, b]) => {
    const open = parseHm(a);
    const close = parseHm(b);
    return open !== null && close !== null && fromMin >= open && toMin <= close;
  });
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

export function generateSlots(input: GenerateInput): Slot[] {
  const { service, timeZone } = input;
  const dur = Math.max(5, Math.round(service.durationMin));
  const step = Math.max(5, Math.round(input.stepMin || dur));
  const earliest = input.now.getTime() + Math.max(0, input.leadMinutes ?? 0) * MIN;
  const coachSet = new Set(input.coachIds);
  const byKey = new Map<string, Slot>();

  const lastDate = addDays(input.fromDate, Math.max(1, input.days) - 1);
  const candidates: { coachId: string; startMs: number; venueId: string | null; capacity: number }[] = [];

  // Weekly templates, day by day in the club's time zone.
  for (let i = 0; i < Math.max(1, input.days); i++) {
    const date = addDays(input.fromDate, i);
    const wd = isoWeekday(date);
    for (const t of input.templates) {
      if (!coachSet.has(t.coachId) || t.weekday !== wd) continue;
      if (t.serviceId && t.serviceId !== service.id) continue;
      if (t.validFrom && date < t.validFrom) continue;
      if (t.validUntil && date > t.validUntil) continue;
      const a = parseHm(t.startTime);
      const b = parseHm(t.endTime);
      if (a === null || b === null) continue;
      for (let s = a; s + dur <= b; s += step) {
        const start = zonedWallTimeToUtc(date, formatHm(s), timeZone);
        if (start) candidates.push({ coachId: t.coachId, startMs: start.getTime(), venueId: t.venueId, capacity: t.capacity });
      }
    }
  }

  // One-off windows (instants), clipped to the requested local date range.
  for (const w of input.windows) {
    if (!coachSet.has(w.coachId)) continue;
    if (w.serviceId && w.serviceId !== service.id) continue;
    const a = Date.parse(w.startsAt);
    const b = Date.parse(w.endsAt);
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    for (let s = a; s + dur * MIN <= b; s += step * MIN) {
      const d = localParts(s, timeZone).date;
      if (d < input.fromDate || d > lastDate) continue;
      candidates.push({ coachId: w.coachId, startMs: s, venueId: w.venueId, capacity: w.capacity });
    }
  }

  for (const c of candidates) {
    const startMs = c.startMs;
    const endMs = startMs + dur * MIN;
    if (startMs < earliest) continue;
    const venueId = c.venueId ?? service.venueId;

    // Opening hours (local wall clock of the slot's day).
    const lp = localParts(startMs, timeZone);
    if (!withinOpeningHours(venueId ? input.venueHours[venueId] : null, isoWeekday(lp.date), lp.minutes, lp.minutes + dur)) continue;

    // Blackouts: club-wide, this coach, or this venue.
    const blocked = input.blackouts.some((b) => {
      if (b.coachId && b.coachId !== c.coachId) return false;
      if (b.venueId && b.venueId !== venueId) return false;
      return overlaps(startMs, endMs, Date.parse(b.startsAt), Date.parse(b.endsAt));
    });
    if (blocked) continue;

    // Coach busy with another session; same group counts towards capacity.
    let booked = 0;
    let busy = false;
    for (const x of input.busy) {
      if (x.coachId !== c.coachId) continue;
      const xs = Date.parse(x.start);
      const xe = Date.parse(x.end);
      if (!overlaps(startMs, endMs, xs, xe)) continue;
      if (x.serviceId === service.id && xs === startMs) booked += x.booked;
      else busy = true;
    }
    if (busy) continue;

    const capacity = Math.max(1, Math.min(c.capacity, service.maxParticipants));
    const key = `${c.coachId}|${startMs}`;
    const prev = byKey.get(key);
    if (prev && prev.capacity >= capacity) continue;
    byKey.set(key, {
      coachId: c.coachId,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      venueId,
      capacity,
      booked,
      spotsLeft: capacity - booked,
    });
  }

  return Array.from(byKey.values())
    .filter((s) => s.spotsLeft > 0)
    .sort((a, b) => a.start.localeCompare(b.start) || a.coachId.localeCompare(b.coachId));
}

/**
 * "Any coach": one slot per start time. Prefers a group that already has
 * participants (fills groups before opening new ones), then most spots left.
 */
export function mergeAnyCoach(slots: Slot[]): Slot[] {
  const best = new Map<string, Slot>();
  for (const s of slots) {
    const cur = best.get(s.start);
    if (!cur) { best.set(s.start, s); continue; }
    const better = (s.booked > 0 && cur.booked === 0) || ((s.booked > 0) === (cur.booked > 0) && s.spotsLeft > cur.spotsLeft);
    if (better) best.set(s.start, s);
  }
  return Array.from(best.values()).sort((a, b) => a.start.localeCompare(b.start));
}

/** Participants still missing before a group slot is confirmed (0 = confirmed / individual). */
export function participantsNeeded(minParticipants: number, booked: number): number {
  return Math.max(0, minParticipants - booked);
}

/** Groups slots by local date for display. */
export function groupByLocalDate(slots: Slot[], timeZone: string): { date: string; slots: Slot[] }[] {
  const out = new Map<string, Slot[]>();
  for (const s of slots) {
    const d = localParts(Date.parse(s.start), timeZone).date;
    const list = out.get(d) ?? [];
    list.push(s);
    out.set(d, list);
  }
  return Array.from(out.entries()).map(([date, list]) => ({ date, slots: list }));
}
