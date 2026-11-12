"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, writeAudit, type ActionResult as PeopleResult } from "@/lib/people/server";
import {
  familySchema,
  guardianLinkSchema,
  guardianUpdateSchema,
  firstIssueKey,
  isPhotoPathFor,
  PHOTO_BUCKET,
  type FamilyInput,
  type GuardianLinkInput,
  type GuardianUpdateInput,
} from "@/lib/people/validation";
import { logError } from "@/lib/log";

export type ActionResult = PeopleResult;
export type { FamilyInput } from "@/lib/people/validation";

function toRow(d: ReturnType<typeof familySchema.parse>) {
  return {
    name: d.name,
    address: d.address,
    phone: d.phone,
    contact_name: d.contactName,
    contact_email: d.contactEmail,
  };
}

/** Family core + billing contact: admin or finance (billing details). */
export async function createFamily(input: FamilyInput): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin", "finance"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const p = familySchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(firstIssueKey(p.error)) };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("families")
    .insert({ ...toRow(p.data), org_id: me.orgId })
    .select("id")
    .single();
  if (error || !data) {
    logError("createFamily", error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  revalidatePath("/admin/families");
  redirect(`/admin/families/${data.id}`);
}

export async function updateFamily(id: string, input: FamilyInput): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin", "finance"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const p = familySchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(firstIssueKey(p.error)) };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("families")
    .update(toRow(p.data))
    .eq("id", id)
    .eq("org_id", me.orgId)
    .select("id");
  if (error) {
    logError("updateFamily", error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  if (!data?.length) return { ok: false, error: t("editPeople.errors.notFound") };
  revalidatePath(`/admin/families/${id}`);
  revalidatePath("/admin/families");
  return { ok: true, message: t("editPeople.saved") };
}

export async function deleteFamily(id: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const supabase = await createClient();
  const { data: athletes } = await supabase.from("athletes").select("id,photo_path").eq("family_id", id).eq("org_id", me.orgId);
  const { data, error } = await supabase.from("families").delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) {
    logError("deleteFamily", error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  if (!data?.length) return { ok: false, error: t("editPeople.errors.notFound") };
  // Athletes cascade with the family: remove their photo objects as well.
  const photos = (athletes ?? [])
    .filter((a) => isPhotoPathFor(a.photo_path, me.orgId, a.id))
    .map((a) => a.photo_path as string);
  if (photos.length) {
    const rm = await supabase.storage.from(PHOTO_BUCKET).remove(photos);
    if (rm.error) logError("deleteFamily.photos", rm.error);
  }
  await writeAudit(me, "family.delete", "families", id, { athletes: (athletes ?? []).length });
  revalidatePath("/admin/families");
  redirect("/admin/families");
}

// ---------------------------------------------------------------------------
// Guardians (family_members): admin only
// ---------------------------------------------------------------------------

async function familyInOrg(familyId: string, orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("families").select("id").eq("id", familyId).eq("org_id", orgId).maybeSingle();
  return !!data;
}

/** Only one primary guardian per family; keep families.primary_contact_id in step. */
async function setPrimary(familyId: string, profileId: string, orgId: string) {
  const supabase = await createClient();
  await supabase.from("family_members").update({ is_primary: false }).eq("family_id", familyId).neq("profile_id", profileId);
  await supabase.from("family_members").update({ is_primary: true }).eq("family_id", familyId).eq("profile_id", profileId);
  await supabase.from("families").update({ primary_contact_id: profileId }).eq("id", familyId).eq("org_id", orgId);
}

/**
 * Link an existing account of this club (by e-mail) as guardian. People
 * without an account are invited from Invitations; they are linked when
 * they accept.
 */
export async function linkGuardian(input: GuardianLinkInput): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const p = guardianLinkSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(firstIssueKey(p.error)) };
  if (!(await familyInOrg(p.data.familyId, me.orgId))) return { ok: false, error: t("editPeople.errors.familyNotFound") };

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("org_id", me.orgId)
    .eq("email", p.data.email) // citext: case-insensitive
    .maybeSingle();
  if (!profile) return { ok: false, error: t("editPeople.guardians.noAccount") };

  const { error } = await supabase.from("family_members").upsert(
    { family_id: p.data.familyId, profile_id: profile.id, relation: p.data.relation, is_primary: false },
    { onConflict: "family_id,profile_id" },
  );
  if (error) {
    logError("linkGuardian", error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  if (p.data.isPrimary) await setPrimary(p.data.familyId, profile.id, me.orgId);
  await writeAudit(me, "family.guardian.link", "families", p.data.familyId, {
    profile_id: profile.id,
    relation: p.data.relation,
    is_primary: p.data.isPrimary,
  });
  revalidatePath(`/admin/families/${p.data.familyId}`);
  revalidatePath(`/admin/families/${p.data.familyId}/edit`);
  return { ok: true, message: t("editPeople.guardians.linked") };
}

export async function updateGuardian(input: GuardianUpdateInput): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const p = guardianUpdateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(firstIssueKey(p.error)) };
  if (!(await familyInOrg(p.data.familyId, me.orgId))) return { ok: false, error: t("editPeople.errors.familyNotFound") };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("family_members")
    .update({ relation: p.data.relation })
    .eq("family_id", p.data.familyId)
    .eq("profile_id", p.data.profileId)
    .select("profile_id");
  if (error) {
    logError("updateGuardian", error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  if (!data?.length) return { ok: false, error: t("editPeople.errors.notFound") };
  if (p.data.isPrimary) await setPrimary(p.data.familyId, p.data.profileId, me.orgId);
  else await supabase.from("family_members").update({ is_primary: false }).eq("family_id", p.data.familyId).eq("profile_id", p.data.profileId);
  await writeAudit(me, "family.guardian.update", "families", p.data.familyId, {
    profile_id: p.data.profileId,
    relation: p.data.relation,
    is_primary: p.data.isPrimary,
  });
  revalidatePath(`/admin/families/${p.data.familyId}`);
  revalidatePath(`/admin/families/${p.data.familyId}/edit`);
  return { ok: true, message: t("editPeople.saved") };
}

export async function unlinkGuardian(familyId: string, profileId: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  if (!(await familyInOrg(familyId, me.orgId))) return { ok: false, error: t("editPeople.errors.familyNotFound") };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("family_members")
    .delete()
    .eq("family_id", familyId)
    .eq("profile_id", profileId)
    .select("profile_id");
  if (error) {
    logError("unlinkGuardian", error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  if (!data?.length) return { ok: false, error: t("editPeople.errors.notFound") };
  await supabase.from("families").update({ primary_contact_id: null }).eq("id", familyId).eq("org_id", me.orgId).eq("primary_contact_id", profileId);
  await writeAudit(me, "family.guardian.unlink", "families", familyId, { profile_id: profileId });
  revalidatePath(`/admin/families/${familyId}`);
  revalidatePath(`/admin/families/${familyId}/edit`);
  return { ok: true, message: t("editPeople.guardians.unlinked") };
}
