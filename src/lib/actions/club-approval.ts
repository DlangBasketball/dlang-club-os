"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Json } from "@/types/database";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { assertFeature } from "@/lib/upgrades/server";
import { approvalsAdminDb, approvalsDb } from "@/lib/approvals/db";
import { notifyFamily, notifyReviewers } from "@/lib/approvals/notify";
import { approvalErrorKey } from "@/lib/approvals/errors";
import { issueContractsForRegistrations } from "@/lib/contracts/server";
import { revalidatePersonEverywhere } from "@/lib/people/revalidate";
import { logError } from "@/lib/log";
import type { Translator } from "@/lib/i18n/translator";
import type { ClubRequestProfile } from "@/lib/approvals/types";
import { isIsoDate, PE, SEXES, sportsSchema, sportsToRpc } from "@/lib/participants/validation";

/**
 * Club approval of family requests ("Join the club", club programme
 * enrolment). The club always comes from the session; the RPCs
 * (club_request_*) re-check the role, the family link, the reviewer
 * assignment, eligibility and capacity, and replay a request id.
 */
export type ApprovalResult<T = undefined> = { ok: true; message?: string; data?: T; replayed?: boolean } | { ok: false; error: string };

type RpcResult = {
  id: string; status: string; subject_kind: "membership" | "program_registration"; program_id: string | null;
  membership_type_id: string | null; family_id: string; athlete_id: string | null; membership_id: string | null;
  registration_id: string | null; invoice_id: string | null; invoice_number: string | null; registration_status: string | null;
  membership_status: string | null; notify_profile_ids: string[]; replayed?: boolean; decided?: boolean; reason?: string;
  taken?: number; capacity?: number;
  profile?: ClubRequestProfile["outcome"] | null;
};

/** RPC payload of proposed profile details (only what the family filled in). */
function profileToRpc(p: z.output<typeof profileInput>): Record<string, string | number | null> | null {
  const { dob, sex, ...sports } = p;
  const given = Object.fromEntries(Object.entries(sports).filter(([, val]) => val !== null && val !== undefined));
  const out: Record<string, string | number | null> = { ...sportsToRpc(given) };
  if (dob) out.dob = dob;
  if (sex) out.gender = sex;
  return Object.keys(out).length ? out : null;
}

/** What the reviewer is told after approving a request with proposed details. */
function profileOutcomeNotes(t: Translator, o: ClubRequestProfile["outcome"] | null): string[] {
  if (!o || o.status !== "approved") return [];
  const notes = [t("myAthletes.proposal.applied")];
  const j = o.jersey;
  if (j?.status === "taken") notes.push(t("myAthletes.proposal.jerseyTaken", { number: j.number }));
  else if (j?.status === "assigned") notes.push(t("myAthletes.proposal.jerseyAssigned", { number: j.number }));
  else if (j?.status === "reserved") notes.push(t("myAthletes.proposal.jerseyReserved", { number: j.number }));
  else if (j?.status === "no_team") notes.push(t("myAthletes.proposal.jerseyNoTeam", { number: j.number }));
  if (o.eligibility?.status === "review_pending") notes.push(t("myAthletes.proposal.eligibilityReview"));
  return notes;
}

async function session(roles: string[]) {
  const me = await getSessionUser();
  if (!me?.orgId || !roles.some((r) => me.roles.includes(r as never))) return null;
  if (!(await tenantMatchesOrg(me.orgId))) return null;
  return me as typeof me & { orgId: string };
}

async function failWith(key: string, orgId?: string | null): Promise<{ ok: false; error: string }> {
  const t = await getTranslations(orgId);
  return { ok: false, error: t.dynamic(key, undefined, t("approvals.errors.generic")) };
}

function revalidateApprovals() {
  for (const p of ["/admin/approvals", "/coach/approvals", "/parent/membership", "/parent/club-programmes", "/parent/bookings",
                   "/parent/invoices", "/admin/memberships", "/admin/registrations", "/admin/invoices"]) {
    revalidatePath(p);
  }
}

/** First names / subject of a request for notices (service read, same org). */
async function noticeContext(orgId: string, r: RpcResult): Promise<{ child: string; subject: string; amount: number | null; currency: string | null }> {
  const admin = approvalsAdminDb();
  const [ath, fam, prog, type, inv] = await Promise.all([
    r.athlete_id ? admin.from("athletes").select("first_name").eq("id", r.athlete_id).eq("org_id", orgId).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("families").select("name").eq("id", r.family_id).eq("org_id", orgId).maybeSingle(),
    r.program_id ? admin.from("programs").select("name").eq("id", r.program_id).eq("org_id", orgId).maybeSingle() : Promise.resolve({ data: null }),
    r.membership_type_id ? admin.from("membership_types").select("name").eq("id", r.membership_type_id).eq("org_id", orgId).maybeSingle() : Promise.resolve({ data: null }),
    r.invoice_id ? admin.from("invoices").select("total_chf,currency").eq("id", r.invoice_id).eq("org_id", orgId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const i = inv.data as { total_chf: number | string; currency: string | null } | null;
  return {
    child: (ath.data as { first_name?: string } | null)?.first_name ?? (fam.data as { name?: string } | null)?.name ?? "",
    subject: (prog.data as { name?: string } | null)?.name ?? (type.data as { name?: string } | null)?.name ?? "",
    amount: i ? Number(i.total_chf) : null,
    currency: i?.currency ?? null,
  };
}

// ---------------------------------------------------------------------------
// Family: submit / reply / withdraw
// ---------------------------------------------------------------------------
const uuid = z.string().uuid();
const message = z.string().trim().max(2000);
const profileInput = sportsSchema.partial().extend({
  dob: z.string().trim().optional().nullable().refine((v) => !v || isIsoDate(v), PE.invalidDob).transform((v) => v || null),
  sex: z.enum(["", ...SEXES], { message: PE.invalidSex }).optional().nullable().transform((v) => v || null),
});
const submitInput = z.object({
  kind: z.enum(["membership", "program_registration"]),
  /** Optional when athleteId is given: the database takes the athlete's family (and checks the caller guards it). */
  familyId: uuid.nullable().optional(),
  athleteId: uuid.nullable().optional(),
  programId: uuid.nullable().optional(),
  membershipTypeId: uuid.nullable().optional(),
  message: message.optional().default(""),
  /** Proposed profile details (pending; applied only when the club approves). */
  profile: profileInput.optional().nullable(),
  requestId: uuid,
});
export type SubmitClubRequestInput = z.input<typeof submitInput>;

/** Parent: "Join the club" or a club programme request. Saved as pending club approval; nothing is billed. */
export async function submitClubRequest(input: SubmitClubRequestInput): Promise<ApprovalResult<{ id: string }>> {
  const me = await session(["parent"]);
  if (!me) return failWith("approvals.errors.NOT_AUTHORIZED");
  const p = submitInput.safeParse(input);
  if (!p.success) {
    const issue = p.error.issues[0];
    return failWith(issue?.path[0] === "message" ? "approvals.errors.MESSAGE_TOO_LONG"
      : issue?.path[0] === "profile" ? issue.message : "approvals.errors.invalid", me.orgId);
  }
  const v = p.data;
  if (!v.familyId && !v.athleteId) return failWith("approvals.errors.FAMILY_NOT_FOUND", me.orgId);
  if (v.kind === "membership") await assertFeature("memberships");
  const proposal = v.profile ? profileToRpc(v.profile) : null;
  const db = await approvalsDb();
  const { data, error } = await db.rpc("club_request_submit", {
    p_payload: {
      kind: v.kind, family_id: v.familyId ?? null, athlete_id: v.athleteId ?? null,
      program_id: v.kind === "program_registration" ? v.programId ?? null : null,
      membership_type_id: v.kind === "membership" ? v.membershipTypeId ?? null : null,
      message: v.message || null,
      ...(proposal ? { profile: proposal } : {}),
    } as Json,
    p_request_id: v.requestId,
  });
  if (error) {
    logError("approvals.submit", error);
    return failWith(approvalErrorKey(error.message), me.orgId);
  }
  const r = data as unknown as RpcResult;
  if (!r.replayed) {
    const c = await noticeContext(me.orgId, r);
    await notifyReviewers({ orgId: me.orgId, profileIds: r.notify_profile_ids ?? [], event: "submitted", childName: c.child, subjectName: c.subject, kind: r.subject_kind });
  }
  revalidateApprovals();
  const t = await getTranslations(me.orgId);
  return { ok: true, message: t("approvals.family.submitted"), data: { id: r.id }, replayed: !!r.replayed };
}

const replyInput = z.object({ id: uuid, message: message.min(1), requestId: uuid });

/** Parent: answer the club's information request (back to pending review). */
export async function replyClubRequest(input: z.input<typeof replyInput>): Promise<ApprovalResult> {
  const me = await session(["parent"]);
  if (!me) return failWith("approvals.errors.NOT_AUTHORIZED");
  const p = replyInput.safeParse(input);
  if (!p.success) return failWith(p.error.issues[0]?.path[0] === "message" ? "approvals.errors.MESSAGE_REQUIRED" : "approvals.errors.invalid", me.orgId);
  const db = await approvalsDb();
  const { data, error } = await db.rpc("club_request_reply", { p_id: p.data.id, p_message: p.data.message, p_request_id: p.data.requestId });
  if (error) {
    logError("approvals.reply", error);
    return failWith(approvalErrorKey(error.message), me.orgId);
  }
  const r = data as unknown as RpcResult;
  if (!r.replayed) {
    const c = await noticeContext(me.orgId, r);
    await notifyReviewers({ orgId: me.orgId, profileIds: r.notify_profile_ids ?? [], event: "replied", childName: c.child, subjectName: c.subject, kind: r.subject_kind });
  }
  revalidateApprovals();
  const t = await getTranslations(me.orgId);
  return { ok: true, message: t("approvals.family.replied"), replayed: !!r.replayed };
}

const withdrawInput = z.object({ id: uuid, requestId: uuid });

export async function withdrawClubRequest(input: z.input<typeof withdrawInput>): Promise<ApprovalResult> {
  const me = await session(["parent"]);
  if (!me) return failWith("approvals.errors.NOT_AUTHORIZED");
  const p = withdrawInput.safeParse(input);
  if (!p.success) return failWith("approvals.errors.invalid", me.orgId);
  const db = await approvalsDb();
  const { error } = await db.rpc("club_request_withdraw", { p_id: p.data.id, p_request_id: p.data.requestId });
  if (error) return failWith(approvalErrorKey(error.message), me.orgId);
  revalidateApprovals();
  const t = await getTranslations(me.orgId);
  return { ok: true, message: t("approvals.family.withdrawn") };
}

// ---------------------------------------------------------------------------
// Reviewer: approve / request information / decline
// ---------------------------------------------------------------------------
const decideInput = z.object({
  id: uuid,
  decision: z.enum(["approve", "request_info", "decline"]),
  message: message.optional().default(""),
  requestId: uuid,
});
export type DecideClubRequestInput = z.input<typeof decideInput>;

/** Admin (any request) or the assigned coach (programme requests). A retry returns the first decision. */
export async function decideClubRequest(input: DecideClubRequestInput): Promise<ApprovalResult<{ outcome: "approved" | "confirmed" | "declined" | "info_requested" | "full" }>> {
  const me = await session(["admin", "coach"]);
  if (!me) return failWith("approvals.errors.NOT_AUTHORIZED");
  const p = decideInput.safeParse(input);
  if (!p.success) return failWith(p.error.issues[0]?.path[0] === "message" ? "approvals.errors.MESSAGE_TOO_LONG" : "approvals.errors.invalid", me.orgId);
  const v = p.data;
  const t = await getTranslations(me.orgId);
  const db = await approvalsDb();
  const { data, error } = await db.rpc("club_request_decide", {
    p_id: v.id, p_decision: v.decision, p_message: v.message || null, p_request_id: v.requestId,
  });
  if (error) {
    logError("approvals.decide", error);
    return failWith(approvalErrorKey(error.message), me.orgId);
  }
  const r = data as unknown as RpcResult;
  if (r.decided === false) {
    return { ok: true, data: { outcome: "full" }, message: t("approvals.reviewer.fullMessage", { taken: r.taken ?? 0, capacity: r.capacity ?? 0 }) };
  }
  const confirmed = r.registration_status === "confirmed" || r.membership_status === "active";
  const outcome = v.decision === "decline" ? "declined" : v.decision === "request_info" ? "info_requested" : confirmed ? "confirmed" : "approved";

  if (!r.replayed) {
    if (outcome === "approved" || outcome === "confirmed") {
      // Same follow-up as a staff enrolment (participation contracts; never fatal).
      if (r.registration_id) await issueContractsForRegistrations(me.orgId, [r.registration_id], me.id);
    }
    const c = await noticeContext(me.orgId, r);
    await notifyFamily({
      orgId: me.orgId, familyId: r.family_id, event: outcome, childName: c.child, subjectName: c.subject, message: v.message || null,
      invoiceNumber: r.invoice_number ?? null, amount: c.amount, currency: c.currency,
    });
  }
  revalidateApprovals();
  revalidatePersonEverywhere(me.orgId);
  if (r.athlete_id) {
    for (const path of [`/admin/athletes/${r.athlete_id}`, `/parent/children/${r.athlete_id}`, `/coach/development/athletes/${r.athlete_id}`]) revalidatePath(path);
  }
  const notes = profileOutcomeNotes(t, r.profile ?? null);
  return { ok: true, data: { outcome }, replayed: !!r.replayed, message: [t(`approvals.reviewer.done.${outcome}`), ...notes].join(" ") };
}

// ---------------------------------------------------------------------------
// Admin: programme setting
// ---------------------------------------------------------------------------
/** Switch the club approval of a programme on / off (family requests only; staff enrolment stays direct). */
export async function setProgramClubApproval(programId: string, value: boolean): Promise<ApprovalResult> {
  const me = await session(["admin"]);
  if (!me || !me.roles.includes("admin")) return failWith("approvals.errors.NOT_AUTHORIZED");
  if (!uuid.safeParse(programId).success || typeof value !== "boolean") return failWith("approvals.errors.invalid", me.orgId);
  const db = await approvalsDb();
  const { data, error } = await db.from("programs").update({ requires_club_approval: value } as never)
    .eq("id", programId).eq("org_id", me.orgId).select("id");
  if (error) return failWith(approvalErrorKey(error.message), me.orgId);
  if (!data?.length) return failWith("approvals.errors.REQUEST_NOT_FOUND", me.orgId);
  revalidatePath(`/admin/programs/${programId}`);
  revalidatePath("/parent/club-programmes");
  const t = await getTranslations(me.orgId);
  return { ok: true, message: t("approvals.program.saved") };
}
