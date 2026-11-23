import { z } from "zod";
import type { BookingStatus, BillingStatus, BookingWarning, PayerSnapshot, ServiceKind, SetupMissingCode } from "./types";

/*
 * Booking orders — shared contract (client + server safe, no I/O).
 * Schema: supabase/migrations/20250420104800_booking_orders.sql.
 * Contract: docs/booking-workflow.md §13.
 *
 * An order = one service, one pricing option, 1..N dates, 1..N players.
 * The pure helpers below mirror the SQL rules so the form can show the
 * charges and the dates before the server confirms (the server decides):
 *   - pricing options of a service ("1 Session" + packages, totals),
 *   - the per-player charge (single / package = the agreed total once,
 *     an existing package = 0, group = rate x the player's dates),
 *   - recurrence expansion (weekly on weekdays, until a date or a count).
 */

export const ORDER_OPTIONS = ["single", "package", "existing_package", "group"] as const;
export type OrderOption = (typeof ORDER_OPTIONS)[number];
export type OrderKind = "single" | "package" | "group";
/** Only per player per session is implemented (charge = rate x sessions booked by the player). */
export const PRICING_BASES = ["per_player_per_session"] as const;
export type PricingBasis = (typeof PRICING_BASES)[number];

/** Max dates / players of one order (= SQL limits). */
export const MAX_ORDER_DATES = 60;
export const MAX_ORDER_PLAYERS = 30;

/** Error codes of the order RPCs: listed in BOOKING_ERROR_CODES (./types), translated as bookingWorkflow.errors.<CODE>. */

// ---------------------------------------------------------------------------
// Pricing options
// ---------------------------------------------------------------------------
export type PricingOption = {
  option_id: string; kind: "single" | "package"; sessions: number; total: number;
  package_id: string | null; name: string | null; validity_days: number | null;
};

/** Label parts of an option: the session count (for "N Session(s)") and the total. */
export function optionParts(o: Pick<PricingOption, "sessions" | "total">): { sessions: number; total: number } {
  return { sessions: o.sessions, total: Number(o.total) };
}

/**
 * Price tag for pricing options. Swiss francs use the Swiss convention in every UI
 * language ("CHF 1’280.00": typographic apostrophe as thousands separator), so the
 * catalogue reads the same for all staff; other currencies use the viewer's formatter.
 */
export function priceTag(n: number, currency: string, fallback: (n: number) => string): string {
  if (currency.toUpperCase() !== "CHF" || !Number.isFinite(n)) return fallback(n);
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "\u2019");
  return `${n < 0 ? "-" : ""}CHF ${grouped}.${dec}`;
}

/** "1 Session — CHF 95.00": `sessionsLabel(n)` gives the translated "N Session(s)", `money` formats the total. */
export function optionLabel(o: Pick<PricingOption, "sessions" | "total">, sessionsLabel: (n: number) => string, money: (n: number) => string): string {
  return `${sessionsLabel(o.sessions)} — ${money(Number(o.total))}`;
}

/** Which option kinds a service offers: group -> group rate; package-only -> packages; else single + packages. */
export function offeredOptions(kind: ServiceKind): OrderOption[] {
  if (kind === "group") return ["group"];
  if (kind === "package") return ["package", "existing_package"];
  return ["single", "package", "existing_package"];
}

// ---------------------------------------------------------------------------
// Charges (mirror of bko_plan)
// ---------------------------------------------------------------------------
export type PreviewPlayer = { athleteId: string; payerKey: string; payerName?: string | null; dates: string[] };
export type PreviewInput = {
  option: OrderOption;
  /** Agreed total of the single / package option (per athlete). */
  agreedTotal?: number | null;
  /** Agreed rate of a group (per player per session). */
  rate?: number | null;
  players: PreviewPlayer[];
  /** Decimal places of the currency (CHF 2). */
  exponent?: number;
};
export type PreviewResult = {
  players: { athleteId: string; sessions: number; charge: number }[];
  payers: { payerKey: string; payerName: string | null; charge: number; athletes: number }[];
  sessions: number;
  total: number;
};

const roundTo = (n: number, exp: number) => {
  const f = 10 ** exp;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Per-player and per-payer charges of an order, recomputed on every change of the form. */
export function orderPricingPreview(input: PreviewInput): PreviewResult {
  const exp = input.exponent ?? 2;
  const players = input.players.map((p) => {
    const sessions = new Set(p.dates).size;
    let charge = 0;
    if (input.option === "group") charge = roundTo((input.rate ?? 0) * sessions, exp);
    else if (input.option === "single" || input.option === "package") charge = roundTo(input.agreedTotal ?? 0, exp);
    return { athleteId: p.athleteId, sessions, charge };
  });
  const byPayer = new Map<string, { payerKey: string; payerName: string | null; charge: number; athletes: number }>();
  input.players.forEach((p, i) => {
    const cur = byPayer.get(p.payerKey) ?? { payerKey: p.payerKey, payerName: p.payerName ?? null, charge: 0, athletes: 0 };
    cur.charge = roundTo(cur.charge + players[i].charge, exp);
    cur.athletes += 1;
    byPayer.set(p.payerKey, cur);
  });
  return {
    players,
    payers: [...byPayer.values()],
    sessions: players.reduce((n, p) => n + p.sessions, 0),
    total: roundTo(players.reduce((n, p) => n + p.charge, 0), exp),
  };
}

/** Is the agreed price different from the catalogue (needs a reason)? */
export function isPriceOverride(agreed: number | null | undefined, list: number | null | undefined): boolean {
  if (agreed === null || agreed === undefined || Number.isNaN(agreed)) return false;
  if (list === null || list === undefined) return true;
  return Math.abs(agreed - list) > 1e-9;
}

// ---------------------------------------------------------------------------
// Dates and recurrence (date keys YYYY-MM-DD in the club time zone)
// ---------------------------------------------------------------------------
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{1,2}:\d{2}$/;

export type DateRow = { key: string; date: string; time: string };
export type Recurrence = {
  /** First day (inclusive). */
  from: string;
  /** ISO weekdays 1 (Monday) .. 7 (Sunday). */
  weekdays: number[];
  /** Last day (inclusive) — or a count of dates. */
  until?: string | null;
  count?: number | null;
  time: string;
};

/** ISO weekday of a date key (1 = Monday .. 7 = Sunday). */
export function isoWeekday(key: string): number {
  const d = new Date(`${key}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Expand a weekly rule into date rows: every chosen weekday from `from`,
 * until the `until` day (inclusive) or until `count` dates; at most
 * MAX_ORDER_DATES. Invalid input gives no rows.
 */
export function expandRecurrence(r: Recurrence, max = MAX_ORDER_DATES): DateRow[] {
  if (!DAY.test(r.from) || !TIME.test(r.time)) return [];
  const days = [...new Set(r.weekdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))];
  if (days.length === 0) return [];
  const until = r.until && DAY.test(r.until) ? r.until : null;
  const count = r.count && Number.isFinite(r.count) && r.count > 0 ? Math.floor(r.count) : null;
  if (!until && !count) return [];
  if (until && until < r.from) return [];
  const limit = Math.min(max, count ?? max);
  const out: DateRow[] = [];
  // Hard stop: two years of days, whatever the rule says.
  for (let i = 0, key = r.from; i < 731 && out.length < limit; i += 1, key = addDays(key, 1)) {
    if (until && key > until) break;
    if (days.includes(isoWeekday(key))) out.push({ key: `${key}T${r.time}`, date: key, time: r.time });
  }
  return out;
}

/** Sorted rows without duplicates (same date + time) or incomplete rows. */
export function normalizeDateRows(rows: DateRow[]): DateRow[] {
  const seen = new Set<string>();
  const out: DateRow[] = [];
  for (const r of [...rows].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))) {
    if (!DAY.test(r.date) || !TIME.test(r.time)) continue;
    const k = `${r.date}T${r.time}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...r, key: k });
  }
  return out;
}

/** Duplicate rows (same date and time) — flagged in the form before the server refuses them. */
export function duplicateDateKeys(rows: DateRow[]): Set<string> {
  const count = new Map<string, number>();
  for (const r of rows) count.set(`${r.date}T${r.time}`, (count.get(`${r.date}T${r.time}`) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
}

// ---------------------------------------------------------------------------
// Payload schemas (server actions validate with these; the RPCs re-check)
// ---------------------------------------------------------------------------
const uuid = z.string().uuid();
const optUuid = uuid.nullish();
const isoInstant = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid_time");
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const money = z.coerce.number().finite().min(0).max(1_000_000);

export const orderPayloadSchema = z.object({
  serviceId: uuid,
  option: z.enum(ORDER_OPTIONS),
  packageId: optUuid,
  purchaseId: optUuid,
  agreedTotal: money.nullish(),
  agreedRate: money.nullish(),
  priceReason: optText(500),
  coachId: optUuid,
  venueSpaceId: optUuid,
  dates: z.array(isoInstant).max(MAX_ORDER_DATES),
  participants: z.array(z.object({
    athleteId: uuid,
    payerId: optUuid,
    /** Subset of the order dates (null = all of them). */
    dates: z.array(isoInstant).max(MAX_ORDER_DATES).nullish(),
  })).min(1).max(MAX_ORDER_PLAYERS),
  description: optText(1000),
  internalNotes: optText(2000),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")).transform((v) => v || null),
  overrideAvailability: z.boolean().default(false),
  overrideReason: optText(500),
  notify: z.boolean().default(true),
});
export type OrderPayloadInput = z.input<typeof orderPayloadSchema>;
export type OrderPayload = z.output<typeof orderPayloadSchema>;

export const addDatesSchema = z.object({
  orderId: uuid,
  dates: z.array(isoInstant).min(1).max(MAX_ORDER_DATES),
  participantIds: z.array(uuid).max(MAX_ORDER_PLAYERS).nullish(),
  coachId: optUuid,
  venueSpaceId: optUuid,
  overrideAvailability: z.boolean().default(false),
  overrideReason: optText(500),
  notify: z.boolean().default(true),
  dryRun: z.boolean().default(false),
});
export type AddDatesInput = z.input<typeof addDatesSchema>;

export const orderCancelSchema = z.object({
  orderId: uuid,
  scope: z.enum(["booking", "participant", "date"]),
  bookingId: optUuid,
  participantId: optUuid,
  sessionId: optUuid,
  reason: z.string().trim().min(1).max(500),
  /** credit_note (default) for issued lines; none keeps the charge (late cancellation). */
  refundMode: z.enum(["credit_note", "none"]).default("credit_note"),
  restorePackage: z.boolean().nullish(),
  notify: z.boolean().default(true),
});
export type OrderCancelInput = z.input<typeof orderCancelSchema>;

export const orderRescheduleSchema = z.object({
  orderId: uuid,
  scope: z.enum(["booking", "date"]),
  bookingId: optUuid,
  sessionId: optUuid,
  startsAt: isoInstant,
  coachId: optUuid,
  venueSpaceId: optUuid,
  price: money.nullish(),
  priceReason: optText(500),
  overrideAvailability: z.boolean().default(false),
  overrideReason: optText(500),
  notify: z.boolean().default(true),
});
export type OrderRescheduleInput = z.input<typeof orderRescheduleSchema>;

export const pricingSaveSchema = z.object({
  serviceId: uuid,
  price: money.nullish(),
  groupRate: money.nullish(),
  pricingBasis: z.enum(PRICING_BASES).default("per_player_per_session"),
  shortDescription: optText(280),
  packages: z.array(z.object({
    id: optUuid,
    name: optText(120),
    sessions: z.coerce.number().int().min(1).max(1000),
    total: money,
    validityDays: z.coerce.number().int().min(1).max(3650).nullish(),
    isActive: z.boolean().default(true),
  })).max(20).nullish(),
});
export type PricingSaveInput = z.input<typeof pricingSaveSchema>;

const compact = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));
const iso = (v: string) => new Date(v).toISOString();

export function toOrderRpcPayload(p: OrderPayload): Record<string, unknown> {
  return {
    ...compact({
      service_id: p.serviceId, option: p.option, package_id: p.packageId, purchase_id: p.purchaseId,
      agreed_total: p.agreedTotal, agreed_rate: p.agreedRate, price_reason: p.priceReason, coach_id: p.coachId,
      venue_space_id: p.venueSpaceId, description: p.description, internal_notes: p.internalNotes, received_on: p.receivedOn,
      override_availability: p.overrideAvailability || null, override_reason: p.overrideReason,
    }),
    notify: p.notify,
    dates: p.dates.map(iso),
    participants: p.participants.map((x) => compact({
      athlete_id: x.athleteId, payer_id: x.payerId, dates: x.dates ? x.dates.map(iso) : null,
    })),
  };
}

// ---------------------------------------------------------------------------
// RPC result shapes
// ---------------------------------------------------------------------------
export type OrderDateCheck = {
  starts_at: string; ends_at: string; ok: boolean; errors: string[];
  athlete_errors: { athlete_id: string; code: string }[]; warnings: (BookingWarning & { athlete_id?: string })[];
  session_id: string | null; coach_id: string | null; venue_space_id: string | null; capacity: number | null;
  participants: number; adding: number; places_left: number | null; within_availability: boolean; creates: "booked" | "requested";
};

export type OrderQuote = {
  ok: boolean; errors: string[]; dates_ok: boolean; dates: OrderDateCheck[];
  participants: { athlete_id: string; first_name: string; last_name: string; family_id: string; payer_id: string | null;
                  payer: PayerSnapshot; payer_key: string; dates: string[]; sessions: number; rate: number; charge: number }[];
  option: { option: OrderOption; kind: OrderKind; package_id: string | null; package_name: string | null; validity_days: number | null;
            purchase_id: string | null; sessions: number | null; package_remaining: number | null; list_total: number | null;
            agreed_total: number | null; list_rate: number | null; agreed_rate: number | null; pricing_basis: PricingBasis | null;
            price_override: boolean; currency: string };
  totals: { charge: number; currency: string; sessions: number;
            payers: { payer_key: string; name: string | null; charge: number; athletes: number }[] };
  service: { id: string; name: string; kind: ServiceKind; duration_min: number; billing_category: string; max_participants: number;
             short_description: string | null };
  override: boolean; setup_missing: SetupMissingCode[]; pricing_missing: ("GROUP_RATE" | "PACKAGES")[];
  billing_entity: { id: string; name: string } | null; number_prefix: string | null;
};

export type OrderConfirmResult =
  | { ok: true; order_id: string; purchase_id: string | null; replayed: boolean; requested?: number;
      bookings?: { booking_id: string; session_id: string; athlete_id: string; starts_at: string; status: "booked" | "requested" }[];
      setup_missing?: SetupMissingCode[] }
  | { ok: false; code: "DATES_UNAVAILABLE"; dates: OrderDateCheck[] };

export type OrderInvoiceResult =
  | { ok: true; invoices: { invoice_id: string; number: string; status: string; total: number; currency: string; payer_name: string | null;
                            payer_key: string; lines: number }[]; nothing_to_invoice?: boolean; replayed?: boolean }
  | { ok: false; code: "SETUP_MISSING"; setup_missing: SetupMissingCode[] };

export type OrderDetail = {
  order: {
    id: string; kind: OrderKind; option_kind: OrderOption; status: "active" | "cancelled"; currency: string;
    service: { id: string; name: string; kind: ServiceKind; billing_category: string; short_description: string | null; duration_min: number };
    coach: { id: string; display_name: string } | null; venue_space_id: string | null;
    package_id: string | null; package_name: string | null; option_sessions: number | null; list_total: number | null;
    agreed_total: number | null; list_rate: number | null; group_rate: number | null; pricing_basis: PricingBasis | null;
    price_override_reason: string | null; billing_category: string; description: string | null; internal_notes: string | null;
    received_on: string | null; created_at: string; created_by_name: string | null; purchase_id: string | null; timezone: string;
    setup_missing: SetupMissingCode[];
  };
  participants: {
    participant_id: string; status: "active" | "cancelled"; rate: number; payer_id: string | null;
    athlete: { id: string; first_name: string; last_name: string; family_id: string }; payer: PayerSnapshot;
    sessions_booked: number; sessions_requested: number; sessions_completed: number; sessions_cancelled: number;
    charge: number; invoiced: number;
  }[];
  dates: {
    session_id: string | null; starts_at: string; ends_at: string | null; coach_name: string | null; session_status: string | null;
    event_id: string | null; capacity: number | null; participants_count: number | null; location: string | null;
    bookings: { booking_id: string; participant_id: string | null; athlete_id: string; first_name: string; last_name: string;
                status: BookingStatus; starts_at: string; billing_status: BillingStatus; billing_mode: string | null; price: number | null;
                invoice_id: string | null; invoice_number: string | null; cancel_reason: string | null }[];
  }[];
  package: { purchase_id: string; sessions: number; sessions_used: number; status: string; expires_at: string | null; amount: number;
             invoice_id: string | null; invoice_number: string | null; owned: boolean; booked: number; completed: number; available: number } | null;
  invoices: { invoice_id: string; number: string; status: string; payer_name: string | null; payer_kind: string | null; currency: string;
              total: number; adjustments: number; due: number; paid: number; balance: number; issued_at: string; due_date: string | null;
              activity: string; other_orders: boolean }[];
  totals: { currency: string; charged: number; uninvoiced: number; invoiced: number; paid: number; balance: number };
  can_add_dates: boolean;
};

export type OrderToInvoice = {
  order_id: string; service_id: string; service_name: string; billing_category: string; currency: string; option_kind: OrderOption;
  received_on: string | null; created_at: string; amount: number; lines: number; first_at: string; athletes: string[] | null;
  payers: number; setup_missing: SetupMissingCode[];
};

/** Sessions of a package order: booked / completed / still to schedule. */
export function packageUsage(p: { sessions: number; sessions_used: number; booked: number; completed: number }) {
  return { total: p.sessions, booked: p.booked, completed: p.completed, available: Math.max(0, p.sessions - p.sessions_used) };
}
