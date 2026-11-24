"use server";

import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { firstIssue, thirdPartySchema, type ParticipantErrorCode, type ParticipantOption, type ThirdPartyInput } from "./validation";

/**
 * "Someone else" — a participant outside the booker's family (a nephew, a
 * friend's child). CONTRACT for Workstream B (public entry + third-party
 * guardian consent), which replaces the body of this action:
 *
 *   createThirdPartyParticipant(input: ThirdPartyInput, requestId: string)
 *     -> ThirdPartyResult
 *
 *   input     participant first / last name, DOB, sex (male | female); the
 *             participant's parent / legal guardian (name, e-mail and / or
 *             phone); the booker's relation (nephew_niece | friends_child |
 *             other). Validated with thirdPartySchema (src/lib/participants/validation.ts).
 *   requestId one uuid per user intent; a retry / double click returns the
 *             same result (idempotent on the server).
 *   result    ok: the participant to select in the picker (kind "other") and
 *             the consent state ("awaiting_consent" until the participant's
 *             guardian accepts; the place is held per B's rules). The booker
 *             is NEVER added to the participant's family_members; booker,
 *             payer and the participant's guardian stay separate records.
 *             error: a code from participants.errors.<CODE>.
 *
 * Until B ships, the action validates the input and answers
 * THIRD_PARTY_NOT_ENABLED (nothing is stored).
 */
export type ThirdPartyResult =
  | { ok: true; data: { participant: ParticipantOption; status: "awaiting_consent" | "ready"; consentRequestId: string | null; replayed: boolean } }
  | { ok: false; code: ParticipantErrorCode | "INVALID_INPUT"; error: string };

export async function createThirdPartyParticipant(input: ThirdPartyInput, requestId: string): Promise<ThirdPartyResult> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId) return { ok: false, code: "NOT_AUTHENTICATED", error: t("participants.errors.NOT_AUTHENTICATED") };
  if (!z.string().uuid().safeParse(requestId).success) return { ok: false, code: "REQUEST_ID_REQUIRED", error: t("participants.errors.REQUEST_ID_REQUIRED") };
  const p = thirdPartySchema.safeParse(input);
  if (!p.success) return { ok: false, code: "INVALID_INPUT", error: t.dynamic(firstIssue(p.error)) };
  return { ok: false, code: "THIRD_PARTY_NOT_ENABLED", error: t("participants.errors.THIRD_PARTY_NOT_ENABLED") };
}
