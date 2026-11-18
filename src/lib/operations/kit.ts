/**
 * Pure kit helpers (no I/O): jersey number uniqueness per team (kit that has
 * been returned frees its number), free-number suggestions and the kit
 * status flow. The database enforces the same rule with the partial unique
 * index kit_assignments_jersey_uniq.
 */
export const KIT_STATUSES = ["sizes_requested", "sizes_submitted", "ordered", "handed_out", "returned"] as const;
export type KitStatus = (typeof KIT_STATUSES)[number];

export type KitNumberRow = { id: string; teamId: string; athleteId: string; jerseyNumber: number | null; status: KitStatus };

const holdsNumber = (r: KitNumberRow) => r.jerseyNumber !== null && r.status !== "returned";

/** Jersey numbers used more than once in a team: "teamId:number" -> assignment ids. */
export function findJerseyConflicts(rows: KitNumberRow[]): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const r of rows) {
    if (!holdsNumber(r)) continue;
    const key = `${r.teamId}:${r.jerseyNumber}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r.id]);
  }
  return new Map([...byKey].filter(([, ids]) => ids.length > 1));
}

/** Can `number` be given to a player of `teamId` (ignoring assignment `excludeId`)? */
export function isJerseyNumberFree(rows: KitNumberRow[], teamId: string, number: number, excludeId: string | null = null): boolean {
  return !rows.some((r) => r.teamId === teamId && r.id !== excludeId && holdsNumber(r) && r.jerseyNumber === number);
}

/** The lowest `count` numbers in [min, max] still free in the team. */
export function suggestFreeNumbers(rows: KitNumberRow[], teamId: string, count = 5, min = 0, max = 99): number[] {
  const taken = new Set(rows.filter((r) => r.teamId === teamId && holdsNumber(r)).map((r) => r.jerseyNumber as number));
  const out: number[] = [];
  for (let n = min; n <= max && out.length < count; n++) if (!taken.has(n)) out.push(n);
  return out;
}

/** Sizes may still be changed by the family. */
export function sizesEditable(status: KitStatus): boolean {
  return status === "sizes_requested" || status === "sizes_submitted";
}

/** Counts per status for a summary row. */
export function kitStatusCounts(rows: { status: KitStatus }[]): Record<KitStatus, number> {
  const out = Object.fromEntries(KIT_STATUSES.map((s) => [s, 0])) as Record<KitStatus, number>;
  for (const r of rows) out[r.status] += 1;
  return out;
}
