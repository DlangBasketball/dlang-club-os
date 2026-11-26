"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, writeAudit, type ActionResult } from "@/lib/people/server";
import {
  athleteSchema,
  licenceSchema,
  medicalSchema,
  firstIssueKey,
  isPhotoPathFor,
  PHOTO_BUCKET,
  type AthleteInput,
  type LicenceInput,
  type MedicalInput,
} from "@/lib/people/validation";
import { logError } from "@/lib/log";
import { revalidatePersonEverywhere } from "@/lib/people/revalidate";

export type { AthleteInput, LicenceInput, MedicalInput } from "@/lib/people/validation";

/** The family must belong to the caller's org (checked through RLS + org filter). */
async function familyInOrg(familyId: string, orgId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("families").select("id").eq("id", familyId).eq("org_id", orgId).maybeSingle();
  return !!data;
}

function toRow(d: ReturnType<typeof athleteSchema.parse>) {
  return {
    family_id: d.familyId,
    first_name: d.firstName,
    last_name: d.lastName,
    dob: d.dob,
    gender: d.gender,
    nationality: d.nationality,
    school: d.school,
    jersey_size: d.jerseySize,
    dominant_hand: d.dominantHand,
    position_pref: d.positionPref,
    status: d.status,
    notes: d.notes,
    ...(d.heightCm !== undefined ? { height_cm: d.heightCm } : {}),
    ...(d.weightKg !== undefined ? { weight_kg: d.weightKg } : {}),
    ...(d.preferredJerseyNumber !== undefined ? { preferred_jersey_number: d.preferredJerseyNumber } : {}),
  };
}

/** Staff duplicate check (same club, same name and DOB): names shown to staff only. */
async function nameDobDuplicates(firstName: string, lastName: string, dob: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("people_duplicate_check" as never, { p_payload: { first_name: firstName, last_name: lastName, dob } } as never);
  const rows = ((data as { athletes?: { first_name: string; last_name: string; dob: string; reason: string; family_name: string | null }[] } | null)?.athletes ?? [])
    .filter((x) => x.reason === "NAME_DOB");
  return rows.map((x) => `${x.first_name} ${x.last_name}${x.family_name ? ` (${x.family_name})` : ""}`);
}

export async function createAthlete(input: AthleteInput): Promise<ActionResult<{ id: string }>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const p = athleteSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(firstIssueKey(p.error)) };
  if (!(await familyInOrg(p.data.familyId, me.orgId))) return { ok: false, error: t("editPeople.errors.familyNotFound") };
  if (!p.data.confirmDuplicate) {
    const dups = await nameDobDuplicates(p.data.firstName, p.data.lastName, p.data.dob);
    if (dups.length) return { ok: false, error: t("participants.admin.duplicateWarning", { names: dups.join(", ") }) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("athletes")
    .insert({ ...toRow(p.data), org_id: me.orgId })
    .select("id")
    .single();
  if (error || !data) {
    logError("createAthlete", error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  revalidatePersonEverywhere(me.orgId);
  redirect(`/admin/athletes/${data.id}`);
}

export async function updateAthlete(id: string, input: AthleteInput): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const p = athleteSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(firstIssueKey(p.error)) };
  if (!(await familyInOrg(p.data.familyId, me.orgId))) return { ok: false, error: t("editPeople.errors.familyNotFound") };

  const supabase = await createClient();
  const { data: before } = await supabase.from("athletes").select("family_id").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!before) return { ok: false, error: t("editPeople.errors.notFound") };
  const { error } = await supabase.from("athletes").update(toRow(p.data)).eq("id", id).eq("org_id", me.orgId);
  if (error) {
    logError("updateAthlete", error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  if (before.family_id !== p.data.familyId) {
    await writeAudit(me, "athlete.family.move", "athletes", id, { from: before.family_id, to: p.data.familyId });
    revalidatePath(`/admin/families/${before.family_id}`);
  }
  revalidatePersonEverywhere(me.orgId);
  return { ok: true, message: t("editPeople.saved") };
}

// Deleting a player: src/lib/actions/person-delete.ts (archive / erase everywhere).

/** Medical record: admin only here (guardians edit their own child from the parent app). */
export async function upsertMedical(athleteId: string, input: MedicalInput): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const p = medicalSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(firstIssueKey(p.error)) };
  const supabase = await createClient();
  const { data: a } = await supabase.from("athletes").select("id").eq("id", athleteId).eq("org_id", me.orgId).maybeSingle();
  if (!a) return { ok: false, error: t("editPeople.errors.notFound") };
  const d = p.data;
  const { error } = await supabase.from("athlete_medical").upsert(
    {
      org_id: me.orgId,
      athlete_id: athleteId,
      allergies: d.allergies,
      conditions: d.conditions,
      medications: d.medications,
      insurance: d.insurance,
      emergency_contact_name: d.emergencyContactName,
      emergency_contact_phone: d.emergencyContactPhone,
      notes: d.notes,
      updated_by: me.id,
    },
    { onConflict: "athlete_id" },
  );
  if (error) {
    logError("upsertMedical", error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  revalidatePath(`/admin/athletes/${athleteId}`);
  return { ok: true, message: t("editPeople.saved") };
}

/**
 * Federation licence (admin only). The number is unique per club: a clash is
 * reported as a friendly error. Audited in audit_logs (plus the row trigger).
 */
export async function updateAthleteLicence(athleteId: string, input: LicenceInput): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const p = licenceSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(firstIssueKey(p.error)) };
  const d = p.data;
  const supabase = await createClient();
  const { data: before } = await supabase
    .from("athletes")
    .select("id,licence_number,licence_category,licence_federation,licence_issued_on,licence_fee")
    .eq("id", athleteId)
    .eq("org_id", me.orgId)
    .maybeSingle();
  if (!before) return { ok: false, error: t("editPeople.errors.notFound") };
  const row = {
    licence_number: d.number,
    licence_category: d.category,
    licence_federation: d.federation,
    licence_issued_on: d.issuedOn,
    licence_fee: d.fee,
  };
  const { error } = await supabase.from("athletes").update(row).eq("id", athleteId).eq("org_id", me.orgId);
  if (error) {
    if (error.code === "23505") return { ok: false, error: t("editPeople.licence.duplicate") };
    logError("updateAthleteLicence", error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  const old = {
    licence_number: before.licence_number,
    licence_category: before.licence_category,
    licence_federation: before.licence_federation,
    licence_issued_on: before.licence_issued_on,
    licence_fee: before.licence_fee,
  };
  await writeAudit(me, "athlete.licence.update", "athletes", athleteId, { before: old, after: row });
  revalidatePath(`/admin/athletes/${athleteId}`);
  revalidatePath("/admin/athletes");
  return { ok: true, message: t("editPeople.saved") };
}
