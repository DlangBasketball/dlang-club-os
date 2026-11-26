"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, writeAudit, type ActionResult } from "@/lib/people/server";
import { checkPhotoFile, isPhotoPathFor, photoObjectPath, sniffImageType } from "@/lib/people/validation";
import { COACH_PHOTO_BUCKET, coachDbErrorKey, coachIdSchema } from "@/lib/coaches/validation";
import { logError } from "@/lib/log";

/**
 * Coach profile photos: shown to members of the same club (staff and
 * parents) so families recognise the coach. Objects live in the PRIVATE
 * bucket "coach-photos" at <org_id>/<coach_id>/<random>.<ext>. Writers:
 * admins of the org, and the coach themself when their login is linked to
 * the coach row. Storage RLS and public.set_coach_photo enforce the same
 * rules in the database; every call here uses the signed-in user's client.
 */

type Me = { id: string; orgId: string; roles: string[] };

async function loadCoach(coachId: string, orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("coaches")
    .select("id,org_id,profile_id,photo_path")
    .eq("id", coachId)
    .eq("org_id", orgId)
    .maybeSingle();
  return data;
}

function canEdit(me: Me, coach: { profile_id: string | null }): boolean {
  return me.roles.includes("admin") || (!!coach.profile_id && coach.profile_id === me.id);
}

function revalidate(coachId: string) {
  revalidatePath("/admin/coaches");
  revalidatePath(`/admin/coaches/${coachId}`);
  revalidatePath("/admin/teams", "layout");
  revalidatePath("/coach", "layout");
  revalidatePath("/parent", "layout");
}

export async function uploadCoachPhoto(formData: FormData): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin", "coach"]);
  if (!me) return { ok: false, error: t("coaches.errors.forbidden") };
  const coachId = String(formData.get("coachId") ?? "");
  if (!coachIdSchema.safeParse(coachId).success) return { ok: false, error: t("coaches.errors.notFound") };
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: t("athletePhoto.errors.noFile") };
  const bad = checkPhotoFile(file);
  if (bad) return { ok: false, error: t.dynamic(bad) };

  const coach = await loadCoach(coachId, me.orgId).catch(() => null);
  if (!coach) return { ok: false, error: t("coaches.errors.notFound") };
  if (!canEdit(me, coach)) return { ok: false, error: t("coaches.errors.forbidden") };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);
  if (!sniffed || sniffed !== file.type) return { ok: false, error: t("athletePhoto.errors.type") };

  const path = photoObjectPath(me.orgId, coach.id, sniffed, crypto.randomUUID());
  const supabase = await createClient();
  const up = await supabase.storage.from(COACH_PHOTO_BUCKET).upload(path, bytes, {
    contentType: sniffed,
    upsert: false,
    cacheControl: "300",
  });
  if (up.error) {
    logError("uploadCoachPhoto.storage", up.error);
    return { ok: false, error: t("athletePhoto.errors.uploadFailed") };
  }

  const { data: previous, error } = await supabase.rpc("set_coach_photo", { p_coach: coach.id, p_path: path });
  if (error) {
    logError("uploadCoachPhoto.row", error);
    await supabase.storage.from(COACH_PHOTO_BUCKET).remove([path]);
    return { ok: false, error: t.dynamic(coachDbErrorKey(error.message)) };
  }

  // Replace: remove the previous object only after the row points at the new one.
  if (previous && previous !== path && isPhotoPathFor(previous, me.orgId, coach.id)) {
    const rm = await supabase.storage.from(COACH_PHOTO_BUCKET).remove([previous]);
    if (rm.error) logError("uploadCoachPhoto.removeOld", rm.error);
  }
  await writeAudit(me, previous ? "coach.photo.replace" : "coach.photo.upload", "coaches", coach.id, {
    size_bytes: bytes.byteLength,
    type: sniffed,
    by_role: me.roles.includes("admin") ? "admin" : "self",
  });
  revalidate(coach.id);
  return { ok: true, message: t("coaches.photo.saved") };
}

export async function removeCoachPhoto(coachId: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin", "coach"]);
  if (!me) return { ok: false, error: t("coaches.errors.forbidden") };
  if (!coachIdSchema.safeParse(coachId).success) return { ok: false, error: t("coaches.errors.notFound") };
  const coach = await loadCoach(coachId, me.orgId).catch(() => null);
  if (!coach) return { ok: false, error: t("coaches.errors.notFound") };
  if (!canEdit(me, coach)) return { ok: false, error: t("coaches.errors.forbidden") };
  if (!coach.photo_path) return { ok: true, message: t("coaches.photo.removed") };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_coach_photo", { p_coach: coach.id, p_path: null });
  if (error) {
    logError("removeCoachPhoto.row", error);
    return { ok: false, error: t.dynamic(coachDbErrorKey(error.message)) };
  }
  if (isPhotoPathFor(coach.photo_path, me.orgId, coach.id)) {
    const rm = await supabase.storage.from(COACH_PHOTO_BUCKET).remove([coach.photo_path]);
    if (rm.error) logError("removeCoachPhoto.storage", rm.error);
  }
  await writeAudit(me, "coach.photo.remove", "coaches", coach.id, {
    by_role: me.roles.includes("admin") ? "admin" : "self",
  });
  revalidate(coach.id);
  return { ok: true, message: t("coaches.photo.removed") };
}
