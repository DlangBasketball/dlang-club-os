/**
 * Self-filling waiting lists — pure rules mirroring public.waitlist_process()
 * / waitlist_respond() (migration 20250420101500_club_admin.sql). The
 * database is authoritative; this model drives the UI wording and the unit
 * tests of the offer chain (free spots -> offers in order, decline / expiry
 * -> next person).
 */
export type WaitlistStatus = "waiting" | "offered" | "accepted" | "declined" | "expired" | "skipped" | "removed";
export type WaitlistKind = "program" | "camp_edition" | "training_slot";
export const WAITLIST_STATUSES: WaitlistStatus[] = ["waiting", "offered", "accepted", "declined", "expired", "skipped", "removed"];
export const OPEN_STATUSES: WaitlistStatus[] = ["waiting", "offered"];

export type Entry = {
  id: string;
  position: number;
  createdAt: string; // ISO timestamp
  status: WaitlistStatus;
  offerExpiresAt?: string | null; // ISO timestamp
};

export type Spots = { capacity: number | null; taken: number };

export const DEFAULT_OFFER_HOURS = 48;

export function offerExpiry(now: Date, hours: number): Date {
  return new Date(now.getTime() + Math.max(1, Math.trunc(hours)) * 3_600_000);
}

export function isOfferOpen(e: Entry, now: Date): boolean {
  return e.status === "offered" && !!e.offerExpiresAt && new Date(e.offerExpiresAt).getTime() > now.getTime();
}

/** Open entries in list order (position, then join time). */
export function ordered<T extends Entry>(entries: T[]): T[] {
  return entries
    .filter((e) => e.status === "waiting" || e.status === "offered")
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

/** 1-based place in the queue of the waiting entries (offered ones excluded), or null. */
export function placeInLine(entries: Entry[], id: string): number | null {
  const q = ordered(entries).filter((e) => e.status === "waiting");
  const i = q.findIndex((e) => e.id === id);
  return i < 0 ? null : i + 1;
}

/**
 * One processing run: expire overdue offers, then offer every free spot to
 * the next waiting entries. Returns the new list state and the ids offered.
 */
export function processList<T extends Entry>(
  entries: T[],
  spots: Spots,
  now: Date,
  hours: number = DEFAULT_OFFER_HOURS,
): { entries: T[]; offered: string[]; expired: string[] } {
  const expired: string[] = [];
  let next = entries.map((e) => {
    if (e.status === "offered" && !isOfferOpen(e, now)) {
      expired.push(e.id);
      return { ...e, status: "expired" as WaitlistStatus };
    }
    return e;
  });
  const held = next.filter((e) => isOfferOpen(e, now)).length;
  let free = spots.capacity == null ? Number.POSITIVE_INFINITY : spots.capacity - spots.taken - held;
  const offered: string[] = [];
  const queue = ordered(next).filter((e) => e.status === "waiting");
  for (const e of queue) {
    if (free <= 0) break;
    offered.push(e.id);
    free -= 1;
  }
  const until = offerExpiry(now, hours).toISOString();
  next = next.map((e) => (offered.includes(e.id) ? { ...e, status: "offered" as WaitlistStatus, offerExpiresAt: until } : e));
  return { entries: next, offered, expired };
}

/** The response to an offer; accepted offers take the spot (taken + 1). */
export function respond<T extends Entry>(
  entries: T[],
  id: string,
  accept: boolean,
  now: Date,
): { entries: T[]; result: "accepted" | "declined" | "expired" | "not_open" } {
  const e = entries.find((x) => x.id === id);
  if (!e || e.status !== "offered") return { entries, result: "not_open" };
  if (!isOfferOpen(e, now)) {
    return { entries: entries.map((x) => (x.id === id ? { ...x, status: "expired" as WaitlistStatus } : x)), result: "expired" };
  }
  const status: WaitlistStatus = accept ? "accepted" : "declined";
  return { entries: entries.map((x) => (x.id === id ? { ...x, status } : x)), result: status };
}

/** Move an entry to a 1-based position among the open entries; returns new positions. */
export function moveTo<T extends Entry>(entries: T[], id: string, position: number): T[] {
  const open = ordered(entries);
  const me = open.find((e) => e.id === id);
  if (!me) return entries;
  const rest = open.filter((e) => e.id !== id);
  const p = Math.min(Math.max(1, Math.trunc(position)), rest.length + 1);
  rest.splice(p - 1, 0, me);
  const pos = new Map(rest.map((e, i) => [e.id, i + 1]));
  return entries.map((e) => (pos.has(e.id) ? { ...e, position: pos.get(e.id)! } : e));
}

/** Badge tone per status. */
export function waitlistTone(s: WaitlistStatus): "info" | "warning" | "success" | "neutral" | "danger" {
  switch (s) {
    case "waiting": return "info";
    case "offered": return "warning";
    case "accepted": return "success";
    case "expired":
    case "declined": return "danger";
    default: return "neutral";
  }
}

/** Hours left on an offer (rounded down, never negative). */
export function hoursLeft(expiresAt: string | null | undefined, now: Date): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 3_600_000));
}
