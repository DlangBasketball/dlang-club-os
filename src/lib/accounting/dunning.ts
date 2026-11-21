/**
 * Dunning schedule. Pure; mirrors public.dunning_next_level (the database run
 * is authoritative). Levels:
 *   1  friendly reminder          `level1Days` after the due date
 *   2  second reminder (+ fee)     `level2Days`
 *   3  final notice (+ fee, warning) `level3Days`
 *   4  handed to collection (flag + export only) `collectionDays`, only after level 3
 * One step per run: an invoice that is 90 days late and never reminded gets
 * reminder 1 today, reminder 2 on the next run, and so on, so a family always
 * receives the friendly reminder first.
 */
export type DunningSettings = {
  enabled: boolean;
  level1Days: number;
  level2Days: number;
  level2Fee: number;
  level3Days: number;
  level3Fee: number;
  collectionDays: number;
  minBalance: number;
};

export const DEFAULT_DUNNING: DunningSettings = {
  enabled: false, level1Days: 10, level2Days: 30, level2Fee: 0, level3Days: 50, level3Fee: 0, collectionDays: 80, minBalance: 0,
};

export type DunningLevel = 1 | 2 | 3 | 4;

export function targetLevel(s: DunningSettings, daysOverdue: number, currentLevel: number): number {
  if (daysOverdue >= s.collectionDays && currentLevel >= 3) return 4;
  if (daysOverdue >= s.level3Days) return 3;
  if (daysOverdue >= s.level2Days) return 2;
  if (daysOverdue >= s.level1Days) return 1;
  return 0;
}

/** Level to send now, or null. */
export function nextDunningLevel(s: DunningSettings, daysOverdue: number, currentLevel: number): DunningLevel | null {
  const cur = Math.max(0, currentLevel);
  const next = Math.min(cur + 1, targetLevel(s, daysOverdue, cur));
  return next > cur ? (next as DunningLevel) : null;
}

/** Invoice states dunning never touches (mirrors public.dunning_run). */
export const NOT_DUNNED_STATUSES = ["draft", "paid", "cancelled", "void", "written_off", "refunded"] as const;

export type DunnableInvoice = {
  status: string;
  /** Original total. */
  total: number;
  /** Signed sum of active adjustment documents (credit notes negative: sponsorship, family support...). */
  adjustments: number;
  /** Net paid so far. */
  paid: number;
  remindersPaused?: boolean;
};

/**
 * Balance dunning may chase: amount due (total + adjustments) minus what was
 * paid, 0 for settled / cancelled invoices. A sponsored share is a credit note
 * (or the invoice is settled / cancelled), so it is never chased.
 */
export function dunnableBalance(inv: DunnableInvoice): number {
  if ((NOT_DUNNED_STATUSES as readonly string[]).includes(inv.status)) return 0;
  const cents = Math.round((inv.total + inv.adjustments - inv.paid) * 100);
  return cents > 0 ? cents / 100 : 0;
}

/** Level to send for one invoice now, or null (paused, nothing to chase, too early). Mirrors public.dunning_run. */
export function dunningLevelFor(s: DunningSettings, inv: DunnableInvoice, daysOverdue: number, currentLevel: number): DunningLevel | null {
  if (!s.enabled || inv.remindersPaused) return null;
  const balance = dunnableBalance(inv);
  if (balance <= Math.max(s.minBalance, 0)) return null;
  return nextDunningLevel(s, daysOverdue, currentLevel);
}

export function dunningFee(s: DunningSettings, level: number): number {
  return level === 2 ? s.level2Fee : level === 3 ? s.level3Fee : 0;
}

/** Settings are consistent (strictly increasing thresholds, fees within bounds). */
export function validDunningSettings(s: DunningSettings): boolean {
  const ints = [s.level1Days, s.level2Days, s.level3Days, s.collectionDays];
  return ints.every((n) => Number.isInteger(n) && n >= 1 && n <= 730)
    && s.level1Days < s.level2Days && s.level2Days < s.level3Days && s.level3Days < s.collectionDays
    && s.level3Days <= 365 && [s.level2Fee, s.level3Fee].every((f) => f >= 0 && f <= 10000)
    && s.minBalance >= 0 && s.minBalance <= 100000;
}

/** Calendar date of each step for a due date (preview in the settings screen). */
export function dunningDates(s: DunningSettings, dueDate: string): { level: DunningLevel; date: string; fee: number }[] {
  const add = (d: string, n: number) => {
    const t = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)) + n);
    return new Date(t).toISOString().slice(0, 10);
  };
  return [
    { level: 1, date: add(dueDate, s.level1Days), fee: 0 },
    { level: 2, date: add(dueDate, s.level2Days), fee: s.level2Fee },
    { level: 3, date: add(dueDate, s.level3Days), fee: s.level3Fee },
    { level: 4, date: add(dueDate, s.collectionDays), fee: 0 },
  ];
}
