"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, writeAudit, type ActionResult } from "@/lib/people/server";
import { isPhotoPathFor } from "@/lib/people/validation";
import {
  COACH_PHOTO_BUCKET,
  coachDbErrorKey,
  coachIdSchema,
  coachIssueKey,
  coachSchema,
  quickCoachSchema,
  type CoachInput,
  type QuickCoachInput,
} from "@/lib/coaches/validation";
import { logError } from "@/lib/log";

/**
 * Coach management (admin only). The org always comes from the signed-in
 * admin's profile; RLS (coaches_admin_write) enforces the same scope in the
 * database, and every row is re-resolved inside that org before a change.
 * Audit: the database trigger records each row change; writeAudit adds the
 * intent ("coach.create", "coach.deactivate", ...).
 */

function revalidateCoaches(coachId?: string) {
  revalidatePath("/admin/coaches");
  if (coachId) revalidatePath(`/admin/coaches/${coachId}`);
  revalidatePath("/admin/teams", "layout");
  revalidatePath("/admin/schedule", "layout");
  revalidatePath("/admin/bookings", "layout");
  revalidatePath("/coach", "layout");
}

async function loadCoach(id: string, orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("coaches")
    .select("id,org_id,display_name,is_active,photo_path")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  return data;
}

export async function createCoach(input: CoachInput): Promise<ActionResult<{ id: string }>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("coaches.errors.forbidden") };
  const p = coachSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(coachIssueKey(p.error)) };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coaches")
    .insert({
      org_id: me.orgId,
      display_name: p.data.displayName,
      role_title: p.data.roleTitle,
      bio: p.data.bio,
      serves: p.data.serves,
      is_active: p.data.isActive,
    })
    .select("id")
    .single();
  if (error || !data) {
    logError("createCoach", error);
    return { ok: false, error: t.dynamic(coachDbErrorKey(error?.message)) };
  }
  await writeAudit(me, "coach.create", "coaches", data.id, { is_active: p.data.isActive });
  revalidateCoaches(data.id);
  return { ok: true, message: t("coaches.messages.created"), data: { id: data.id } };
}

/** Team form "+ New coach": creates an active coach with a name and title. */
export async function quickCreateCoach(input: QuickCoachInput): Promise<ActionResult<{ id: string; name: string }>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("coaches.errors.forbidden") };
  const p = quickCoachSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(coachIssueKey(p.error)) };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coaches")
    .insert({ org_id: me.orgId, display_name: p.data.displayName, role_title: p.data.roleTitle, is_active: true })
    .select("id,display_name")
    .single();
  if (error || !data) {
    logError("quickCreateCoach", error);
    return { ok: false, error: t.dynamic(coachDbErrorKey(error?.message)) };
  }
  await writeAudit(me, "coach.create", "coaches", data.id, { source: "team_form" });
  revalidateCoaches(data.id);
  return { ok: true, message: t("coaches.messages.created"), data: { id: data.id, name: data.display_name } };
}

export async function updateCoach(id: string, input: CoachInput): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("coaches.errors.forbidden") };
  if (!coachIdSchema.safeParse(id).success) return { ok: false, error: t("coaches.errors.notFound") };
  const p = coachSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(coachIssueKey(p.error)) };
  const before = await loadCoach(id, me.orgId).catch(() => null);
  if (!before) return { ok: false, error: t("coaches.errors.notFound") };
  const supabase = await createClient();
  const { error } = await supabase
    .from("coaches")
    .update({
      display_name: p.data.displayName,
      role_title: p.data.roleTitle,
      bio: p.data.bio,
      serves: p.data.serves,
      is_active: p.data.isActive,
    })
    .eq("id", id)
    .eq("org_id", me.orgId);
  if (error) {
    logError("updateCoach", error);
    return { ok: false, error: t.dynamic(coachDbErrorKey(error.message)) };
  }
  await writeAudit(me, "coach.update", "coaches", id, {
    renamed: before.display_name !== p.data.displayName,
    is_active: p.data.isActive,
  });
  revalidateCoaches(id);
  return { ok: true, message: t("coaches.messages.saved") };
}

export async function setCoachActive(id: string, active: boolean): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("coaches.errors.forbidden") };
  if (!coachIdSchema.safeParse(id).success || typeof active !== "boolean") return { ok: false, error: t("coaches.errors.notFound") };
  const before = await loadCoach(id, me.orgId).catch(() => null);
  if (!before) return { ok: false, error: t("coaches.errors.notFound") };
  const supabase = await createClient();
  const { error } = await supabase.from("coaches").update({ is_active: active }).eq("id", id).eq("org_id", me.orgId);
  if (error) {
    logError("setCoachActive", error);
    return { ok: false, error: t.dynamic(coachDbErrorKey(error.message)) };
  }
  await writeAudit(me, active ? "coach.reactivate" : "coach.deactivate", "coaches", id);
  revalidateCoaches(id);
  return { ok: true, message: active ? t("coaches.messages.reactivated") : t("coaches.messages.deactivated") };
}

/**
 * Hard delete, only when nothing references the coach (teams, sessions,
 * attendance, availability, bookings). The check and the delete run
 * atomically in public.delete_coach_if_unused (admin of the coach's org).
 */
export async function deleteCoach(id: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("coaches.errors.forbidden") };
  if (!coachIdSchema.safeParse(id).success) return { ok: false, error: t("coaches.errors.notFound") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_coach_if_unused", { p_coach: id });
  if (error) {
    if (!error.message.includes("COACH_IN_USE")) logError("deleteCoach", error);
    return { ok: false, error: t.dynamic(coachDbErrorKey(error.message)) };
  }
  const photoPath = (data as { photo_path?: string | null } | null)?.photo_path ?? null;
  if (photoPath && isPhotoPathFor(photoPath, me.orgId, id)) {
    // The row is gone, so Storage RLS (which resolves the coach row) no longer
    // admits the delete: remove the object with the service role, limited to
    // the key verified above (<caller org>/<this coach>/<file>).
    const rm = await createAdminClient().storage.from(COACH_PHOTO_BUCKET).remove([photoPath]);
    if (rm.error) logError("deleteCoach.photo", rm.error);
  }
  await writeAudit(me, "coach.delete", "coaches", id);
  revalidateCoaches();
  return { ok: true, message: t("coaches.messages.deleted") };
}
