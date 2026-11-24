"use server";

import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { logError } from "@/lib/log";
import { entryDb } from "@/lib/public-entry/db";
import { consentErrorCode } from "@/lib/public-entry/shared";
import type { Json } from "@/types/database";
import { firstIssue, participantErrorCode, thirdPartySchema, type ParticipantErrorCode, type ParticipantOption, type ThirdPartyInput } from "./validation";

/**
 * "Someone else" — a participant outside the booker's family (a nephew, a
 * friend's child). Implemented by Workstream B
 * (20250420105900_public_entry_guardian_consent.sql,
 * docs/public-entry-and-guardian-consent.md):
 *
 *   createThirdPartyParticipant(input: ThirdPartyInput, requestId: string)
 *     -> ThirdPartyResult
 *
 * third_party_participant_create() creates the participant in a holding
 * guest family with no members (or, when the child already exists in the
 * club, targets that child privately — the answer has the same shape), links
 * the booker with scope 'status_only' (participant_bookers) and opens a
 * guardian consent request. The booker is NEVER added to the participant's
 * family_members. The consent e-mail goes out when a place is held (camp /
 * training booking), with the activity and dates. A guardian e-mail is
 * required (the guardian is verified by e-mail ownership).
 */
export type ThirdPartyResult =
  | { ok: true; data: { participant: ParticipantOption; status: "awaiting_consent" | "ready"; consentRequestId: string | null; replayed: boolean } }
  | { ok: false; code: ParticipantErrorCode | "INVALID_INPUT" | string; error: string };

export async function createThirdPartyParticipant(input: ThirdPartyInput, requestId: string): Promise<ThirdPartyResult> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId) return { ok: false, code: "NOT_AUTHENTICATED", error: t("participants.errors.NOT_AUTHENTICATED") };
  if (!z.string().uuid().safeParse(requestId).success) return { ok: false, code: "REQUEST_ID_REQUIRED", error: t("participants.errors.REQUEST_ID_REQUIRED") };
  const p = thirdPartySchema.safeParse(input);
  if (!p.success) return { ok: false, code: "INVALID_INPUT", error: t.dynamic(firstIssue(p.error)) };
  const v = p.data;
  if (!v.guardianEmail) return { ok: false, code: "GUARDIAN_EMAIL_REQUIRED", error: t("consentRequest.errors.GUARDIAN_EMAIL_REQUIRED") };

  const db = await entryDb();
  const { data, error } = await db.rpc("third_party_participant_create", {
    p_payload: {
      first_name: v.firstName, last_name: v.lastName, dob: v.dob, gender: v.sex,
      guardian_name: v.guardianName, guardian_email: v.guardianEmail, guardian_phone: v.guardianPhone ?? "", relation: v.relation,
    } as Json,
    p_request_id: requestId,
  });
  if (error) {
    const own = consentErrorCode(error.message);
    if (own) return { ok: false, code: own, error: t.dynamic(`consentRequest.errors.${own}`, undefined, t("consentRequest.errors.generic")) };
    const code = participantErrorCode(error.message);
    if (code) return { ok: false, code, error: t.dynamic(`participants.errors.${code}`, undefined, t("participants.errors.generic")) };
    logError("participants.thirdParty", error);
    return { ok: false, code: "GENERIC", error: t("participants.errors.generic") };
  }
  const r = (data ?? {}) as { athlete_id?: string; kind?: "other" | "child"; status?: "awaiting_consent" | "ready"; consent_request_id?: string | null; replayed?: boolean };
  if (!r.athlete_id) return { ok: false, code: "GENERIC", error: t("participants.errors.generic") };
  return {
    ok: true,
    data: {
      // Only what the booker typed: the booker never reads the participant record.
      participant: { id: r.athlete_id, name: `${v.firstName} ${v.lastName}`, dob: v.dob, kind: r.kind === "child" ? "child" : "other" },
      status: r.status === "ready" ? "ready" : "awaiting_consent",
      consentRequestId: r.consent_request_id ?? null,
      replayed: Boolean(r.replayed),
    },
  };
}
