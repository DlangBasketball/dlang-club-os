"use server";

import { assertFeature } from "@/lib/upgrades/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLocaleContext } from "@/lib/i18n/server";
import { logError } from "@/lib/log";
import type { Json } from "@/types/database";
import { opsDb } from "@/lib/operations/db";
import { isJerseyNumberFree, type KitNumberRow } from "@/lib/operations/kit";
import { guardianProfileIds, notifyProfiles } from "@/lib/operations/notify";
import { dbFail, fail, gate, parseInput, writeAudit, type OpsResult } from "@/lib/operations/server";
import {
  checkinSchema,
  checkoutSchema,
  equipmentItemSchema,
  kitAssignmentSchema,
  kitRequestSchema,
  kitSizesSchema,
  kitStatusSchema,
  maintenanceSchema,
  uuid,
} from "@/lib/operations/validation";

/**
 * Equipment (club material) and kit (player jerseys, shorts, warm-ups).
 * Admins manage the catalogue and kit; coaches check material out and in
 * for themselves or their teams (RPCs enforce stock and ownership);
 * guardians send their child's sizes. Every change is audited.
 */

function revalidateEquipment() {
  revalidatePath("/admin/operations/equipment");
  revalidatePath("/admin/operations");
  revalidatePath("/coach/equipment");
}
function revalidateKit() {
  revalidatePath("/admin/operations/kit");
  revalidatePath("/parent/kit");
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------
export async function saveEquipmentItem(id: string | null, input: Record<string, unknown>): Promise<OpsResult<{ id: string }>> {
  await assertFeature("ops_equipment");
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (id && !uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const p = parseInput(equipmentItemSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const { currency } = await getLocaleContext(me.orgId);
  const row = {
    name: v.name, category: v.category, venue_id: v.venueId, quantity: v.quantity, condition: v.condition, purchase_date: v.purchaseDate,
    purchase_value: v.purchaseValue, currency: v.purchaseValue !== null ? currency : null, expense_id: v.expenseId, notes: v.notes, is_active: v.isActive,
  };
  const db = await opsDb();
  const res = id
    ? await db.from("equipment_items").update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from("equipment_items").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id");
  if (res.error) return dbFail(t, res.error.message);
  if (!res.data?.length) return fail(t, "operations.errors.notFound");
  const itemId = res.data[0].id;
  await writeAudit(me, id ? "equipment.update" : "equipment.create", "equipment_items", itemId, { quantity: v.quantity, condition: v.condition });
  revalidateEquipment();
  return { ok: true, message: t("operations.messages.saved"), data: { id: itemId } };
}

export async function checkOutEquipment(input: Record<string, unknown>): Promise<OpsResult<{ id: string }>> {
  await assertFeature("ops_equipment");
  const { me, t } = await gate(["admin", "coach"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  const p = parseInput(checkoutSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const db = await opsDb();
  const { data, error } = await db.rpc("equipment_check_out", {
    p_item: v.itemId, p_quantity: v.quantity, p_coach: v.coachId, p_team: v.teamId, p_due_on: v.dueOn, p_notes: v.notes,
  });
  if (error) return dbFail(t, error.message);
  revalidateEquipment();
  return { ok: true, message: t("operations.messages.checkedOut"), data: { id: String(data) } };
}

export async function checkInEquipment(input: Record<string, unknown>): Promise<OpsResult> {
  await assertFeature("ops_equipment");
  const { me, t } = await gate(["admin", "coach"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  const p = parseInput(checkinSchema, input, t);
  if (!p.ok) return p;
  const db = await opsDb();
  const { error } = await db.rpc("equipment_check_in", { p_checkout: p.data.checkoutId, p_condition: p.data.condition, p_notes: p.data.notes });
  if (error) return dbFail(t, error.message);
  revalidateEquipment();
  return { ok: true, message: t("operations.messages.checkedIn") };
}

export async function addMaintenance(input: Record<string, unknown>): Promise<OpsResult> {
  await assertFeature("ops_equipment");
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  const p = parseInput(maintenanceSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const db = await opsDb();
  const { data, error } = await db.from("equipment_maintenance")
    .insert({ org_id: me.orgId, item_id: v.itemId, performed_on: v.performedOn, note: v.note, cost: v.cost, created_by: me.id }).select("id");
  if (error || !data?.length) return dbFail(t, error?.message);
  await writeAudit(me, "equipment.maintenance", "equipment_items", v.itemId, { cost: v.cost });
  revalidateEquipment();
  revalidatePath(`/admin/operations/equipment/${v.itemId}`);
  return { ok: true, message: t("operations.messages.saved") };
}

// ---------------------------------------------------------------------------
// Kit
// ---------------------------------------------------------------------------
async function teamKitRows(teamId: string, orgId: string): Promise<KitNumberRow[]> {
  const db = await opsDb();
  const { data } = await db.from("kit_assignments").select("id,team_id,athlete_id,jersey_number,status").eq("org_id", orgId).eq("team_id", teamId);
  return (data ?? []).map((r) => ({ id: r.id, teamId: r.team_id, athleteId: r.athlete_id, jerseyNumber: r.jersey_number, status: r.status }));
}

export async function saveKitAssignment(id: string | null, input: Record<string, unknown>): Promise<OpsResult<{ id: string }>> {
  await assertFeature("ops_equipment");
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (id && !uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const p = parseInput(kitAssignmentSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const db = await opsDb();
  const { data: team } = await db.from("teams").select("id,season_id").eq("id", v.teamId).eq("org_id", me.orgId).maybeSingle();
  if (!team) return fail(t, "operations.errors.notFound");
  // One kit row per player and team: saving again for the same player edits it.
  if (!id) {
    const { data: existing } = await db.from("kit_assignments").select("id").eq("org_id", me.orgId).eq("team_id", v.teamId).eq("athlete_id", v.athleteId).maybeSingle();
    id = existing?.id ?? null;
  }
  if (v.jerseyNumber !== null && !isJerseyNumberFree(await teamKitRows(v.teamId, me.orgId), v.teamId, v.jerseyNumber, id)) {
    return fail(t, "operations.errors.jerseyTaken");
  }
  const { currency } = await getLocaleContext(me.orgId);
  const row = {
    team_id: v.teamId, season_id: team.season_id, athlete_id: v.athleteId, jersey_number: v.jerseyNumber, jersey_size: v.jerseySize,
    shorts_size: v.shortsSize, warmup_size: v.warmupSize, include_jersey: v.includeJersey, include_shorts: v.includeShorts,
    include_warmup: v.includeWarmup, deposit_amount: v.depositAmount, currency: v.depositAmount !== null ? currency : null, notes: v.notes,
  };
  const res = id
    ? await db.from("kit_assignments").update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from("kit_assignments").insert({ ...row, org_id: me.orgId }).select("id");
  if (res.error) return dbFail(t, res.error.message);
  if (!res.data?.length) return fail(t, "operations.errors.notFound");
  await writeAudit(me, id ? "kit.update" : "kit.create", "kit_assignments", res.data[0].id, { team_id: v.teamId, jersey_number: v.jerseyNumber });
  revalidateKit();
  return { ok: true, message: t("operations.messages.saved"), data: { id: res.data[0].id } };
}

/**
 * Start kit for a team: one assignment per active roster player (keeping
 * their roster jersey number when it is free) and a size request to their
 * guardians.
 */
export async function requestKitSizes(input: Record<string, unknown>): Promise<OpsResult<{ created: number }>> {
  await assertFeature("ops_equipment");
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  const p = parseInput(kitRequestSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const db = await opsDb();
  const { data: team } = await db.from("teams").select("id,name,season_id").eq("id", v.teamId).eq("org_id", me.orgId).maybeSingle();
  if (!team) return fail(t, "operations.errors.notFound");
  const [{ data: roster }, existing] = await Promise.all([
    db.from("team_memberships").select("athlete_id,jersey_number,status").eq("org_id", me.orgId).eq("team_id", v.teamId).neq("status", "inactive"),
    teamKitRows(v.teamId, me.orgId),
  ]);
  const have = new Set(existing.map((r) => r.athleteId));
  const rows = [...existing];
  const { currency } = await getLocaleContext(me.orgId);
  const inserts = [];
  for (const m of roster ?? []) {
    if (have.has(m.athlete_id)) continue;
    const num = m.jersey_number !== null && isJerseyNumberFree(rows, v.teamId, m.jersey_number) ? m.jersey_number : null;
    rows.push({ id: m.athlete_id, teamId: v.teamId, athleteId: m.athlete_id, jerseyNumber: num, status: "sizes_requested" });
    inserts.push({
      org_id: me.orgId, team_id: v.teamId, season_id: team.season_id, athlete_id: m.athlete_id, jersey_number: num,
      include_warmup: v.includeWarmup, deposit_amount: v.depositAmount, currency: v.depositAmount !== null ? currency : null,
    });
  }
  if (inserts.length) {
    const { error } = await db.from("kit_assignments").insert(inserts);
    if (error) return dbFail(t, error.message);
  }
  const athleteIds = inserts.map((r) => r.athlete_id);
  const guardians = await guardianProfileIds(me.orgId, athleteIds);
  await notifyProfiles(me.orgId, guardians, (tt) => ({
    title: tt("operations.notify.kitSizesTitle", { team: team.name }),
    body: tt("operations.notify.kitSizesBody"),
    link: "/parent/kit",
  }));
  await writeAudit(me, "kit.request_sizes", "teams", v.teamId, { created: inserts.length, notified: guardians.length });
  revalidateKit();
  return { ok: true, message: t("operations.messages.kitRequested", { count: inserts.length }), data: { created: inserts.length } };
}

export async function setKitStatus(input: Record<string, unknown>): Promise<OpsResult> {
  await assertFeature("ops_equipment");
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  const p = parseInput(kitStatusSchema, input, t);
  if (!p.ok) return p;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: p.data.status };
  if (p.data.status === "handed_out") Object.assign(patch, { handed_out_at: now, returned_at: null });
  if (p.data.status === "returned") patch.returned_at = now;
  const db = await opsDb();
  const { data, error } = await db.from("kit_assignments").update(patch).eq("id", p.data.id).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(t, error.message);
  if (!data?.length) return fail(t, "operations.errors.notFound");
  await writeAudit(me, "kit.status", "kit_assignments", p.data.id, { status: p.data.status });
  revalidateKit();
  return { ok: true, message: t("operations.messages.saved") };
}

export async function deleteKitAssignment(id: string): Promise<OpsResult> {
  await assertFeature("ops_equipment");
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (!uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const db = await opsDb();
  const { data, error } = await db.from("kit_assignments").delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(t, error.message);
  if (!data?.length) return fail(t, "operations.errors.notFound");
  await writeAudit(me, "kit.delete", "kit_assignments", id);
  revalidateKit();
  return { ok: true, message: t("operations.messages.deleted") };
}

/** Kit deposit as a line on a draft invoice for the player's family. */
export async function invoiceKitDeposit(id: string): Promise<OpsResult<{ invoiceId: string }>> {
  await assertFeature("ops_equipment");
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (!uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const db = await opsDb();
  const { data: kit } = await db.from("kit_assignments").select("id,athlete_id,team_id,deposit_amount,deposit_invoice_id,jersey_number")
    .eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!kit) return fail(t, "operations.errors.notFound");
  if (kit.deposit_invoice_id) return fail(t, "operations.errors.alreadyInvoiced");
  if (!kit.deposit_amount || kit.deposit_amount <= 0) return fail(t, "operations.errors.noDeposit");
  const [{ data: athlete }, { data: team }] = await Promise.all([
    db.from("athletes").select("id,family_id").eq("id", kit.athlete_id).eq("org_id", me.orgId).maybeSingle(),
    db.from("teams").select("name").eq("id", kit.team_id).eq("org_id", me.orgId).maybeSingle(),
  ]);
  if (!athlete?.family_id) return fail(t, "operations.errors.notFound");
  const label = t("operations.kit.depositLine", { team: team?.name ?? "" });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_manual_invoice", {
    // Kit deposits are billed under the shop revenue category (migration 20250420103500).
    p_payload: { family_id: athlete.family_id, athlete_id: athlete.id, activity: "shop", description: label, items: [{ description: label, quantity: 1, unit_price_chf: kit.deposit_amount }] } as unknown as Json,
  });
  const invoiceId = (data as { invoice_id?: string } | null)?.invoice_id;
  if (error || !invoiceId) {
    logError("operations.kit.deposit", error);
    return dbFail(t, error?.message);
  }
  await db.from("kit_assignments").update({ deposit_invoice_id: invoiceId }).eq("id", id).eq("org_id", me.orgId);
  await writeAudit(me, "kit.deposit_invoice", "kit_assignments", id, { invoice_id: invoiceId, amount: kit.deposit_amount });
  revalidateKit();
  revalidatePath("/admin/invoices");
  return { ok: true, message: t("operations.messages.depositInvoiced"), data: { invoiceId } };
}

/** Guardian quick form: sizes for one child's kit. */
export async function submitKitSizes(input: Record<string, unknown>): Promise<OpsResult> {
  await assertFeature("ops_equipment");
  const { me, t } = await gate(["parent", "admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  const p = parseInput(kitSizesSchema, input, t);
  if (!p.ok) return p;
  const db = await opsDb();
  const { error } = await db.rpc("kit_submit_sizes", {
    p_assignment: p.data.assignmentId, p_jersey: p.data.jerseySize, p_shorts: p.data.shortsSize, p_warmup: p.data.warmupSize,
  });
  if (error) return dbFail(t, error.message);
  await writeAudit(me, "kit.sizes_submitted", "kit_assignments", p.data.assignmentId);
  revalidateKit();
  return { ok: true, message: t("operations.messages.sizesSent") };
}
