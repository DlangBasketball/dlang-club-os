/**
 * Pure helpers (no I/O) for equipment stock and the operations reminders:
 * stock still on the shelf, overdue check-outs, sponsor renewal windows and
 * deliverables coming due.
 */
export type CheckoutLike = { id: string; itemId: string; quantity: number; dueOn: string | null; returnedAt: string | null };

/** Quantity of an item not currently checked out (never below zero). */
export function availableQuantity(total: number, checkouts: CheckoutLike[], itemId: string): number {
  const out = checkouts.filter((c) => c.itemId === itemId && !c.returnedAt).reduce((s, c) => s + c.quantity, 0);
  return Math.max(total - out, 0);
}

/** Open check-out whose due date has passed (due today is not overdue). */
export function isOverdue(c: Pick<CheckoutLike, "dueOn" | "returnedAt">, todayKey: string): boolean {
  return !c.returnedAt && !!c.dueOn && c.dueOn < todayKey;
}

export function overdueCheckouts<T extends CheckoutLike>(list: T[], todayKey: string): T[] {
  return list.filter((c) => isOverdue(c, todayKey)).sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? ""));
}

/** Whole days between two "YYYY-MM-DD" keys (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
}

/** A reminder is due when nothing was sent in the last `everyDays` days. */
export function reminderDue(lastSentAt: string | null, now: Date, everyDays = 3): boolean {
  return !lastSentAt || now.getTime() - Date.parse(lastSentAt) >= everyDays * 864e5;
}

/** Sponsor contract ending within its reminder window (and not yet past). */
export function sponsorRenewalDue(s: { status: string; contractEnd: string | null; reminderDays: number }, todayKey: string): boolean {
  if (s.status !== "active" || !s.contractEnd) return false;
  const left = daysBetween(todayKey, s.contractEnd);
  return left >= 0 && left <= s.reminderDays;
}
