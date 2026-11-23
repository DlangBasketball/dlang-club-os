import { zonedWallTimeToUtc } from "@/lib/format";
import { generateSlots, localParts, formatHm, type OpeningHours, type SlotBlackout, type SlotBusy, type SlotTemplate, type SlotWindow } from "@/lib/training/slots";
import type { FamilyCatalogService, FamilyRequestInput } from "./types";

/*
 * Parent "Request a session" form — pure helpers (client + server safe, no
 * I/O; unit-tested in tests/unit/booking-requests.test.ts). The server
 * (booking_family_quote / booking_family_request) decides; these only shape
 * the form and show the coach's declared availability as hints.
 */

export type FamilyRequestForm = {
  athleteId: string;
  serviceId: string;
  /** "" = any eligible coach (the server picks one). */
  coachId: string;
  /** Join an open group session instead of a new time. */
  sessionId: string;
  /** Wall-clock date + time in the club time zone. */
  date: string;
  time: string;
  promoCode: string;
  notes: string;
};

export const emptyFamilyRequest = (init: Partial<FamilyRequestForm> = {}): FamilyRequestForm => ({
  athleteId: "", serviceId: "", coachId: "", sessionId: "", date: "", time: "", promoCode: "", notes: "", ...init,
});

/** A different service resets what depended on the old one (coach, session, code). */
export function withFamilyService(f: FamilyRequestForm, service: FamilyCatalogService | null): FamilyRequestForm {
  if (!service) return { ...f, serviceId: "", coachId: "", sessionId: "", promoCode: "" };
  if (f.serviceId === service.id) return f;
  const coachId = service.coaches.some((c) => c.id === f.coachId) ? f.coachId : service.coaches.length === 1 ? service.coaches[0].id : "";
  return { ...f, serviceId: service.id, coachId, sessionId: "", promoCode: "" };
}

/** The server payload of the form, or null while incomplete. */
export function familyFormToPayload(f: FamilyRequestForm, timeZone: string): FamilyRequestInput | null {
  if (!f.athleteId || !f.serviceId) return null;
  if (f.sessionId) {
    return { athleteId: f.athleteId, serviceId: f.serviceId, sessionId: f.sessionId, notes: f.notes.trim() || null, promoCode: f.promoCode || null };
  }
  const start = f.date && f.time ? zonedWallTimeToUtc(f.date, f.time, timeZone) : null;
  if (!start) return null;
  return {
    athleteId: f.athleteId, serviceId: f.serviceId, coachId: f.coachId || null, startsAt: start.toISOString(),
    notes: f.notes.trim() || null, promoCode: f.promoCode || null,
  };
}

export type DeclaredAvailabilityInput = {
  templates: SlotTemplate[];
  windows: SlotWindow[];
  blackouts: SlotBlackout[];
  busy: SlotBusy[];
  venueHours: Record<string, OpeningHours>;
  stepMin: number;
};

/**
 * Start times ("HH:MM", club time zone) on one day that fit the declared
 * availability of the chosen coach (or of any eligible coach). Empty when
 * the coach declared nothing that day: the family can still ask for any
 * time inside the venue hours, the coach confirms.
 */
export function declaredTimes(opts: {
  service: Pick<FamilyCatalogService, "id" | "duration_min" | "max_participants" | "coaches">;
  coachId: string; date: string; timeZone: string; availability: DeclaredAvailabilityInput | null; now?: Date; venueId?: string | null;
}): string[] {
  if (!opts.availability || !opts.date) return [];
  const coachIds = opts.coachId ? [opts.coachId] : opts.service.coaches.map((c) => c.id);
  if (!coachIds.length) return [];
  const slots = generateSlots({
    timeZone: opts.timeZone, fromDate: opts.date, days: 1,
    service: { id: opts.service.id, durationMin: opts.service.duration_min, maxParticipants: opts.service.max_participants, minParticipants: 1, venueId: opts.venueId ?? null },
    coachIds, templates: opts.availability.templates, windows: opts.availability.windows, blackouts: opts.availability.blackouts,
    busy: opts.availability.busy, venueHours: opts.availability.venueHours, stepMin: opts.availability.stepMin, now: opts.now ?? new Date(),
  });
  const times = new Set<string>();
  for (const s of slots) {
    if (s.spotsLeft <= 0) continue;
    const p = localParts(new Date(s.start).getTime(), opts.timeZone);
    if (p.date === opts.date) times.add(formatHm(p.minutes));
  }
  return Array.from(times).sort();
}

/** Package coverage line: sessions left on the child's package for the service (0 = none). */
export const packageLeft = (s: Pick<FamilyCatalogService, "package_remaining"> | null | undefined): number =>
  Math.max(0, Number(s?.package_remaining ?? 0));
