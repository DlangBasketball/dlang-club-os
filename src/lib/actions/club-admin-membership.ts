"use server";

import { randomUUID } from "node:crypto";
import { assertFeature } from "@/lib/upgrades/server";
import { submitClubRequest } from "@/lib/actions/club-approval";
import { revalidatePath } from "next/cache";
import type { Json } from "@/types/database";
import { logError } from "@/lib/log";
import { caAdminDb, caDb } from "@/lib/club-admin/db";
import { audit, dbErrorKey, done, fail, requireMe, type CaResult, type Me } from "@/lib/club-admin/server";
import { familyRecipients, sendNotice } from "@/lib/club-admin/notify";
import {
  firstIssueKey, idList, membershipCancelSchema, membershipCreateSchema, membershipTypeSchema, uuid,
  type MembershipCreateInput, type MembershipTypeInput,
} from "@/lib/club-admin/validation";

/**
 * Club membership: types (admin), join / renew (admin, or the family's
 * guardian), cancellation, renewal campaign reminders. Money moves only
 * through public.membership_create() (service; invoice in the same
 * transaction). The org always comes from the session.
 */
function revalidateMembership() {
  revalidatePath("/admin/memberships");
  revalidatePath("/parent/membership");
  revalidatePath("/parent/invoices");
  revalidatePath("/admin/invoices");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export async function saveMembershipType(id: string | null, input: MembershipTypeInput): Promise<CaResult<{ id: string }>> {
  await assertFeature("memberships");
  const me = await requireMe(["admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  if (id && !uuid.safeParse(id).success) return fail("clubadmin.errors.invalid");
  const p = membershipTypeSchema.safeParse(input);
  if (!p.success) return fail(firstIssueKey(p.error));
  const v = p.data;
  const row = {
    name: v.name, description: v.description, kind: v.kind, scope: v.scope, price: v.price, currency: v.currency,
    period: v.period, season_start_month: v.seasonStartMonth, min_age: v.minAge, max_age: v.maxAge, is_active: v.isActive, sort: v.sort,
  };
  const db = await caDb();
  const res = id
    ? await db.from("membership_types").update(row).eq("id", id).eq("org_id", me.orgId).select("id").maybeSingle()
    : await db.from("membership_types").insert({ ...row, org_id: me.orgId }).select("id").single();
  if (res.error || !res.data) {
    if (res.error) logError("clubadmin.saveMembershipType", res.error);
    return fail(res.error ? dbErrorKey(res.error.message) : "clubadmin.errors.notFound");
  }
  await audit(me, id ? "membership_type.update" : "membership_type.create", "membership_types", res.data.id);
  revalidateMembership();
  return done("clubadmin.saved", { id: res.data.id });
}

// ---------------------------------------------------------------------------
// Join / renew
// ---------------------------------------------------------------------------
type CreateOut = { membership_id: string; invoice_id: string | null; invoice_number: string | null; amount: number; currency: string; family_id: string; athlete_id: string | null };

async function notifyInvoice(me: Me, out: CreateOut, typeName: string) {
  if (!out.invoice_id) return;
  await sendNotice({
    orgId: me.orgId, kind: "membershipInvoice", recipients: await familyRecipients(me.orgId, out.family_id),
    params: { name: typeName, invoice: out.invoice_number, amount: Number(out.amount), currency: out.currency },
    link: `/parent/invoices/${out.invoice_id}`, invoiceId: out.invoice_id,
  });
}

async function typeName(orgId: string, typeId: string): Promise<string> {
  const { data } = await caAdminDb().from("membership_types").select("name").eq("id", typeId).eq("org_id", orgId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? "";
}

/** Admin: enrol a family / athlete (optionally free, e.g. honorary). */
export async function createMembership(input: MembershipCreateInput): Promise<CaResult<{ id: string; invoiceId: string | null }>> {
  await assertFeature("memberships");
  const me = await requireMe(["admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  const p = membershipCreateSchema.safeParse(input);
  if (!p.success) return fail(firstIssueKey(p.error));
  const v = p.data;
  const { data, error } = await caAdminDb().rpc("membership_create", {
    p_payload: { org_id: me.orgId, type_id: v.typeId, family_id: v.familyId, athlete_id: v.athleteId, valid_from: v.validFrom, free: v.free, created_by: me.id } as Json,
  });
  if (error) return fail(dbErrorKey(error.message));
  const out = data as unknown as CreateOut;
  await notifyInvoice(me, out, await typeName(me.orgId, v.typeId));
  revalidateMembership();
  return done("clubadmin.membership.created", { id: out.membership_id, invoiceId: out.invoice_id });
}

/**
 * Parent: join the club for a child (person type) or the household (family
 * type). A family-initiated join is a request pending club approval
 * (club_request_submit); the membership and its invoice are created with the
 * rules above only when an admin confirms it. Kept for existing callers.
 */
export async function joinMembership(input: { typeId: string; familyId: string; athleteId?: string | null }): Promise<CaResult<{ invoiceId: string | null }>> {
  await assertFeature("memberships");
  const me = await requireMe(["parent"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  const p = membershipCreateSchema.safeParse({ ...input, free: false, validFrom: null });
  if (!p.success) return fail(firstIssueKey(p.error));
  const v = p.data;
  const res = await submitClubRequest({
    kind: "membership", familyId: v.familyId, membershipTypeId: v.typeId, athleteId: v.athleteId ?? null, requestId: randomUUID(),
  });
  if (!res.ok) return res;
  revalidateMembership();
  return { ok: true, message: res.message, data: { invoiceId: null } };
}

/** One-click renewal (admin, or a guardian of the membership's family). */
export async function renewMembership(id: string): Promise<CaResult<{ invoiceId: string | null }>> {
  await assertFeature("memberships");
  const me = await requireMe(["admin", "parent"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  if (!uuid.safeParse(id).success) return fail("clubadmin.errors.invalid");
  // RLS: admin / finance of the club or the family's guardians see the row.
  const db = await caDb();
  const { data: m } = await db.from("memberships").select("id,family_id,membership_type_id").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!m) return fail("clubadmin.errors.notFound");
  if (!me.roles.includes("admin")) {
    const { data: link } = await db.from("family_members").select("family_id").eq("family_id", m.family_id).eq("profile_id", me.id).maybeSingle();
    if (!link) return fail("clubadmin.errors.forbidden");
  }
  const { data, error } = await caAdminDb().rpc("membership_create", {
    p_payload: { org_id: me.orgId, renew_from_id: id, created_by: me.id } as Json,
  });
  if (error) return fail(dbErrorKey(error.message));
  const out = data as unknown as CreateOut;
  await notifyInvoice(me, out, await typeName(me.orgId, m.membership_type_id));
  revalidateMembership();
  return done("clubadmin.membership.renewed", { invoiceId: out.invoice_id });
}

export async function cancelMembership(id: string, reason: string): Promise<CaResult> {
  await assertFeature("memberships");
  const me = await requireMe(["admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  const p = membershipCancelSchema.safeParse({ id, reason });
  if (!p.success) return fail(firstIssueKey(p.error));
  const db = await caDb();
  const { data, error } = await db.from("memberships")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: p.data.reason })
    .eq("id", id).eq("org_id", me.orgId).neq("status", "cancelled").select("id");
  if (error) return fail(dbErrorKey(error.message));
  if (!data?.length) return fail("clubadmin.errors.notFound");
  await audit(me, "membership.cancel", "memberships", id);
  revalidateMembership();
  return done("clubadmin.membership.cancelled");
}

/** Renewal campaign: remind the families of the selected expiring memberships. */
export async function sendRenewalReminders(ids: string[]): Promise<CaResult<{ sent: number }>> {
  await assertFeature("memberships");
  const me = await requireMe(["admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  const p = idList.safeParse(ids);
  if (!p.success) return fail(firstIssueKey(p.error));
  const db = await caDb();
  const { data: rows } = await db.from("memberships").select("id,family_id,valid_until,membership_type_id,status")
    .eq("org_id", me.orgId).in("id", p.data).in("status", ["active", "expired"]);
  const names = new Map<string, string>();
  let sent = 0;
  for (const m of rows ?? []) {
    if (!names.has(m.membership_type_id)) names.set(m.membership_type_id, await typeName(me.orgId, m.membership_type_id));
    sent += await sendNotice({
      orgId: me.orgId, kind: "membershipRenewal", recipients: await familyRecipients(me.orgId, m.family_id),
      params: { name: names.get(m.membership_type_id), date: m.valid_until }, link: "/parent/membership",
    });
    await caAdminDb().from("memberships").update({ renewal_reminded_at: new Date().toISOString() }).eq("id", m.id).eq("org_id", me.orgId);
  }
  await audit(me, "membership.renewal_reminders", "memberships", null, { count: rows?.length ?? 0 });
  revalidateMembership();
  return done("clubadmin.membership.remindersSent", { sent }, { count: rows?.length ?? 0 });
}
