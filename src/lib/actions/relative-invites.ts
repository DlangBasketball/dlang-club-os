"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { logError } from "@/lib/log";
import { revalidatePersonEverywhere } from "@/lib/people/revalidate";
import type { Json } from "@/types/database";
import { participantsDb } from "@/lib/participants/db";
import { sendRelativeInvitation } from "@/lib/participants/invite-notify";
import { acceptAsCarer } from "@/lib/participants/carer-consent";
import { childLinkToRpc, isInviteToken, participantErrorCode, relativeInviteSchema, type RelativeInviteInput } from "@/lib/participants/validation";
import { hashConsentToken, newConsentToken } from "@/lib/public-entry/token";
import { sendConsentRequest } from "@/lib/public-entry/notify";

/*
 * Relatives for one child (migration 20250420106500): e-mail invitations by a
 * family guardian, acceptance by the invited address, carer consent by a
 * linked relative while the club allows it. The org is always the caller's
 * session org; every RPC re-checks the caller, the club and the permission.
 * Tokens are generated here and only their SHA-256 reaches the database.
 */
export type RIResult<T = undefined> = { ok: true; data: T; message?: string } | { ok: false; code: string; error: string };

const uuid = z.string().uuid();
const keysSchema = z.array(z.string().trim().min(1).max(80)).max(50);

function fail(t: Translator, error: { message?: string } | string | null | undefined): { ok: false; code: string; error: string } {
  const msg = typeof error === "string" ? error : error?.message ?? "";
  const code = participantErrorCode(msg) ?? carerCode(msg);
  if (code) return { ok: false, code, error: t.dynamic(`participants.errors.${code}`, undefined, t("participants.errors.generic")) };
  if (msg) logError("relativeInvites", msg);
  return { ok: false, code: "GENERIC", error: t("participants.errors.generic") };
}

const CARER_CODES = ["NOT_LINKED", "NO_CONSENT_PERMISSION", "COPPA_GUARDIAN_REQUIRED", "HEALTH_NEEDS_GUARDIAN", "CONSENT_REQUIRED", "CONSENT_NOT_PENDING"] as const;
function carerCode(msg: string): string | null {
  return CARER_CODES.find((c) => new RegExp(`\\b${c}\\b`).test(msg)) ?? null;
}

async function session(): Promise<{ me: (SessionUser & { orgId: string }) | null; t: Translator }> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId) return { me: null, t };
  return { me: me as SessionUser & { orgId: string }, t };
}

function refreshFamily(orgId: string, athleteId?: string) {
  revalidatePersonEverywhere(orgId);
  for (const p of ["/parent/family", "/parent/athletes", ...(athleteId ? [`/parent/children/${athleteId}`, `/admin/athletes/${athleteId}`] : [])]) {
    try { revalidatePath(p); } catch { /* no request context */ }
  }
}

/** A family guardian invites a relative / friend by e-mail for one child (or re-sends a pending invitation). */
export async function inviteRelative(athleteId: string, input: RelativeInviteInput, requestId: string): Promise<RIResult<{ resent: boolean; emailed: boolean }>> {
  const { me, t } = await session();
  if (!me) return { ok: false, code: "NOT_ALLOWED", error: t("participants.errors.NOT_ALLOWED") };
  if (!uuid.safeParse(athleteId).success) return fail(t, "NOT_FOUND");
  if (!uuid.safeParse(requestId).success) return fail(t, "REQUEST_ID_REQUIRED");
  const p = relativeInviteSchema.safeParse(input);
  if (!p.success) {
    const k = p.error.issues[0]?.message ?? "";
    return { ok: false, code: "INVALID_INPUT", error: t.dynamic(k, undefined, t("participants.errors.generic")) };
  }
  const { token, hash } = newConsentToken();
  const db = await participantsDb();
  const { data, error } = await db.rpc("athlete_link_invite_create", {
    p_athlete: athleteId,
    p_payload: { email: p.data.email, ...childLinkToRpc(p.data.permissions) } as Json,
    p_token_hash: hash,
    p_request_id: requestId,
  });
  if (error) return fail(t, error);
  const r = (data ?? {}) as { invitation_id?: string; resent?: boolean; replayed?: boolean };
  // A replayed request (double click) did not store this token: nothing to send.
  const emailed = r.invitation_id && !r.replayed ? await sendRelativeInvitation(me.orgId, r.invitation_id, token) : false;
  refreshFamily(me.orgId, athleteId);
  return {
    ok: true, data: { resent: Boolean(r.resent), emailed },
    message: t(r.resent ? "participants.invite.resent" : "participants.invite.sent", { email: p.data.email }),
  };
}

/** Revoke a pending invitation (inviter, family guardian of the child, admin). */
export async function revokeRelativeInvite(invitationId: string): Promise<RIResult> {
  const { me, t } = await session();
  if (!me) return { ok: false, code: "NOT_ALLOWED", error: t("participants.errors.NOT_ALLOWED") };
  if (!uuid.safeParse(invitationId).success) return fail(t, "NOT_FOUND");
  const db = await participantsDb();
  const { error } = await db.rpc("athlete_link_invite_revoke", { p_invitation: invitationId });
  if (error) return fail(t, error);
  refreshFamily(me.orgId);
  return { ok: true, data: undefined, message: t("participants.invite.revoked") };
}

/**
 * Accept as the signed-in invitee (confirmed sign-in e-mail = invited e-mail,
 * checked in SQL). The club of the invitation becomes current when needed.
 */
export async function acceptRelativeInvite(token: string): Promise<RIResult<{ athleteId: string | null }>> {
  const t = await getTranslations();
  if (!isInviteToken(token)) return fail(t, "NOT_FOUND");
  const me = await getSessionUser();
  if (!me) return fail(t, "NOT_AUTHENTICATED");
  const db = await participantsDb();
  const { data, error } = await db.rpc("athlete_link_invite_accept", { p_token_hash: hashConsentToken(token) });
  if (error) return fail(t, error);
  const r = (data ?? {}) as { org_id?: string; athlete_id?: string; is_current_org?: boolean };
  if (r.org_id && !r.is_current_org) {
    const { error: sw } = await db.rpc("switch_current_org", { p_org: r.org_id });
    if (sw) logError("relativeInvites.switchOrg", sw);
  }
  revalidatePersonEverywhere(r.org_id ?? null);
  try { revalidatePath("/", "layout"); } catch { /* no request context */ }
  return { ok: true, data: { athleteId: r.athlete_id ?? null }, message: t("participants.invite.page.accepted") };
}

/**
 * The linked relative accepts the activity consents of their own held
 * booking (club setting ON + can_consent; health forms need can_see_medical).
 * The family is told who consented.
 */
export async function giveCarerConsent(requestId: string, acceptedKeys: string[]): Promise<RIResult> {
  const { me, t } = await session();
  if (!me) return { ok: false, code: "NOT_ALLOWED", error: t("participants.errors.NOT_ALLOWED") };
  if (!uuid.safeParse(requestId).success) return fail(t, "NOT_FOUND");
  const keys = keysSchema.safeParse(acceptedKeys);
  if (!keys.success) return fail(t, "CONSENT_REQUIRED");
  const res = await acceptAsCarer(me.orgId, requestId, keys.data);
  if (!res.ok) return fail(t, res.message);
  try { revalidatePath("/parent/bookings/others"); } catch { /* no request context */ }
  return { ok: true, data: undefined, message: t("participants.carerConsent.given") };
}

/** The linked relative asks the family after all: a fresh consent link e-mailed to the guardian. */
export async function askFamilyForConsent(requestId: string): Promise<RIResult> {
  const { me, t } = await session();
  if (!me) return { ok: false, code: "NOT_ALLOWED", error: t("participants.errors.NOT_ALLOWED") };
  if (!uuid.safeParse(requestId).success) return fail(t, "NOT_FOUND");
  const { token, hash } = newConsentToken();
  const db = await participantsDb();
  const { error } = await db.rpc("linker_consent_ask_family", { p_request: requestId, p_token_hash: hash });
  if (error) return fail(t, error);
  await sendConsentRequest(me.orgId, requestId, token);
  try { revalidatePath("/parent/bookings/others"); } catch { /* no request context */ }
  return { ok: true, data: undefined, message: t("participants.carerConsent.askedFamily") };
}
