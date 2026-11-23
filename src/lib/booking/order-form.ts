import { slotInstant, emptyQuickAthlete, type PayerChoice, type QuickAthleteFields } from "./admin-form";
import { normalizeDateRows, type DateRow, type OrderOption, type OrderPayloadInput } from "./orders";

/*
 * Admin "New booking" (orders) — pure form state helpers (client + server
 * safe). Covered by tests/unit/booking-orders.test.ts.
 *  - Players keep their own Bill To and date subset ("all" = every order date).
 *  - Draft kept in sessionStorage (per club), restored on return, cleared on confirm.
 *  - Payload: wall-clock dates in the club time zone -> UTC instants.
 */
export type DateMode = "one" | "multi" | "recurring";
export type PlayerRow = { athleteId: string; label: string; familyId: string; payer: PayerChoice; dates: "all" | string[] };

export type OrderFormState = {
  serviceId: string;
  option: OrderOption | "";
  packageId: string;
  purchaseId: string;
  priceOverride: boolean; agreed: string; priceReason: string;
  coachId: string; venueSpaceId: string;
  dateMode: DateMode;
  rows: DateRow[];
  time: string;
  rec: { from: string; until: string; count: string; end: "until" | "count"; weekdays: number[] };
  players: PlayerRow[];
  receivedOn: string; description: string; internalNotes: string; notify: boolean;
  overrideAvailability: boolean; overrideReason: string;
  quickOpen: boolean; quick: QuickAthleteFields;
};

export function emptyOrderForm(init: Partial<OrderFormState> = {}): OrderFormState {
  const today = init.receivedOn ?? "";
  return {
    serviceId: "", option: "", packageId: "", purchaseId: "", priceOverride: false, agreed: "", priceReason: "",
    coachId: "", venueSpaceId: "", dateMode: "one", rows: [{ key: "r0", date: today, time: "" }], time: "",
    rec: { from: today, until: "", count: "4", end: "count", weekdays: [] }, players: [],
    receivedOn: today, description: "", internalNotes: "", notify: true, overrideAvailability: false, overrideReason: "",
    quickOpen: false, quick: emptyQuickAthlete(), ...init,
  };
}

/** A new service resets what depended on the old one (option, package, coach eligibility, price override). */
export function withOrderService(s: OrderFormState, serviceId: string, d: { kind: string; coachIds: string[]; venueSpaceId: string | null }): OrderFormState {
  if (s.serviceId === serviceId) return s;
  const coachId = d.coachIds.includes(s.coachId) ? s.coachId : d.coachIds.length === 1 ? d.coachIds[0] : "";
  const group = d.kind === "group";
  return {
    ...s, serviceId, coachId, venueSpaceId: d.venueSpaceId ?? s.venueSpaceId,
    option: group ? "group" : "", packageId: "", purchaseId: "", priceOverride: false, agreed: "", priceReason: "",
    // A private order has one athlete: keep the first one.
    players: group ? s.players : s.players.slice(0, 1).map((p) => ({ ...p, dates: "all" })),
  };
}

/** Add a player (no duplicates). Private orders: the athlete replaces the previous one. */
export function addPlayer(s: OrderFormState, p: { athleteId: string; label: string; familyId: string }, group: boolean): OrderFormState {
  if (s.players.some((x) => x.athleteId === p.athleteId)) return s;
  const row: PlayerRow = { ...p, payer: { type: "family" }, dates: "all" };
  return { ...s, players: group ? [...s.players, row] : [row], purchaseId: group ? s.purchaseId : "" };
}

export function removePlayer(s: OrderFormState, athleteId: string): OrderFormState {
  return { ...s, players: s.players.filter((x) => x.athleteId !== athleteId) };
}

/** Toggle one date of a player ("all" becomes an explicit subset). */
export function togglePlayerDate(s: OrderFormState, athleteId: string, rowKey: string, allKeys: string[]): OrderFormState {
  return {
    ...s,
    players: s.players.map((p) => {
      if (p.athleteId !== athleteId) return p;
      const cur = p.dates === "all" ? allKeys : p.dates;
      const next = cur.includes(rowKey) ? cur.filter((k) => k !== rowKey) : [...cur, rowKey];
      return { ...p, dates: next.length === allKeys.length && allKeys.every((k) => next.includes(k)) ? "all" : next };
    }),
  };
}

/** The date keys a player attends (subset of the order rows). */
export function playerDateKeys(p: PlayerRow, rows: DateRow[]): string[] {
  const keys = rows.map((r) => r.key);
  return p.dates === "all" ? keys : p.dates.filter((k) => keys.includes(k));
}

/** Rows with a date and a time, sorted, the first of two identical slots kept (row keys unchanged). */
export function completeRows(rows: DateRow[]): DateRow[] {
  const slots = new Set(normalizeDateRows(rows).map((r) => r.key));
  const seen = new Set<string>();
  return [...rows]
    .filter((r) => slots.has(`${r.date}T${r.time}`))
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))
    .filter((r) => { const k = `${r.date}T${r.time}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Quote / confirm payload of the form; payer ids resolved by the caller (null = family default). */
export function orderFormToPayload(s: OrderFormState, timeZone: string, payerIds: Map<string, string | null>): OrderPayloadInput | null {
  if (!s.serviceId || !s.option || s.players.length === 0) return null;
  const rows = completeRows(s.rows);
  const iso = new Map<string, string>();
  for (const r of rows) {
    const v = slotInstant(r.date, r.time, timeZone);
    if (v) iso.set(r.key, v);
  }
  const dates = rows.map((r) => iso.get(r.key)).filter((v): v is string => Boolean(v));
  const agreed = s.priceOverride && s.agreed.trim() !== "" ? Number(s.agreed) : null;
  return {
    serviceId: s.serviceId, option: s.option,
    packageId: s.option === "package" ? s.packageId || null : null,
    purchaseId: s.option === "existing_package" ? s.purchaseId || null : null,
    agreedTotal: s.option === "single" || s.option === "package" ? (agreed !== null && Number.isFinite(agreed) ? agreed : null) : null,
    agreedRate: s.option === "group" ? (agreed !== null && Number.isFinite(agreed) ? agreed : null) : null,
    priceReason: agreed !== null ? s.priceReason || null : null,
    coachId: s.coachId || null, venueSpaceId: s.venueSpaceId || null, dates,
    participants: s.players.map((p) => ({
      athleteId: p.athleteId, payerId: payerIds.get(p.athleteId) ?? null,
      dates: p.dates === "all" ? null : p.dates.map((k) => iso.get(k)).filter((v): v is string => Boolean(v)),
    })),
    description: s.description || null, internalNotes: s.internalNotes || null, receivedOn: s.receivedOn || null,
    overrideAvailability: s.overrideAvailability, overrideReason: s.overrideAvailability ? s.overrideReason || null : null,
    notify: s.notify,
  };
}

// ---------------------------------------------------------------------------
// Draft (sessionStorage)
// ---------------------------------------------------------------------------
export const ORDER_DRAFT_KEY = "clubos.adminOrder.draft";
const VERSION = 1;
const MAX_AGE_MS = 12 * 3_600_000;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function saveOrderDraft(storage: StorageLike | null | undefined, scope: string, state: OrderFormState, now = Date.now()): void {
  if (!storage) return;
  try { storage.setItem(ORDER_DRAFT_KEY, JSON.stringify({ v: VERSION, savedAt: now, scope, state })); } catch { /* storage blocked */ }
}

export function loadOrderDraft(storage: StorageLike | null | undefined, scope: string, now = Date.now()): OrderFormState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ORDER_DRAFT_KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as { v?: number; savedAt?: number; scope?: string; state?: Partial<OrderFormState> };
    if (env.v !== VERSION || env.scope !== scope || typeof env.savedAt !== "number" || !env.state) return null;
    if (now - env.savedAt > MAX_AGE_MS) { storage.removeItem(ORDER_DRAFT_KEY); return null; }
    const base = emptyOrderForm();
    return {
      ...base, ...env.state,
      rec: { ...base.rec, ...(env.state.rec ?? {}) },
      quick: { ...base.quick, ...(env.state.quick ?? {}) },
      rows: Array.isArray(env.state.rows) ? env.state.rows : base.rows,
      players: Array.isArray(env.state.players) ? env.state.players : [],
    };
  } catch {
    return null;
  }
}

export function clearOrderDraft(storage: StorageLike | null | undefined): void {
  try { storage?.removeItem(ORDER_DRAFT_KEY); } catch { /* ignore */ }
}

export function isOrderDirty(s: OrderFormState): boolean {
  return Boolean(s.serviceId || s.players.length || s.description || s.internalNotes || s.quickOpen || s.rows.some((r) => r.time));
}
