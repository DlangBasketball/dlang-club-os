"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { campsDb } from "@/lib/camps/db";
import {
  ageGroupSchema, campErrorKey, editionRow, editionSchema, firstIssueKey, priceOptionSchema, timeSlotSchema,
  type AgeGroupInput, type EditionInput, type PriceOptionInput, type TimeSlotInput,
} from "@/lib/camps/validation";

/**
 * Camp admin: editions, price options, age groups, time slots. Admin of the
 * current club only; the org comes from the session and RLS re-checks it
 * (camp_*_insert/update/delete policies). Every row is looked up by id AND
 * org before it is changed.
 */
export type CampActionResult = { ok: true; id?: string; archived?: boolean } | { ok: false; error: string };

const uuid = z.string().uuid();

async function requireAdmin() {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return null;
  if (!(await tenantMatchesOrg(me.orgId))) return null;
  return me as typeof me & { orgId: string };
}

async function fail(key: string, orgId?: string | null): Promise<CampActionResult> {
  const t = await getTranslations(orgId);
  return { ok: false, error: t.dynamic(key, undefined, t("camps.errors.generic")) };
}

function revalidateCamp(programId: string, editionId?: string) {
  revalidatePath(`/admin/programs/${programId}`);
  revalidatePath("/admin/programs");
  if (editionId) revalidatePath(`/admin/programs/${programId}/editions/${editionId}`);
  revalidatePath("/register", "layout");
  revalidatePath("/parent/camps", "layout");
}

/** The programme must be a camp of the caller's org. */
async function campOf(programId: string, orgId: string) {
  if (!uuid.safeParse(programId).success) return false;
  const db = await campsDb();
  const { data } = await db.from("programs").select("id").eq("id", programId).eq("org_id", orgId).eq("kind", "camp").maybeSingle();
  return !!data;
}

// ---------------------------------------------------------------------------
// Editions
// ---------------------------------------------------------------------------
export async function saveEdition(programId: string, editionId: string | null, input: EditionInput): Promise<CampActionResult> {
  const me = await requireAdmin();
  if (!me) return fail("camps.errors.notPermitted");
  if (!(await campOf(programId, me.orgId))) return fail("camps.errors.notFound", me.orgId);
  if (editionId && !uuid.safeParse(editionId).success) return fail("camps.errors.invalidRequest", me.orgId);
  const p = editionSchema.safeParse(input);
  if (!p.success) return fail(firstIssueKey(p.error), me.orgId);
  const db = await campsDb();
  if (p.data.venueId) {
    const { data: v } = await db.from("venues").select("id").eq("id", p.data.venueId).eq("org_id", me.orgId).maybeSingle();
    if (!v) return fail("camps.errors.notFound", me.orgId);
  }
  const row = editionRow(p.data);
  if (editionId) {
    const { data, error } = await db.from("camp_editions").update(row).eq("id", editionId).eq("org_id", me.orgId).eq("program_id", programId).select("id");
    if (error) return fail(campErrorKey(error.message), me.orgId);
    if (!data?.length) return fail("camps.errors.notFound", me.orgId);
    revalidateCamp(programId, editionId);
    return { ok: true, id: editionId };
  }
  const { data, error } = await db.from("camp_editions").insert({ ...row, org_id: me.orgId, program_id: programId }).select("id").single();
  if (error || !data) return fail(campErrorKey(error?.message), me.orgId);
  revalidateCamp(programId);
  return { ok: true, id: data.id };
}

/** Copies an edition (as a draft, one week later by default) with its own price options / time slots. */
export async function duplicateEdition(editionId: string, startsOn?: string): Promise<CampActionResult> {
  const me = await requireAdmin();
  if (!me) return fail("camps.errors.notPermitted");
  if (!uuid.safeParse(editionId).success) return fail("camps.errors.invalidRequest", me.orgId);
  const db = await campsDb();
  const { data: e } = await db.from("camp_editions").select("*").eq("id", editionId).eq("org_id", me.orgId).maybeSingle();
  if (!e) return fail("camps.errors.notFound", me.orgId);
  const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
  const target = startsOn && /^\d{4}-\d{2}-\d{2}$/.test(startsOn) ? startsOn : shift(e.starts_on, 7);
  const delta = Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${e.starts_on}T00:00:00Z`)) / 864e5);
  const moveTs = (ts: string | null) => (ts ? new Date(Date.parse(ts) + delta * 864e5).toISOString() : null);
  const { data: copy, error } = await db.from("camp_editions").insert({
    org_id: me.orgId, program_id: e.program_id, name: e.name, starts_on: target, ends_on: shift(e.ends_on, delta),
    venue_id: e.venue_id, location_name: e.location_name, address: e.address, city: e.city, capacity: e.capacity,
    registration_opens_at: e.registration_opens_at ? moveTs(e.registration_opens_at) : null,
    registration_closes_at: moveTs(e.registration_closes_at), status: "draft", notes: e.notes,
  }).select("id").single();
  if (error || !copy) return fail(campErrorKey(error?.message), me.orgId);
  const [{ data: opts }, { data: slots }] = await Promise.all([
    db.from("camp_price_options").select("*").eq("org_id", me.orgId).eq("edition_id", editionId),
    db.from("camp_time_slots").select("*").eq("org_id", me.orgId).eq("edition_id", editionId),
  ]);
  if (opts?.length) {
    await db.from("camp_price_options").insert(opts.map((o) => ({
      org_id: me.orgId, program_id: o.program_id, edition_id: copy.id, label: o.label, days_count: o.days_count,
      includes_lunch: o.includes_lunch, price: o.price, currency: o.currency, is_active: o.is_active, sort: o.sort,
    })));
  }
  if (slots?.length) {
    await db.from("camp_time_slots").insert(slots.map((s) => ({
      org_id: me.orgId, program_id: s.program_id, edition_id: copy.id, label: s.label, starts_at: s.starts_at, ends_at: s.ends_at, sort: s.sort,
    })));
  }
  revalidateCamp(e.program_id);
  return { ok: true, id: copy.id };
}

/** Deletes an edition without registrations; with registrations it is archived. */
export async function deleteEdition(editionId: string): Promise<CampActionResult> {
  const me = await requireAdmin();
  if (!me) return fail("camps.errors.notPermitted");
  if (!uuid.safeParse(editionId).success) return fail("camps.errors.invalidRequest", me.orgId);
  const db = await campsDb();
  const { data: e } = await db.from("camp_editions").select("id,program_id").eq("id", editionId).eq("org_id", me.orgId).maybeSingle();
  if (!e) return fail("camps.errors.notFound", me.orgId);
  const { count } = await db.from("registrations").select("id", { count: "exact", head: true }).eq("org_id", me.orgId).eq("camp_edition_id", editionId);
  const archive = async (): Promise<CampActionResult> => {
    const { error } = await db.from("camp_editions").update({ status: "archived" }).eq("id", editionId).eq("org_id", me.orgId);
    if (error) return fail(campErrorKey(error.message), me.orgId);
    revalidateCamp(e.program_id, editionId);
    return { ok: true, id: editionId, archived: true };
  };
  if ((count ?? 0) > 0) return archive();
  const { error } = await db.from("camp_editions").delete().eq("id", editionId).eq("org_id", me.orgId);
  if (error) return /EDITION_HAS_REGISTRATIONS/.test(error.message) ? archive() : fail(campErrorKey(error.message), me.orgId);
  revalidateCamp(e.program_id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Price options / age groups / time slots: upsert one row, delete one row
// ---------------------------------------------------------------------------
async function editionOf(db: Awaited<ReturnType<typeof campsDb>>, editionId: string | null, programId: string, orgId: string) {
  if (!editionId) return true;
  const { data } = await db.from("camp_editions").select("id").eq("id", editionId).eq("program_id", programId).eq("org_id", orgId).maybeSingle();
  return !!data;
}

export async function savePriceOption(programId: string, input: PriceOptionInput): Promise<CampActionResult> {
  const me = await requireAdmin();
  if (!me) return fail("camps.errors.notPermitted");
  if (!(await campOf(programId, me.orgId))) return fail("camps.errors.notFound", me.orgId);
  const p = priceOptionSchema.safeParse(input);
  if (!p.success) return fail(firstIssueKey(p.error), me.orgId);
  const db = await campsDb();
  if (!(await editionOf(db, p.data.editionId, programId, me.orgId))) return fail("camps.errors.notFound", me.orgId);
  const row = {
    edition_id: p.data.editionId, label: p.data.label, days_count: p.data.daysCount, includes_lunch: p.data.includesLunch,
    price: p.data.price, currency: p.data.currency, is_active: p.data.isActive, sort: p.data.sort,
  };
  const res = p.data.id
    ? await db.from("camp_price_options").update(row).eq("id", p.data.id).eq("org_id", me.orgId).eq("program_id", programId).select("id")
    : await db.from("camp_price_options").insert({ ...row, org_id: me.orgId, program_id: programId }).select("id");
  if (res.error) return fail(campErrorKey(res.error.message), me.orgId);
  if (!res.data?.length) return fail("camps.errors.notFound", me.orgId);
  revalidateCamp(programId);
  return { ok: true, id: res.data[0].id };
}

export async function saveAgeGroup(programId: string, input: AgeGroupInput): Promise<CampActionResult> {
  const me = await requireAdmin();
  if (!me) return fail("camps.errors.notPermitted");
  if (!(await campOf(programId, me.orgId))) return fail("camps.errors.notFound", me.orgId);
  const p = ageGroupSchema.safeParse(input);
  if (!p.success) return fail(firstIssueKey(p.error), me.orgId);
  const db = await campsDb();
  const row = { label: p.data.label, min_age: p.data.minAge, max_age: p.data.maxAge, time_slot_id: p.data.timeSlotId, is_active: p.data.isActive, sort: p.data.sort };
  const res = p.data.id
    ? await db.from("camp_age_groups").update(row).eq("id", p.data.id).eq("org_id", me.orgId).eq("program_id", programId).select("id")
    : await db.from("camp_age_groups").insert({ ...row, org_id: me.orgId, program_id: programId }).select("id");
  if (res.error) return fail(campErrorKey(res.error.message), me.orgId);
  if (!res.data?.length) return fail("camps.errors.notFound", me.orgId);
  revalidateCamp(programId);
  return { ok: true, id: res.data[0].id };
}

export async function saveTimeSlot(programId: string, input: TimeSlotInput): Promise<CampActionResult> {
  const me = await requireAdmin();
  if (!me) return fail("camps.errors.notPermitted");
  if (!(await campOf(programId, me.orgId))) return fail("camps.errors.notFound", me.orgId);
  const p = timeSlotSchema.safeParse(input);
  if (!p.success) return fail(firstIssueKey(p.error), me.orgId);
  const db = await campsDb();
  if (!(await editionOf(db, p.data.editionId, programId, me.orgId))) return fail("camps.errors.notFound", me.orgId);
  const row = { edition_id: p.data.editionId, label: p.data.label, starts_at: p.data.startsAt, ends_at: p.data.endsAt, sort: p.data.sort };
  const res = p.data.id
    ? await db.from("camp_time_slots").update(row).eq("id", p.data.id).eq("org_id", me.orgId).eq("program_id", programId).select("id")
    : await db.from("camp_time_slots").insert({ ...row, org_id: me.orgId, program_id: programId }).select("id");
  if (res.error) return fail(campErrorKey(res.error.message), me.orgId);
  if (!res.data?.length) return fail("camps.errors.notFound", me.orgId);
  revalidateCamp(programId);
  return { ok: true, id: res.data[0].id };
}

const ROW_TABLES = { option: "camp_price_options", ageGroup: "camp_age_groups", timeSlot: "camp_time_slots" } as const;

/**
 * Removes a price option / age group / time slot. Registrations keep their
 * price snapshot (the link is set null), so history is not lost.
 */
export async function deleteCampRow(programId: string, kind: keyof typeof ROW_TABLES, id: string): Promise<CampActionResult> {
  const me = await requireAdmin();
  if (!me) return fail("camps.errors.notPermitted");
  if (!uuid.safeParse(id).success || !(kind in ROW_TABLES)) return fail("camps.errors.invalidRequest", me.orgId);
  const db = await campsDb();
  const { data, error } = await db.from(ROW_TABLES[kind]).delete().eq("id", id).eq("org_id", me.orgId).eq("program_id", programId).select("id");
  if (error) return fail(campErrorKey(error.message), me.orgId);
  if (!data?.length) return fail("camps.errors.notFound", me.orgId);
  revalidateCamp(programId);
  return { ok: true };
}
