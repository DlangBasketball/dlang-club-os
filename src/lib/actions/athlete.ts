"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, writeAudit, type ActionResult } from "@/lib/people/server";
import {
  athleteSchema,
  medicalSchema,
  firstIssueKey,
  isPhotoPathFor,
  PHOTO_BUCKET,
  type AthleteInput,
  type MedicalInput,
} from "@/lib/people/validation";
import { logError } from "@/lib/log";

export type { AthleteInput, MedicalInput } from "@/lib/people/validation";

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
  };
}

export async function createAthlete(input: AthleteInput): Promise<ActionResult<{ id: string }>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const p = athleteSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(firstIssueKey(p.error)) };
  if (!(await familyInOrg(p.data.familyId, me.orgId))) return { ok: false, error: t("editPeople.errors.familyNotFound") };

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
  revalidatePath(`/admin/families/${p.data.familyId}`);
  revalidatePath("/admin/athletes");
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
  revalidatePath(`/admin/athletes/${id}`);
  revalidatePath(`/admin/families/${p.data.familyId}`);
  revalidatePath("/admin/athletes");
  return { ok: true, message: t("editPeople.saved") };
}

export async function deleteAthlete(id: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const supabase = await createClient();
  const { data: a } = await supabase.from("athletes").select("family_id,photo_path").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!a) return { ok: false, error: t("editPeople.errors.notFound") };
  const { error } = await supabase.from("athletes").delete().eq("id", id).eq("org_id", me.orgId);
  if (error) {
    logError("deleteAthlete", error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  if (a.photo_path && isPhotoPathFor(a.photo_path, me.orgId, id)) {
    const rm = await supabase.storage.from(PHOTO_BUCKET).remove([a.photo_path]);
    if (rm.error) logError("deleteAthlete.photo", rm.error);
  }
  await writeAudit(me, "athlete.delete", "athletes", id, { family_id: a.family_id });
  revalidatePath("/admin/families");
  revalidatePath("/admin/athletes");
  redirect(`/admin/families/${a.family_id}`);
}

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
