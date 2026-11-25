import "server-only";
import type { Json } from "@/types/database";
import { getSessionUser } from "@/lib/auth/get-user";
import { revalidatePersonEverywhere } from "@/lib/people/revalidate";
import { participantsDb } from "./db";
import { notifyFamilyOfCarerConsent } from "./invite-notify";

/**
 * Carer consent (migration 20250420106500), server only. Status before a
 * booking and acceptance by the signed-in linked relative; the database
 * decides (club setting, can_consent, health rule, COPPA).
 */
export type CarerConsentForm = { key: string; title: string; version: number; required: boolean; health: boolean; allowed: boolean; body: string | null };
export type CarerConsentStatus = { enabled: boolean; canConsent: boolean; reason: string | null; forms: CarerConsentForm[] };

export async function getCarerConsentStatus(athleteId: string): Promise<CarerConsentStatus> {
  const db = await participantsDb();
  const { data, error } = await db.rpc("linker_consent_status", { p_athlete: athleteId });
  if (error || !data) return { enabled: false, canConsent: false, reason: null, forms: [] };
  const d = data as { enabled?: boolean; can_consent?: boolean; reason?: string | null; forms?: CarerConsentForm[] };
  return { enabled: d.enabled === true, canConsent: d.can_consent === true, reason: d.reason ?? null, forms: d.forms ?? [] };
}

export type CarerPending = { requestId: string; expiresAt: string | null; forms: CarerConsentForm[] };

/** The signed-in booker's held requests they may consent to themselves. */
export async function getCarerConsentPending(): Promise<CarerPending[]> {
  const db = await participantsDb();
  const { data, error } = await db.rpc("linker_consent_pending", {});
  if (error) return [];
  return ((data ?? []) as { request_id: string; expires_at: string | null; forms: CarerConsentForm[] }[])
    .map((r) => ({ requestId: r.request_id, expiresAt: r.expires_at, forms: r.forms ?? [] }));
}

/** Accept as the carer (session caller), then tell the child's family who consented. */
export async function acceptAsCarer(orgId: string, requestId: string, keys: string[]): Promise<{ ok: true } | { ok: false; message: string }> {
  const me = await getSessionUser();
  if (!me) return { ok: false, message: "NOT_AUTHENTICATED" };
  const db = await participantsDb();
  const { data, error } = await db.rpc("linker_consent_accept", { p_request: requestId, p_payload: { accepted_keys: keys } as Json });
  if (error) return { ok: false, message: error.message };
  const r = (data ?? {}) as { replayed?: boolean; athlete_id?: string; relation?: string; items?: { activity?: string }[] };
  if (!r.replayed && r.athlete_id) {
    const activity = Array.from(new Set((r.items ?? []).map((i) => i.activity).filter(Boolean))).join(", ");
    await notifyFamilyOfCarerConsent(orgId, r.athlete_id, me.id, r.relation ?? "other_carer", activity);
  }
  revalidatePersonEverywhere(orgId);
  return { ok: true };
}
