import "server-only";
import { randomUUID } from "node:crypto";
import { bookingErrorCode, type FamilyCatalog } from "@/lib/booking/types";
import type { Read } from "@/lib/booking/data";
import type { Json } from "@/types/database";
import { logError } from "@/lib/log";
import { entryAdminDb, entryDb } from "./db";
import { newConsentToken } from "./token";
import { sendConsentRequest } from "./notify";
import { whitelistBookerRow, type BookerStatusRow } from "./shared";
import { acceptAsCarer, getCarerConsentStatus } from "@/lib/participants/carer-consent";

/**
 * Third-party bookings (booker != guardian) — server helpers for the camp and
 * training actions. The org is always the caller's session org; the RPCs
 * re-check that the caller is the booker of the participant
 * (participant_bookers) and every booking rule (age, capacity, availability).
 */

/** Which of these athlete ids are "someone else" participants of this booker (own org only). */
export async function thirdPartyIds(profileId: string, orgId: string, athleteIds: string[]): Promise<Set<string>> {
  const ids = athleteIds.filter(Boolean);
  if (!ids.length) return new Set();
  const { data } = await entryAdminDb().from("participant_bookers").select("athlete_id")
    .eq("org_id", orgId).eq("profile_id", profileId).in("athlete_id", ids);
  return new Set(((data ?? []) as { athlete_id: string }[]).map((r) => r.athlete_id));
}

export type HoldResult =
  | {
      ok: true; consentRequestId: string; itemId: string; replayed: boolean; raw: Record<string, unknown>;
      /** "carer": the linked relative consented themselves; "carer_pending": they may consent on Bookings for others; "family": the guardian was e-mailed. */
      consent: "carer" | "carer_pending" | "family";
    }
  | { ok: false; message: string };

/**
 * Hold a camp place awaiting the guardian's consent, then e-mail the guardian
 * (new holds only). A linked relative the club lets consent (setting ON,
 * can_consent; checked again in SQL) accepts the consents ticked in the form
 * instead, and no request is sent; if that fails the guardian is asked as before.
 */
export async function holdThirdPartyCamp(x: {
  orgId: string; programId: string; editionId: string; athleteId: string; ageGroupId: string; priceOptionId: string;
  days: string[]; requestId?: string; consents?: string[];
}): Promise<HoldResult> {
  const carer = await getCarerConsentStatus(x.athleteId);
  const { token, hash } = newConsentToken();
  const db = await entryDb();
  const { data, error } = await db.rpc("third_party_camp_hold", {
    p_payload: {
      program_id: x.programId, edition_id: x.editionId, athlete_id: x.athleteId, age_group_id: x.ageGroupId,
      price_option_id: x.priceOptionId, days: x.days, token_hash: hash,
    } as Json,
    p_request_id: x.requestId ?? randomUUID(),
  });
  if (error) return { ok: false, message: error.message };
  const r = (data ?? {}) as { registration_id?: string; consent_request_id?: string; replayed?: boolean };
  if (!r.registration_id || !r.consent_request_id) return { ok: false, message: "UNKNOWN" };
  let consent: "carer" | "family" = "family";
  if (!r.replayed) {
    if (carer.canConsent && x.consents?.length) {
      const c = await acceptAsCarer(x.orgId, r.consent_request_id, x.consents);
      if (c.ok) consent = "carer";
      else logError("publicEntry.carerConsent", c.message);
    }
    if (consent === "family") await sendConsentRequest(x.orgId, r.consent_request_id, token);
  }
  return { ok: true, consentRequestId: r.consent_request_id, itemId: r.registration_id, replayed: Boolean(r.replayed), raw: r, consent };
}

/**
 * Training request for a third-party participant (requested + awaiting
 * consent), then the guardian e-mail — unless the booker is a linked relative
 * the club lets consent: they consent on Bookings for others (or ask the
 * family from there).
 */
export async function holdThirdPartyTraining(orgId: string, payload: Record<string, unknown>, requestId: string): Promise<HoldResult> {
  const carer = typeof payload.athlete_id === "string" ? await getCarerConsentStatus(payload.athlete_id) : null;
  const { token, hash } = newConsentToken();
  const db = await entryDb();
  const { data, error } = await db.rpc("third_party_training_request", {
    p_payload: { ...payload, promo_code: undefined, token_hash: hash } as Json,
    p_request_id: requestId,
  });
  if (error) return { ok: false, message: error.message };
  const r = (data ?? {}) as { booking_id?: string; consent_request_id?: string; replayed?: boolean };
  if (!r.booking_id || !r.consent_request_id) return { ok: false, message: "UNKNOWN" };
  const consent = carer?.canConsent ? "carer_pending" : "family";
  if (!r.replayed && consent === "family") await sendConsentRequest(orgId, r.consent_request_id, token);
  return { ok: true, consentRequestId: r.consent_request_id, itemId: r.booking_id, replayed: Boolean(r.replayed), raw: r, consent };
}

/** Quote for the booker (no promo codes). */
export async function quoteThirdPartyTraining(payload: Record<string, unknown>): Promise<{ data: unknown; error: string | null }> {
  const db = await entryDb();
  const { data, error } = await db.rpc("third_party_training_quote", { p_payload: { ...payload, promo_code: undefined } as Json });
  return error ? { data: null, error: error.message } : { data, error: null };
}

/** The booker's training catalog for a "someone else" participant (typed name only, no packages). */
export async function getThirdPartyCatalog(athleteId: string): Promise<Read<FamilyCatalog>> {
  const db = await entryDb();
  const { data, error } = await (db as unknown as { rpc: (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> })
    .rpc("third_party_training_catalog", { p_athlete: athleteId });
  if (error) return { data: null, error: bookingErrorCode(error.message) ?? "UNKNOWN" };
  return { data: data as FamilyCatalog, error: null };
}

/** "Bookings for others": status rows of the signed-in booker (whitelisted fields only). */
export async function getBookerStatus(): Promise<BookerStatusRow[]> {
  const db = await entryDb();
  const { data, error } = await db.rpc("booker_booking_status", {});
  if (error) {
    logError("publicEntry.bookerStatus", error);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map(whitelistBookerRow);
}
