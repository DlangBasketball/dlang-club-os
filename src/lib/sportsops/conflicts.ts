/**
 * Pure overlap detection for a list of events (used by the week/list views
 * to flag "two teams booked the same arena at 16:00"). Mirrors the SQL rule
 * in public.event_conflicts(): same venue, overlapping [start, end), and
 * either the same space or one of them booked the whole venue.
 */
export type ConflictInput = {
  id: string;
  venueId: string | null;
  spaceId: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
};

const LIVE = new Set(["scheduled", "postponed"]);

export function overlaps(a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }) {
  return Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);
}

export function clashes(a: ConflictInput, b: ConflictInput) {
  if (a.id === b.id || !a.venueId || a.venueId !== b.venueId) return false;
  if (!LIVE.has(a.status) || !LIVE.has(b.status)) return false;
  if (a.spaceId && b.spaceId && a.spaceId !== b.spaceId) return false;
  return overlaps(a, b);
}

/** Map of event id -> ids of events it clashes with. O(n log n + k). */
export function findConflicts(events: ConflictInput[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const byVenue = new Map<string, ConflictInput[]>();
  for (const e of events) {
    if (!e.venueId || !LIVE.has(e.status)) continue;
    const list = byVenue.get(e.venueId) ?? [];
    list.push(e);
    byVenue.set(e.venueId, list);
  }
  for (const list of byVenue.values()) {
    list.sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt));
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length && Date.parse(list[j].startsAt) < Date.parse(a.endsAt); j++) {
        const b = list[j];
        if (!clashes(a, b)) continue;
        out.set(a.id, [...(out.get(a.id) ?? []), b.id]);
        out.set(b.id, [...(out.get(b.id) ?? []), a.id]);
      }
    }
  }
  return out;
}
