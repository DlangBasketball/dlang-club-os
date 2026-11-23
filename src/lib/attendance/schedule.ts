/**
 * Recurring trainings: the weekly occurrences of a new series, limited by the
 * season's training window and the club's training breaks (pure, no I/O;
 * the database trigger events_training_window_guard enforces the same rules).
 */
export type DateRange = { startsOn: string; endsOn: string };

export type SeriesPlanInput = {
  startsAt: string;
  endsAt: string;
  /** Extra weekly occurrences (0 = one event). Ignored when repeatUntil is set. */
  repeatWeeks: number;
  /** Last date (club time zone, YYYY-MM-DD) an occurrence may fall on. */
  repeatUntil?: string | null;
  /** Training window of the team's season (either bound may be open). */
  window?: { startsOn: string | null; endsOn: string | null } | null;
  breaks?: DateRange[];
  timeZone: string;
  /** Apply window / breaks (trainings only). */
  applyRules: boolean;
  /** Hard cap on generated weeks. */
  maxWeeks?: number;
};

export type SkippedOccurrence = { date: string; reason: "outside_window" | "break" };
export type SeriesPlan = { occurrences: { startsAt: string; endsAt: string }[]; skipped: SkippedOccurrence[] };

const WEEK_MS = 7 * 864e5;

/** YYYY-MM-DD of an instant on the wall clock of `timeZone`. */
export function localDay(iso: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function inRanges(day: string, ranges: DateRange[] | undefined): boolean {
  return (ranges ?? []).some((r) => day >= r.startsOn && day <= r.endsOn);
}

export function planWeeklySeries(input: SeriesPlanInput): SeriesPlan {
  const start = Date.parse(input.startsAt);
  const dur = Date.parse(input.endsAt) - start;
  const maxWeeks = Math.min(input.maxWeeks ?? 52, 104);
  const until = input.repeatUntil ?? null;
  const ws = input.applyRules ? input.window?.startsOn ?? null : null;
  const we = input.applyRules ? input.window?.endsOn ?? null : null;
  const weeks = until ? maxWeeks : Math.min(Math.max(0, input.repeatWeeks), maxWeeks);
  const out: SeriesPlan = { occurrences: [], skipped: [] };
  for (let w = 0; w <= weeks; w++) {
    const s = new Date(start + w * WEEK_MS);
    const day = localDay(s, input.timeZone);
    if (until && day > until) break;
    if (we && day > we) {
      // Every later week is past the window too: report the first and stop.
      out.skipped.push({ date: day, reason: "outside_window" });
      break;
    }
    if (ws && day < ws) { out.skipped.push({ date: day, reason: "outside_window" }); continue; }
    if (input.applyRules && inRanges(day, input.breaks)) { out.skipped.push({ date: day, reason: "break" }); continue; }
    out.occurrences.push({ startsAt: s.toISOString(), endsAt: new Date(s.getTime() + dur).toISOString() });
  }
  return out;
}
