"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getI18n, getLocaleContext } from "@/lib/i18n/server";
import { zonedWallTimeToUtc } from "@/lib/format";
import { logError } from "@/lib/log";
import type { Json } from "@/types/database";
import type { AlertRow } from "@/lib/messaging/db";
import { dispatchAlert } from "@/lib/messaging/notify";
import { opsDb } from "@/lib/operations/db";
import { dbFail, fail, gate, gateCommittee, parseInput, writeAudit, type OpsResult } from "@/lib/operations/server";
import {
  attendeeSchema,
  committeeSchema,
  decisionSchema,
  DECISION_STATUSES,
  documentSchema,
  meetingSchema,
  memberSchema,
  minutesSchema,
  uuid,
  voteSchema,
} from "@/lib/operations/validation";

/**
 * Board & committees. Admins set up committees and their members; current
 * members of a committee (and admins) run its meetings: agenda, attendance,
 * minutes, decisions log, documents and votes (AGM kit). Access is decided by
 * the database (RLS: public.can_access_committee); gateCommittee() checks it
 * up front so a non-member gets a clean "not permitted".
 */

function revalidateBoard(committeeId?: string, meetingId?: string) {
  revalidatePath("/board");
  if (committeeId) revalidatePath(`/board/${committeeId}`);
  if (meetingId) revalidatePath(`/board/meetings/${meetingId}`);
}

async function committeeOfMeeting(meetingId: string): Promise<string | null> {
  if (!uuid.safeParse(meetingId).success) return null;
  const db = await opsDb();
  const { data } = await db.from("committee_meetings").select("committee_id").eq("id", meetingId).maybeSingle();
  return data?.committee_id ?? null;
}

// ---------------------------------------------------------------------------
// Committees + members (admin)
// ---------------------------------------------------------------------------
export async function saveCommittee(id: string | null, input: Record<string, unknown>): Promise<OpsResult<{ id: string }>> {
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (id && !uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const p = parseInput(committeeSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const row = { name: v.name, kind: v.kind, description: v.description, is_active: v.isActive };
  const db = await opsDb();
  const res = id
    ? await db.from("committees").update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from("committees").insert({ ...row, org_id: me.orgId }).select("id");
  if (res.error) return dbFail(t, res.error.message);
  if (!res.data?.length) return fail(t, "operations.errors.notFound");
  await writeAudit(me, id ? "committee.update" : "committee.create", "committees", res.data[0].id, { kind: v.kind });
  revalidateBoard(res.data[0].id);
  return { ok: true, message: t("operations.messages.saved"), data: { id: res.data[0].id } };
}

export async function saveMember(id: string | null, input: Record<string, unknown>): Promise<OpsResult<{ id: string }>> {
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (id && !uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const p = parseInput(memberSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const row = {
    committee_id: v.committeeId, profile_id: v.profileId, display_name: v.displayName, role: v.role, email: v.email, starts_on: v.startsOn, ends_on: v.endsOn,
  };
  const db = await opsDb();
  const res = id
    ? await db.from("committee_members").update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from("committee_members").insert({ ...row, org_id: me.orgId }).select("id");
  if (res.error) return dbFail(t, res.error.message);
  if (!res.data?.length) return fail(t, "operations.errors.notFound");
  await writeAudit(me, id ? "committee.member.update" : "committee.member.add", "committee_members", res.data[0].id, { role: v.role, committee_id: v.committeeId });
  revalidateBoard(v.committeeId);
  return { ok: true, message: t("operations.messages.saved"), data: { id: res.data[0].id } };
}

export async function removeMember(id: string): Promise<OpsResult> {
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (!uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const db = await opsDb();
  const { data, error } = await db.from("committee_members").delete().eq("id", id).eq("org_id", me.orgId).select("committee_id");
  if (error) return dbFail(t, error.message);
  if (!data?.length) return fail(t, "operations.errors.notFound");
  await writeAudit(me, "committee.member.remove", "committee_members", id);
  revalidateBoard(data[0].committee_id);
  return { ok: true, message: t("operations.messages.deleted") };
}

// ---------------------------------------------------------------------------
// Meetings (committee members + admins)
// ---------------------------------------------------------------------------
export async function saveMeeting(id: string | null, input: Record<string, unknown>): Promise<OpsResult<{ id: string }>> {
  const committeeId = typeof input.committeeId === "string" ? input.committeeId : "";
  const { me, t } = await gateCommittee(uuid.safeParse(committeeId).success ? committeeId : "00000000-0000-0000-0000-000000000000");
  if (!me) return fail(t, "operations.errors.forbidden");
  if (id && (await committeeOfMeeting(id)) !== committeeId) return fail(t, "operations.errors.notFound");
  const p = parseInput(meetingSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const { timeZone } = await getLocaleContext(me.orgId);
  const [d, tm] = v.startsAt.split("T");
  const startsAt = zonedWallTimeToUtc(d, tm, timeZone);
  if (!startsAt) return fail(t, "operations.errors.invalid");
  const row = {
    committee_id: v.committeeId, title: v.title, kind: v.kind, starts_at: startsAt.toISOString(), location: v.location, status: v.status,
    agenda: v.agenda as unknown as Json,
  };
  const db = await opsDb();
  const res = id
    ? await db.from("committee_meetings").update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from("committee_meetings").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id");
  if (res.error) return dbFail(t, res.error.message);
  if (!res.data?.length) return fail(t, "operations.errors.notFound");
  await writeAudit(me, id ? "committee.meeting.update" : "committee.meeting.create", "committee_meetings", res.data[0].id, { kind: v.kind });
  revalidateBoard(v.committeeId, res.data[0].id);
  return { ok: true, message: t("operations.messages.saved"), data: { id: res.data[0].id } };
}

export async function saveMinutes(input: Record<string, unknown>): Promise<OpsResult> {
  const committeeId = await committeeOfMeeting(String(input.meetingId ?? ""));
  const { me, t } = await gateCommittee(committeeId ?? "00000000-0000-0000-0000-000000000000");
  if (!me || !committeeId) return fail(t, "operations.errors.forbidden");
  const p = parseInput(minutesSchema, input, t);
  if (!p.ok) return p;
  const patch: Record<string, unknown> = { minutes: p.data.minutes.trim() || null };
  if (p.data.approve) Object.assign(patch, { minutes_approved_at: new Date().toISOString(), status: "held" });
  const db = await opsDb();
  const { data, error } = await db.from("committee_meetings").update(patch).eq("id", p.data.meetingId).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(t, error.message);
  if (!data?.length) return fail(t, "operations.errors.notFound");
  await writeAudit(me, p.data.approve ? "committee.minutes.approve" : "committee.minutes.save", "committee_meetings", p.data.meetingId);
  revalidateBoard(committeeId, p.data.meetingId);
  return { ok: true, message: t(p.data.approve ? "operations.messages.minutesApproved" : "operations.messages.saved") };
}

export async function addAttendee(input: Record<string, unknown>): Promise<OpsResult> {
  const committeeId = await committeeOfMeeting(String(input.meetingId ?? ""));
  const { me, t } = await gateCommittee(committeeId ?? "00000000-0000-0000-0000-000000000000");
  if (!me || !committeeId) return fail(t, "operations.errors.forbidden");
  const p = parseInput(attendeeSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const db = await opsDb();
  const { data, error } = await db.from("committee_meeting_attendees").insert({
    org_id: me.orgId, meeting_id: v.meetingId, member_id: v.memberId, display_name: v.displayName, status: v.status, proxy_for: v.proxyFor,
  }).select("id");
  if (error || !data?.length) return dbFail(t, error?.message);
  await writeAudit(me, "committee.attendee.add", "committee_meetings", v.meetingId, { status: v.status });
  revalidateBoard(committeeId, v.meetingId);
  return { ok: true, message: t("operations.messages.saved") };
}

/** Attendance list pre-filled with the committee's current members. */
export async function fillAttendeesFromMembers(meetingId: string): Promise<OpsResult<{ added: number }>> {
  const committeeId = await committeeOfMeeting(meetingId);
  const { me, t } = await gateCommittee(committeeId ?? "00000000-0000-0000-0000-000000000000");
  if (!me || !committeeId) return fail(t, "operations.errors.forbidden");
  const db = await opsDb();
  const [{ data: members }, { data: existing }] = await Promise.all([
    db.from("committee_members").select("id,display_name,ends_on").eq("org_id", me.orgId).eq("committee_id", committeeId),
    db.from("committee_meeting_attendees").select("member_id").eq("org_id", me.orgId).eq("meeting_id", meetingId),
  ]);
  const have = new Set((existing ?? []).map((a) => a.member_id));
  const today = new Date().toISOString().slice(0, 10);
  const rows = (members ?? []).filter((m) => !have.has(m.id) && (!m.ends_on || m.ends_on >= today))
    .map((m) => ({ org_id: me.orgId, meeting_id: meetingId, member_id: m.id, display_name: m.display_name, status: "absent" }));
  if (rows.length) {
    const { error } = await db.from("committee_meeting_attendees").insert(rows);
    if (error) return dbFail(t, error.message);
  }
  await writeAudit(me, "committee.attendees.fill", "committee_meetings", meetingId, { added: rows.length });
  revalidateBoard(committeeId, meetingId);
  return { ok: true, message: t("operations.messages.attendeesAdded", { count: rows.length }), data: { added: rows.length } };
}

export async function setAttendeeStatus(id: string, status: string): Promise<OpsResult> {
  const { me, t } = await gate(["admin", "finance", "coach", "parent"]);
  if (!me || !uuid.safeParse(id).success || !["present", "absent", "excused", "proxy"].includes(status)) return fail(t, "operations.errors.forbidden");
  const db = await opsDb();
  // RLS (can_access_meeting) decides; a non-member updates nothing.
  const { data, error } = await db.from("committee_meeting_attendees").update({ status }).eq("id", id).eq("org_id", me.orgId).select("meeting_id");
  if (error) return dbFail(t, error.message);
  if (!data?.length) return fail(t, "operations.errors.forbidden");
  await writeAudit(me, "committee.attendee.status", "committee_meetings", data[0].meeting_id, { status });
  revalidateBoard(undefined, data[0].meeting_id);
  return { ok: true };
}

export async function removeAttendee(id: string): Promise<OpsResult> {
  const { me, t } = await gate(["admin", "finance", "coach", "parent"]);
  if (!me || !uuid.safeParse(id).success) return fail(t, "operations.errors.forbidden");
  const db = await opsDb();
  const { data, error } = await db.from("committee_meeting_attendees").delete().eq("id", id).eq("org_id", me.orgId).select("meeting_id");
  if (error) return dbFail(t, error.message);
  if (!data?.length) return fail(t, "operations.errors.forbidden");
  await writeAudit(me, "committee.attendee.remove", "committee_meetings", data[0].meeting_id);
  revalidateBoard(undefined, data[0].meeting_id);
  return { ok: true, message: t("operations.messages.deleted") };
}

// ---------------------------------------------------------------------------
// Decisions log, votes, documents
// ---------------------------------------------------------------------------
export async function saveDecision(id: string | null, input: Record<string, unknown>): Promise<OpsResult<{ id: string }>> {
  const committeeId = typeof input.committeeId === "string" ? input.committeeId : "";
  const { me, t } = await gateCommittee(uuid.safeParse(committeeId).success ? committeeId : "00000000-0000-0000-0000-000000000000");
  if (!me) return fail(t, "operations.errors.forbidden");
  if (id && !uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const p = parseInput(decisionSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const row = {
    committee_id: v.committeeId, meeting_id: v.meetingId, title: v.title, description: v.description, owner_member_id: v.ownerMemberId,
    due_on: v.dueOn, status: v.status, completed_at: v.status === "done" ? new Date().toISOString() : null,
  };
  const db = await opsDb();
  const res = id
    ? await db.from("committee_decisions").update(row).eq("id", id).eq("org_id", me.orgId).eq("committee_id", committeeId).select("id")
    : await db.from("committee_decisions").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id");
  if (res.error) return dbFail(t, res.error.message);
  if (!res.data?.length) return fail(t, "operations.errors.notFound");
  await writeAudit(me, id ? "committee.decision.update" : "committee.decision.create", "committee_decisions", res.data[0].id, { status: v.status });
  revalidateBoard(v.committeeId, v.meetingId ?? undefined);
  return { ok: true, message: t("operations.messages.saved"), data: { id: res.data[0].id } };
}

export async function setDecisionStatus(id: string, status: string): Promise<OpsResult> {
  const { me, t } = await gate(["admin", "finance", "coach", "parent"]);
  if (!me || !uuid.safeParse(id).success || !(DECISION_STATUSES as readonly string[]).includes(status)) return fail(t, "operations.errors.forbidden");
  const db = await opsDb();
  const { data, error } = await db.from("committee_decisions")
    .update({ status, completed_at: status === "done" ? new Date().toISOString() : null }).eq("id", id).eq("org_id", me.orgId).select("committee_id,meeting_id");
  if (error) return dbFail(t, error.message);
  if (!data?.length) return fail(t, "operations.errors.forbidden");
  await writeAudit(me, "committee.decision.status", "committee_decisions", id, { status });
  revalidateBoard(data[0].committee_id, data[0].meeting_id ?? undefined);
  return { ok: true, message: t("operations.messages.saved") };
}

export async function saveVote(input: Record<string, unknown>): Promise<OpsResult> {
  const committeeId = await committeeOfMeeting(String(input.meetingId ?? ""));
  const { me, t } = await gateCommittee(committeeId ?? "00000000-0000-0000-0000-000000000000");
  if (!me || !committeeId) return fail(t, "operations.errors.forbidden");
  const p = parseInput(voteSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const db = await opsDb();
  const { count } = await db.from("committee_votes").select("id", { count: "exact", head: true }).eq("meeting_id", v.meetingId);
  const { data, error } = await db.from("committee_votes").insert({
    org_id: me.orgId, meeting_id: v.meetingId, motion: v.motion, votes_for: v.votesFor, votes_against: v.votesAgainst,
    abstentions: v.abstentions, notes: v.notes, sort_order: count ?? 0,
  }).select("id");
  if (error || !data?.length) return dbFail(t, error?.message);
  await writeAudit(me, "committee.vote.record", "committee_votes", data[0].id, { for: v.votesFor, against: v.votesAgainst, abstentions: v.abstentions });
  revalidateBoard(committeeId, v.meetingId);
  return { ok: true, message: t("operations.messages.voteRecorded") };
}

export async function deleteVote(id: string): Promise<OpsResult> {
  const { me, t } = await gate(["admin", "finance", "coach", "parent"]);
  if (!me || !uuid.safeParse(id).success) return fail(t, "operations.errors.forbidden");
  const db = await opsDb();
  const { data, error } = await db.from("committee_votes").delete().eq("id", id).eq("org_id", me.orgId).select("meeting_id");
  if (error) return dbFail(t, error.message);
  if (!data?.length) return fail(t, "operations.errors.forbidden");
  await writeAudit(me, "committee.vote.delete", "committee_votes", id);
  revalidateBoard(undefined, data[0].meeting_id);
  return { ok: true, message: t("operations.messages.deleted") };
}

export async function addDocument(input: Record<string, unknown>): Promise<OpsResult> {
  const committeeId = typeof input.committeeId === "string" ? input.committeeId : "";
  const { me, t } = await gateCommittee(uuid.safeParse(committeeId).success ? committeeId : "00000000-0000-0000-0000-000000000000");
  if (!me) return fail(t, "operations.errors.forbidden");
  const p = parseInput(documentSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const db = await opsDb();
  const { data, error } = await db.from("committee_documents").insert({
    org_id: me.orgId, committee_id: v.committeeId, meeting_id: v.meetingId, title: v.title, url: v.url, created_by: me.id,
  }).select("id");
  if (error || !data?.length) return dbFail(t, error?.message);
  await writeAudit(me, "committee.document.add", "committee_documents", data[0].id);
  revalidateBoard(v.committeeId, v.meetingId ?? undefined);
  return { ok: true, message: t("operations.messages.saved") };
}

export async function deleteDocument(id: string): Promise<OpsResult> {
  const { me, t } = await gate(["admin", "finance", "coach", "parent"]);
  if (!me || !uuid.safeParse(id).success) return fail(t, "operations.errors.forbidden");
  const db = await opsDb();
  const { data, error } = await db.from("committee_documents").delete().eq("id", id).eq("org_id", me.orgId).select("committee_id,meeting_id");
  if (error) return dbFail(t, error.message);
  if (!data?.length) return fail(t, "operations.errors.forbidden");
  await writeAudit(me, "committee.document.delete", "committee_documents", id);
  revalidateBoard(data[0].committee_id, data[0].meeting_id ?? undefined);
  return { ok: true, message: t("operations.messages.deleted") };
}

/**
 * AGM invitation to every club member, sent as a club alert (in-app + email
 * by each member's preferences) with the date, place and agenda.
 */
export async function sendAgmInvitation(meetingId: string): Promise<OpsResult> {
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (!uuid.safeParse(meetingId).success) return fail(t, "operations.errors.notFound");
  const db = await opsDb();
  const { data: m } = await db.from("committee_meetings").select("*").eq("id", meetingId).eq("org_id", me.orgId).maybeSingle();
  if (!m || m.kind === "meeting") return fail(t, "operations.errors.notFound");
  if (m.invitation_sent_at) return fail(t, "operations.errors.alreadySent");
  const { t: tt, f } = await getI18n(me.orgId);
  const agenda = (Array.isArray(m.agenda) ? (m.agenda as { title?: string }[]) : []).map((a, i) => `${i + 1}. ${a.title ?? ""}`).join("\n");
  const body = [
    tt("operations.board.invitation.body", { date: f.dateTime(m.starts_at), location: m.location ?? tt("operations.board.locationTbd") }),
    agenda ? `${tt("operations.board.agenda")}:\n${agenda}` : null,
  ].filter(Boolean).join("\n\n").slice(0, 2000);
  const { data, error } = await db.from("club_alerts").insert({
    org_id: me.orgId, title: tt("operations.board.invitation.title", { title: m.title }).slice(0, 140), body, severity: "info", audience: "all",
    team_id: null, program_id: null, camp_edition_id: null, starts_at: new Date().toISOString(), expires_at: m.starts_at, created_by: me.id,
  }).select("*").single();
  if (error || !data) return dbFail(t, error?.message);
  const alert = data as AlertRow;
  after(() => dispatchAlert(alert).then(() => undefined).catch((e) => logError("operations.agm.dispatch", e)));
  await db.from("committee_meetings").update({ invitation_sent_at: new Date().toISOString() }).eq("id", meetingId).eq("org_id", me.orgId);
  await writeAudit(me, "committee.agm.invite", "committee_meetings", meetingId, { alert_id: alert.id });
  revalidateBoard(m.committee_id, meetingId);
  revalidatePath("/admin/alerts");
  return { ok: true, message: t("operations.messages.invitationSent") };
}
