import { periodRange, shiftPeriod, type PeriodKind } from "./hours";

/** Parse ?period=week|month&from=YYYY-MM-DD into a normalised period. */
export function parsePeriod(sp: { period?: string; from?: string }, today: string): { kind: PeriodKind; from: string; to: string; prev: string; next: string } {
  const kind: PeriodKind = sp.period === "month" ? "month" : "week";
  const anchor = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) && !Number.isNaN(Date.parse(sp.from)) ? sp.from : today;
  const { from, to } = periodRange(kind, anchor);
  return { kind, from, to, prev: shiftPeriod(kind, from, -1).from, next: shiftPeriod(kind, from, 1).from };
}
