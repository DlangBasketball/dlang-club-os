"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import type { AppRole } from "@/lib/auth/roles";
import { getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { logError } from "@/lib/log";
import { revalidatePersonEverywhere } from "@/lib/people/revalidate";
import type { Json } from "@/types/database";
import { participantsDb } from "@/lib/participants/db";
import {
  childLinkPermissionsSchema, childLinkToRpc, DEFAULT_CHILD_LINK, firstIssue, LINK_SCOPES, linkPermissionsSchema, linkRequestSchema,
  participantCreateSchema, participantErrorCode, participantUpdateSchema, selfProfileSchema, sportsSchema, sportsToRpc,
  type ChildLinkPermissions, type LinkPermissions, type LinkRequestInput, type LinkScope, type ParticipantCreateInput,
  type ParticipantOption, type ParticipantUpdateInput, type SelfProfileInput, type SportsInput,
} from "@/lib/participants/validation";
import {
  notifyAdminsOfChangeRequest, notifyFamilyOfChangeDecision, notifyGuardiansOfLinkRequest, notifyRequesterOfLinkDecision,
} from "@/lib/participants/notify";

/*
 * Participant profiles — server actions (migration 20250420105600). The org
 * is always the caller's session org; every RPC re-checks the caller, the
 * club and the permission in SQL. Writes that create something take a
 * client-generated requestId (one per user intent, reused on retry).
 * Result: { ok: true, data } | { ok: false, code, error } with error
 * translated from participants.errors.<CODE>.
 */
export type PResult<T = undefined> = { ok: true; data: T; message?: string } | { ok: false; code: string; error: string };

type Me = SessionUser & { orgId: string };
const FAMILY: AppRole[] = ["parent", "admin", "finance", "coach", "player"];
const uuid = z.string().uuid();

async function session(roles: AppRole[] = FAMILY): Promise<{ me: Me | null; t: Translator }> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId || !roles.some((r) => me.roles.includes(r))) return { me: null, t };
  return { me: me as Me, t };
}

function fail(t: Translator, error: { message?: string } | string | null | undefined): { ok: false; code: string; error: string } {
  const msg = typeof error === "string" ? error : error?.message ?? "";
  const code = participantErrorCode(msg);
  if (code) return { ok: false, code, error: t.dynamic(`participants.errors.${code}`, undefined, t("participants.errors.generic")) };
  if (msg) logError("participants", msg);
  return { ok: false, code: "GENERIC", error: t("participants.errors.generic") };
}
const denied = (t: Translator) => ({ ok: false as const, code: "NOT_ALLOWED", error: t("participants.errors.NOT_ALLOWED") });
const invalid = (t: Translator, key: string) => ({ ok: false as const, code: "INVALID_INPUT", error: t.dynamic(key, undefined, t("participants.errors.generic")) });

function refresh(orgId: string, athleteId?: string) {
  revalidatePersonEverywhere(orgId);
  if (athleteId) {
    for (const p of [`/parent/children/${athleteId}`, `/admin/athletes/${athleteId}`, `/coach/development/athletes/${athleteId}`]) {
      try { revalidatePath(p); } catch { /* no request context */ }
    }
  }
}

export type CreateParticipantData =
  | { status: "created"; participant: ParticipantOption; existing: boolean }
  | { status: "possible_match" };

/**
 * Add a child to the caller's family (parent app: My family, or inline in a
 * booking). A possible match in the club returns { status: "possible_match" }
 * with NO details; the UI then offers "Request link" or "This is a different
 * child" (input.decision = "different").
 */
export async function createParticipant(input: ParticipantCreateInput, requestId: string): Promise<PResult<CreateParticipantData>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  if (!uuid.safeParse(requestId).success) return fail(t, "REQUEST_ID_REQUIRED");
  const p = participantCreateSchema.safeParse(input);
  if (!p.success) return invalid(t, firstIssue(p.error));
  const d = p.data;
  const db = await participantsDb();
  const { data, error } = await db.rpc("participant_create", {
    p_payload: {
      first_name: d.firstName, last_name: d.lastName, dob: d.dob, gender: d.sex,
      ...sportsToRpc(d), ...(d.decision ? { decision: d.decision } : {}),
    } as Json,
    p_request_id: requestId,
  });
  if (error) return fail(t, error);
  const r = data as { ok: boolean; code?: string; athlete_id?: string; existing?: boolean };
  if (!r.ok) {
    if (r.code === "POSSIBLE_MATCH") return { ok: true, data: { status: "possible_match" } };
    return fail(t, r.code);
  }
  refresh(me.orgId, r.athlete_id);
  return {
    ok: true,
    message: t("participants.add.created"),
    data: { status: "created", existing: !!r.existing, participant: { id: r.athlete_id!, name: `${d.firstName} ${d.lastName}`, dob: d.dob, kind: "child" } },
  };
}

/** "Myself": the adult's own profile, created on first use (18+ on the activity date). */
export async function ensureSelfParticipant(input: SelfProfileInput, requestId: string): Promise<PResult<{ participant: ParticipantOption; created: boolean }>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  if (!uuid.safeParse(requestId).success) return fail(t, "REQUEST_ID_REQUIRED");
  const p = selfProfileSchema.safeParse(input);
  if (!p.success) return invalid(t, firstIssue(p.error));
  const d = p.data;
  const db = await participantsDb();
  const { data, error } = await db.rpc("participant_self_ensure", {
    p_payload: { first_name: d.firstName, last_name: d.lastName, dob: d.dob, gender: d.sex, at: d.at } as Json,
    p_request_id: requestId,
  });
  if (error) return fail(t, error);
  const r = data as { athlete_id: string; created: boolean };
  refresh(me.orgId, r.athlete_id);
  return { ok: true, data: { created: r.created, participant: { id: r.athlete_id, name: `${d.firstName} ${d.lastName}`, dob: d.dob, kind: "self" } } };
}

/** Ask to be linked to an existing child (opaque: the result never names the record). */
export async function requestParticipantLink(input: LinkRequestInput, requestId: string): Promise<PResult<{ linkRequestId: string }>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  if (!uuid.safeParse(requestId).success) return fail(t, "REQUEST_ID_REQUIRED");
  const p = linkRequestSchema.safeParse(input);
  if (!p.success) return invalid(t, firstIssue(p.error));
  const d = p.data;
  const db = await participantsDb();
  const { data, error } = await db.rpc("participant_link_request", {
    p_payload: { first_name: d.firstName, last_name: d.lastName, dob: d.dob, relation: d.relation } as Json,
    p_request_id: requestId,
  });
  if (error) return fail(t, error);
  const r = data as { link_request_id: string; replayed?: boolean };
  if (!r.replayed) await notifyGuardiansOfLinkRequest(me.orgId, r.link_request_id);
  revalidatePath("/admin/data-review");
  return { ok: true, message: t("participants.link.sent"), data: { linkRequestId: r.link_request_id } };
}

export async function withdrawLinkRequest(linkRequestId: string): Promise<PResult> {
  const { me, t } = await session();
  if (!me) return denied(t);
  if (!uuid.safeParse(linkRequestId).success) return fail(t, "NOT_FOUND");
  const db = await participantsDb();
  const { error } = await db.rpc("participant_link_withdraw", { p_request: linkRequestId });
  if (error) return fail(t, error);
  revalidatePath("/parent/family");
  return { ok: true, data: undefined };
}

/**
 * Decide a link request: a guardian of the child (parent app) or an admin
 * (data review). Approval adds the requester as a guardian member of the
 * child's family with the chosen permissions.
 */
export async function decideLinkRequest(
  linkRequestId: string, decision: "approve" | "decline", permissions?: Partial<LinkPermissions>, note?: string,
  scope: LinkScope = "family", childPermissions?: Partial<ChildLinkPermissions>,
): Promise<PResult<{ status: string }>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  if (!uuid.safeParse(linkRequestId).success || !["approve", "decline"].includes(decision)) return fail(t, "INVALID_DECISION");
  if (!(LINK_SCOPES as readonly string[]).includes(scope)) return fail(t, "INVALID_SCOPE");
  let payload: Record<string, unknown>;
  if (scope === "athlete") {
    // "This child only": per-child access (athlete_guardian_links), never the rest of the family.
    const child = childLinkPermissionsSchema.safeParse({ ...DEFAULT_CHILD_LINK, ...(childPermissions ?? {}) });
    if (!child.success) return fail(t, "REGISTER_NEEDS_PAY");
    payload = { scope: "athlete", ...childLinkToRpc(child.data) };
  } else {
    const perm = linkPermissionsSchema.safeParse(permissions ?? {});
    if (!perm.success) return fail(t, "INVALID_DECISION");
    payload = { scope: "family", can_pay: perm.data.canPay, can_see_medical: perm.data.canSeeMedical, receives_emails: perm.data.receivesEmails };
  }
  const db = await participantsDb();
  const { data, error } = await db.rpc("participant_link_decide", {
    p_request: linkRequestId, p_decision: decision,
    p_permissions: payload as Json,
    p_note: note?.trim() ? note.trim().slice(0, 1000) : null,
  });
  if (error) return fail(t, error);
  const r = data as { ok: boolean; code?: string; status: string; replayed?: boolean };
  if (!r.ok) return fail(t, r.code);
  if (!r.replayed) await notifyRequesterOfLinkDecision(me.orgId, linkRequestId);
  refresh(me.orgId);
  return { ok: true, message: (r.status === "approved" ? t("participants.link.approvedToast") : t("participants.link.declinedToast")), data: { status: r.status } };
}

/**
 * Change what an adult linked to one child may do (a family guardian of the
 * child or an admin; checked in SQL). Takes effect immediately; audited.
 */
export async function updateChildLink(linkId: string, permissions: ChildLinkPermissions): Promise<PResult> {
  const { me, t } = await session();
  if (!me) return denied(t);
  if (!uuid.safeParse(linkId).success) return fail(t, "NOT_FOUND");
  const p = childLinkPermissionsSchema.safeParse(permissions);
  if (!p.success) return fail(t, "REGISTER_NEEDS_PAY");
  const db = await participantsDb();
  const { error } = await db.rpc("athlete_link_update", { p_link: linkId, p_permissions: childLinkToRpc(p.data) as Json });
  if (error) return fail(t, error);
  refresh(me.orgId);
  for (const path of ["/parent/family", "/parent/athletes"]) { try { revalidatePath(path); } catch { /* no request context */ } }
  return { ok: true, data: undefined, message: t("participants.childLinks.saved") };
}

/**
 * End a per-child link at once: a family guardian of the child, an admin, or
 * the linked adult themselves. Pending holds of that adult for the child are
 * cancelled; bookings the guardian already consented to stay.
 */
export async function revokeChildLink(linkId: string, reason?: string): Promise<PResult> {
  const { me, t } = await session();
  if (!me) return denied(t);
  if (!uuid.safeParse(linkId).success) return fail(t, "NOT_FOUND");
  const db = await participantsDb();
  const { error } = await db.rpc("athlete_link_revoke", { p_link: linkId, p_reason: reason?.trim() ? reason.trim().slice(0, 500) : null });
  if (error) return fail(t, error);
  refresh(me.orgId);
  for (const path of ["/parent/family", "/parent/athletes", "/parent/bookings/others"]) { try { revalidatePath(path); } catch { /* no request context */ } }
  return { ok: true, data: undefined, message: t("participants.childLinks.revoked") };
}

export type UpdateParticipantData = { reviewRequired: boolean; changeRequestId: string | null };

/**
 * Parent / self profile edit: name, DOB, sex and sports fields. A DOB / sex
 * correction that affects a live club enrolment is sent to staff review
 * (reviewRequired) and is not applied; everything else is saved at once.
 */
export async function updateParticipant(athleteId: string, input: ParticipantUpdateInput, requestId: string): Promise<PResult<UpdateParticipantData>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  if (!uuid.safeParse(athleteId).success) return fail(t, "NOT_FOUND");
  if (!uuid.safeParse(requestId).success) return fail(t, "REQUEST_ID_REQUIRED");
  const p = participantUpdateSchema.safeParse(input);
  if (!p.success) return invalid(t, firstIssue(p.error));
  const d = p.data;
  const db = await participantsDb();
  const { data, error } = await db.rpc("participant_update", {
    p_athlete: athleteId,
    p_payload: { first_name: d.firstName, last_name: d.lastName, dob: d.dob, gender: d.sex, ...sportsToRpc(d) } as Json,
    p_request_id: requestId,
  });
  if (error) return fail(t, error);
  const r = data as { review_required: boolean; change_request_id: string | null; replayed?: boolean };
  if (r.review_required && !r.replayed) await notifyAdminsOfChangeRequest(me.orgId, athleteId);
  refresh(me.orgId, athleteId);
  revalidatePath("/admin/data-review");
  return {
    ok: true,
    message: r.review_required ? t("participants.edit.sentForReview") : t("participants.edit.saved"),
    data: { reviewRequired: r.review_required, changeRequestId: r.change_request_id },
  };
}

/** Sports fields only (coach of the player, guardian, self, staff). Never touches team jersey numbers. */
export async function updateParticipantSports(athleteId: string, input: SportsInput): Promise<PResult> {
  const { me, t } = await session();
  if (!me) return denied(t);
  if (!uuid.safeParse(athleteId).success) return fail(t, "NOT_FOUND");
  const p = sportsSchema.safeParse(input);
  if (!p.success) return invalid(t, firstIssue(p.error));
  const db = await participantsDb();
  const { error } = await db.rpc("participant_update_sports", { p_athlete: athleteId, p_payload: sportsToRpc(p.data) as Json });
  if (error) return fail(t, error);
  refresh(me.orgId, athleteId);
  return { ok: true, message: t("participants.edit.saved"), data: undefined };
}

/** Admin decision on a DOB / sex correction (applies it on approve; the family is notified). */
export async function decideChangeRequest(changeRequestId: string, decision: "approve" | "decline", note?: string): Promise<PResult<{ status: string }>> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  if (!uuid.safeParse(changeRequestId).success || !["approve", "decline"].includes(decision)) return fail(t, "INVALID_DECISION");
  const db = await participantsDb();
  const { data, error } = await db.rpc("participant_change_decide", {
    p_request: changeRequestId, p_decision: decision, p_note: note?.trim() ? note.trim().slice(0, 1000) : null,
  });
  if (error) return fail(t, error);
  const r = data as { status: string; replayed?: boolean; athlete_id?: string };
  if (!r.replayed) await notifyFamilyOfChangeDecision(me.orgId, changeRequestId);
  refresh(me.orgId, r.athlete_id);
  revalidatePath("/admin/data-review");
  return { ok: true, message: (r.status === "approved" ? t("participants.review.approvedToast") : t("participants.review.declinedToast")), data: { status: r.status } };
}

export async function withdrawChangeRequest(changeRequestId: string): Promise<PResult> {
  const { me, t } = await session();
  if (!me) return denied(t);
  if (!uuid.safeParse(changeRequestId).success) return fail(t, "NOT_FOUND");
  const db = await participantsDb();
  const { error } = await db.rpc("participant_change_withdraw", { p_request: changeRequestId });
  if (error) return fail(t, error);
  revalidatePath("/admin/data-review");
  refresh(me.orgId);
  return { ok: true, data: undefined };
}
