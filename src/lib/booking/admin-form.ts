import { zonedWallTimeToUtc } from "@/lib/format";
import { newRequestId } from "@/lib/billing/request-id";
import type { BillingChoice, BookingPayloadInput, PayerInput, PayerKind } from "./types";

/*
 * Admin "New booking" form — pure state helpers (client + server safe, no I/O
 * beyond the Storage passed in). Covered by tests/unit/admin-booking-form.test.ts.
 *
 *  - Draft: the whole form (and the open "add athlete" panel) is saved to
 *    sessionStorage so nothing typed is lost on a reload or an accidental
 *    navigation; restored when the form opens again, cleared on confirm.
 *  - Request ids: one per user intent ("confirm", "athlete", "payer") for
 *    the life of the form. A retry or a double click sends the same id, so
 *    the server replays instead of booking twice. A server refusal stores
 *    nothing, so the same id is kept for the corrected retry; only a
 *    success settles it (the next intent of that kind gets a fresh id).
 *  - Bill To: the options offered for an athlete and how a choice becomes a
 *    payer id (existing record) or a payer to create first.
 */

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------
export type SlotMode = "new" | "join";
export type PayerChoice =
  | { type: "family" }
  | { type: "payer"; payerId: string }
  | { type: "guardian"; profileId: string }
  | { type: "athlete" }
  | { type: "new"; kind: PayerKind };

export type NewPayerFields = {
  name: string; email: string; phone: string; street: string; postalCode: string; city: string; country: string;
};

export type QuickAthleteFields = {
  firstName: string; lastName: string; dob: string; email: string; phone: string;
  guardianMode: "existing" | "new";
  familyId: string; familyLabel: string;
  guardianName: string; guardianEmail: string; guardianPhone: string; guardianStreet: string; guardianPostalCode: string; guardianCity: string;
};

export type BookingFormState = {
  athleteId: string; athleteLabel: string; athleteFamilyId: string;
  serviceId: string; coachId: string; venueSpaceId: string;
  slotMode: SlotMode; sessionId: string;
  /** Wall-clock date + time in the club time zone. */
  date: string; time: string;
  payer: PayerChoice; newPayer: NewPayerFields;
  billing: BillingChoice; purchaseId: string;
  priceOverride: boolean; price: string; priceReason: string;
  overrideAvailability: boolean; overrideReason: string;
  notes: string; notify: boolean;
  /** "Add new athlete" panel: open + its fields (kept in the draft too). */
  quickOpen: boolean; quick: QuickAthleteFields;
};

export const emptyNewPayer = (): NewPayerFields => ({ name: "", email: "", phone: "", street: "", postalCode: "", city: "", country: "CH" });
export const emptyQuickAthlete = (): QuickAthleteFields => ({
  firstName: "", lastName: "", dob: "", email: "", phone: "", guardianMode: "existing", familyId: "", familyLabel: "",
  guardianName: "", guardianEmail: "", guardianPhone: "", guardianStreet: "", guardianPostalCode: "", guardianCity: "",
});

export function emptyBookingForm(init: Partial<BookingFormState> = {}): BookingFormState {
  return {
    athleteId: "", athleteLabel: "", athleteFamilyId: "", serviceId: "", coachId: "", venueSpaceId: "", slotMode: "new", sessionId: "",
    date: "", time: "", payer: { type: "family" }, newPayer: emptyNewPayer(), billing: "auto", purchaseId: "",
    priceOverride: false, price: "", priceReason: "", overrideAvailability: false, overrideReason: "", notes: "", notify: true,
    quickOpen: false, quick: emptyQuickAthlete(), ...init,
  };
}

/** A new athlete was created (or an existing one picked) from the panel: select it, keep everything else. */
export function withAthlete(s: BookingFormState, athleteId: string, athleteLabel: string, familyId: string | null = null): BookingFormState {
  const changed = s.athleteId !== athleteId;
  return {
    ...s, athleteId, athleteLabel, athleteFamilyId: familyId ?? (changed ? "" : s.athleteFamilyId), quickOpen: false, quick: emptyQuickAthlete(),
    // Payers belong to the athlete's family: a different athlete starts from the family default.
    ...(changed ? { payer: { type: "family" } as PayerChoice, purchaseId: "" } : {}),
  };
}

/** A different service resets what depended on the old one (coach eligibility, session, package). */
export function withService(s: BookingFormState, serviceId: string, defaults: { coachIds: string[]; venueSpaceId: string | null }): BookingFormState {
  if (s.serviceId === serviceId) return s;
  const coachId = defaults.coachIds.includes(s.coachId) ? s.coachId : defaults.coachIds.length === 1 ? defaults.coachIds[0] : "";
  return { ...s, serviceId, coachId, sessionId: "", slotMode: "new", purchaseId: "", venueSpaceId: defaults.venueSpaceId ?? s.venueSpaceId };
}

// ---------------------------------------------------------------------------
// Draft (sessionStorage)
// ---------------------------------------------------------------------------
export const DRAFT_KEY = "clubos.adminBooking.draft";
const DRAFT_VERSION = 1;
/** Drafts older than this are dropped (a stale slot would only confuse). */
export const DRAFT_MAX_AGE_MS = 12 * 3_600_000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Envelope = { v: number; savedAt: number; scope: string; state: BookingFormState };

/** Save the form. `scope` separates drafts per club (org id) so one club's draft never opens in another. */
export function saveDraft(storage: StorageLike | null | undefined, scope: string, state: BookingFormState, now = Date.now()): void {
  if (!storage) return;
  try {
    const env: Envelope = { v: DRAFT_VERSION, savedAt: now, scope, state };
    storage.setItem(DRAFT_KEY, JSON.stringify(env));
  } catch {
    /* storage full or blocked: the form still works, only the draft is lost */
  }
}

/** The saved form of this club, if fresh and well formed; merged onto an empty form so new fields get defaults. */
export function loadDraft(storage: StorageLike | null | undefined, scope: string, now = Date.now()): BookingFormState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as Partial<Envelope>;
    if (env.v !== DRAFT_VERSION || env.scope !== scope || typeof env.savedAt !== "number" || !env.state || typeof env.state !== "object") return null;
    if (now - env.savedAt > DRAFT_MAX_AGE_MS) { storage.removeItem(DRAFT_KEY); return null; }
    const base = emptyBookingForm();
    const st = env.state as Partial<BookingFormState>;
    return {
      ...base, ...st,
      newPayer: { ...base.newPayer, ...(st.newPayer ?? {}) },
      quick: { ...base.quick, ...(st.quick ?? {}) },
      payer: isPayerChoice(st.payer) ? st.payer : base.payer,
    };
  } catch {
    return null;
  }
}

export function clearDraft(storage: StorageLike | null | undefined): void {
  try { storage?.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

/** Is there anything worth saving (or asking about)? */
export function isDirty(s: BookingFormState): boolean {
  const e = emptyBookingForm();
  // The date alone does not count: the form opens on today.
  return Boolean(s.athleteId || s.serviceId || s.time || s.notes || s.quickOpen || s.payer.type !== e.payer.type || s.priceOverride);
}

function isPayerChoice(v: unknown): v is PayerChoice {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  switch (c.type) {
    case "family": case "athlete": return true;
    case "payer": return typeof c.payerId === "string";
    case "guardian": return typeof c.profileId === "string";
    case "new": return c.kind === "athlete" || c.kind === "guardian" || c.kind === "sponsor" || c.kind === "other";
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// Request ids
// ---------------------------------------------------------------------------
export type Intent = "confirm" | "athlete" | "payer" | "invoice" | "payment" | "reschedule" | "cancel";

/** One request id per intent for the life of the form (see the header). */
export class RequestIds {
  private ids = new Map<Intent, string>();
  constructor(private readonly make: () => string = newRequestId) {}
  /** The id to send now: the same one until the intent succeeds. */
  get(intent: Intent): string {
    let id = this.ids.get(intent);
    if (!id) { id = this.make(); this.ids.set(intent, id); }
    return id;
  }
  /** The server accepted it (or replayed it): the next attempt is a new intent. */
  settle(intent: Intent): void { this.ids.delete(intent); }
}

// ---------------------------------------------------------------------------
// Form -> payload
// ---------------------------------------------------------------------------
/** The wall-clock date / time in the club time zone as a UTC ISO instant, or null. */
export function slotInstant(date: string, time: string, timeZone: string): string | null {
  const d = zonedWallTimeToUtc(date, time, timeZone);
  return d ? d.toISOString() : null;
}

/** The quote / confirm payload of the form, with the payer id resolved by the caller. */
export function formToPayload(s: BookingFormState, timeZone: string, payerId: string | null): BookingPayloadInput | null {
  if (!s.athleteId || !s.serviceId) return null;
  const join = s.slotMode === "join" && Boolean(s.sessionId);
  const startsAt = join ? null : slotInstant(s.date, s.time, timeZone);
  if (!join && (!s.coachId || !startsAt)) return null;
  const price = s.priceOverride && s.price.trim() !== "" ? Number(s.price) : null;
  return {
    athleteId: s.athleteId, serviceId: s.serviceId,
    coachId: join ? null : s.coachId, sessionId: join ? s.sessionId : null, startsAt,
    venueSpaceId: join ? null : s.venueSpaceId || null, payerId,
    billing: s.billing, purchaseId: s.billing === "package" && s.purchaseId ? s.purchaseId : null,
    price: price !== null && Number.isFinite(price) ? price : null, priceReason: price !== null ? s.priceReason || null : null,
    overrideAvailability: s.overrideAvailability, overrideReason: s.overrideAvailability ? s.overrideReason || null : null,
    notes: s.notes || null, notify: s.notify,
  };
}

/** Stable key of what the quote depends on (re-quote only when it changes). */
export function quoteKey(p: BookingPayloadInput | null): string {
  return p ? JSON.stringify(p) : "";
}

// ---------------------------------------------------------------------------
// Bill To
// ---------------------------------------------------------------------------
export type PayerCandidates = {
  payers: { id: string; kind: PayerKind; name: string; email: string | null; has_account?: boolean; athlete_id?: string | null; city?: string | null }[];
  guardians: { profile_id: string; full_name: string | null; email: string | null; is_primary?: boolean; can_pay?: boolean; payer_id: string | null }[];
  family_default: { name: string | null; email: string | null } | null;
};

export type PayerOption = { key: string; choice: PayerChoice; label: string; detail: string | null; group: "family" | "saved" | "guardian" | "athlete" };

export const payerKey = (c: PayerChoice): string =>
  c.type === "payer" ? `payer:${c.payerId}` : c.type === "guardian" ? `guardian:${c.profileId}` : c.type === "new" ? `new:${c.kind}` : c.type;

/**
 * The Bill To options for an athlete: the family default, every saved payer of
 * the family (siblings share them) or the athlete, the guardians who have no
 * saved payer yet, and the athlete themself. Guardians that already have a
 * payer record are offered once, as that record.
 */
export function buildPayerOptions(c: PayerCandidates | null, athlete: { id: string; name: string } | null): PayerOption[] {
  const out: PayerOption[] = [];
  const fam = c?.family_default;
  out.push({ key: "family", choice: { type: "family" }, label: fam?.name ?? "", detail: fam?.email ?? null, group: "family" });
  const seen = new Set<string>();
  for (const p of c?.payers ?? []) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ key: `payer:${p.id}`, choice: { type: "payer", payerId: p.id }, label: p.name, detail: p.email ?? p.city ?? null, group: "saved" });
  }
  for (const g of c?.guardians ?? []) {
    if (g.payer_id && seen.has(g.payer_id)) continue;
    if (g.payer_id) {
      seen.add(g.payer_id);
      out.push({ key: `payer:${g.payer_id}`, choice: { type: "payer", payerId: g.payer_id }, label: g.full_name ?? g.email ?? "", detail: g.email, group: "guardian" });
    } else {
      out.push({ key: `guardian:${g.profile_id}`, choice: { type: "guardian", profileId: g.profile_id }, label: g.full_name ?? g.email ?? "", detail: g.email, group: "guardian" });
    }
  }
  const own = (c?.payers ?? []).find((p) => p.kind === "athlete" && p.athlete_id === athlete?.id);
  if (athlete && !own) out.push({ key: "athlete", choice: { type: "athlete" }, label: athlete.name, detail: null, group: "athlete" });
  return out;
}

export type PayerResolution =
  | { kind: "ready"; payerId: string | null }
  | { kind: "create"; payer: PayerInput }
  | { kind: "invalid"; reason: "PAYER_NAME_REQUIRED" | "PAYER_NOT_FOUND" };

/**
 * What the chosen Bill To means for the booking: an existing payer id (or
 * null = the family default), or a payer record to create first (guardian
 * without a record, the athlete, a new sponsor / other payer).
 */
export function resolvePayer(
  choice: PayerChoice, c: PayerCandidates | null, athlete: { id: string; name: string; familyId: string | null } | null, fields: NewPayerFields,
): PayerResolution {
  switch (choice.type) {
    case "family": return { kind: "ready", payerId: null };
    case "payer": {
      const known = (c?.payers ?? []).some((p) => p.id === choice.payerId) || (c?.guardians ?? []).some((g) => g.payer_id === choice.payerId);
      return known ? { kind: "ready", payerId: choice.payerId } : { kind: "invalid", reason: "PAYER_NOT_FOUND" };
    }
    case "guardian": {
      const g = (c?.guardians ?? []).find((x) => x.profile_id === choice.profileId);
      if (!g) return { kind: "invalid", reason: "PAYER_NOT_FOUND" };
      if (g.payer_id) return { kind: "ready", payerId: g.payer_id };
      const name = (g.full_name ?? "").trim() || (g.email ?? "").trim();
      if (!name) return { kind: "invalid", reason: "PAYER_NAME_REQUIRED" };
      return { kind: "create", payer: { kind: "guardian", profileId: g.profile_id, familyId: athlete?.familyId ?? null, name, email: g.email ?? "" } };
    }
    case "athlete": {
      if (!athlete) return { kind: "invalid", reason: "PAYER_NOT_FOUND" };
      const own = (c?.payers ?? []).find((p) => p.kind === "athlete" && p.athlete_id === athlete.id);
      if (own) return { kind: "ready", payerId: own.id };
      return { kind: "create", payer: { kind: "athlete", athleteId: athlete.id, familyId: athlete.familyId, name: athlete.name } };
    }
    case "new": {
      const name = fields.name.trim();
      if (!name) return { kind: "invalid", reason: "PAYER_NAME_REQUIRED" };
      return {
        kind: "create",
        payer: {
          kind: choice.kind, name, email: fields.email.trim(), phone: fields.phone.trim() || null, street: fields.street.trim() || null,
          postalCode: fields.postalCode.trim() || null, city: fields.city.trim() || null, country: fields.country.trim() || "",
          familyId: choice.kind === "guardian" || choice.kind === "athlete" ? athlete?.familyId ?? null : null,
          athleteId: choice.kind === "athlete" ? athlete?.id ?? null : null,
        },
      };
    }
  }
}
