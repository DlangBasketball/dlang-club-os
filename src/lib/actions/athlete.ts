"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";
import type { ActionResult } from "./family";

async function gate(adminOnly = false) {
  const me = await getSessionUser();
  const allowed =
    !!me &&
    (adminOnly
      ? me.roles.includes("admin")
      : me.roles.includes("admin") || me.roles.includes("finance"));
  return { me: allowed ? me : null };
}

export type AthleteInput = {
  familyId: string;
  firstName: string;
  lastName: string;
  dob: string;
  gender?: string;
  nationality?: string;
  school?: string;
  jerseySize?: string;
  dominantHand?: string;
  positionPref?: string;
  status?: string;
  notes?: string;
};

function toRow(input: AthleteInput, orgId: string | null) {
  return {
    org_id: orgId,
    family_id: input.familyId,
    first_name: input.firstName,
    last_name: input.lastName,
    dob: input.dob,
    gender: input.gender || null,
    nationality: input.nationality || null,
    school: input.school || null,
    jersey_size: input.jerseySize || null,
    dominant_hand: input.dominantHand || null,
    position_pref: input.positionPref || null,
    status: input.status || "active",
    notes: input.notes || null,
  };
}

export async function createAthlete(input: AthleteInput): Promise<ActionResult> {
  const { me } = await gate();
  if (!me) return { ok: false, error: "You don't have permission to do that." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("athletes")
    .insert(toRow(input, me.orgId))
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/families/${input.familyId}`);
  redirect(`/admin/athletes/${data.id}`);
}

export async function updateAthlete(id: string, input: AthleteInput): Promise<ActionResult> {
  const { me } = await gate();
  if (!me) return { ok: false, error: "You don't have permission to do that." };
  const supabase = await createClient();
  const { error } = await supabase.from("athletes").update(toRow(input, me.orgId)).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/athletes/${id}`);
  redirect(`/admin/athletes/${id}`);
}

export async function deleteAthlete(id: string): Promise<ActionResult> {
  const { me } = await gate(true);
  if (!me) return { ok: false, error: "Only admins can delete athletes." };
  const supabase = await createClient();
  const { data: a } = await supabase.from("athletes").select("family_id").eq("id", id).maybeSingle();
  const { error } = await supabase.from("athletes").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  const familyId = (a as { family_id?: string } | null)?.family_id;
  revalidatePath("/admin/families");
  redirect(familyId ? `/admin/families/${familyId}` : "/admin/families");
}

export type MedicalInput = {
  allergies?: string;
  conditions?: string;
  medications?: string;
  insurance?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  notes?: string;
};

export async function upsertMedical(athleteId: string, input: MedicalInput): Promise<ActionResult> {
  const { me } = await gate(true); // medical writes: admin (RLS also allows guardian elsewhere)
  if (!me) return { ok: false, error: "Only admins can edit medical info here." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("athlete_medical")
    .upsert(
      {
        org_id: me.orgId,
        athlete_id: athleteId,
        allergies: input.allergies || null,
        conditions: input.conditions || null,
        medications: input.medications || null,
        insurance: input.insurance || null,
        emergency_contact_name: input.emergencyContactName || null,
        emergency_contact_phone: input.emergencyContactPhone || null,
        notes: input.notes || null,
      },
      { onConflict: "athlete_id" },
    );
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/athletes/${athleteId}`);
  redirect(`/admin/athletes/${athleteId}`);
}
