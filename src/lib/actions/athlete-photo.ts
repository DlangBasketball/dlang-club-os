"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, writeAudit, type ActionResult } from "@/lib/people/server";
import {
  PHOTO_BUCKET,
  checkPhotoFile,
  isPhotoPathFor,
  photoObjectPath,
  sniffImageType,
} from "@/lib/people/validation";
import { logError } from "@/lib/log";

/**
 * Athlete photos: identification inside the club only (profile, rosters,
 * parent app). Never public, never used for marketing (media consent is a
 * separate record). Objects live in the PRIVATE bucket "athlete-photos" at
 * <org_id>/<athlete_id>/<random>.<ext>; all Storage calls use the signed-in
 * user's client, so Storage RLS (admin of the org or guardian of the
 * athlete) decides as well as the checks here.
 */

async function loadAthlete(athleteId: string, orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("athletes")
    .select("id,org_id,family_id,photo_path")
    .eq("id", athleteId)
    .eq("org_id", orgId)
    .maybeSingle();
  return data;
}

/** Admins of the org, or a guardian of this athlete. */
async function canEditPhoto(me: { id: string; roles: string[] }, familyId: string): Promise<boolean> {
  if (me.roles.includes("admin")) return true;
  if (!me.roles.includes("parent")) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from("family_members")
    .select("family_id")
    .eq("family_id", familyId)
    .eq("profile_id", me.id)
    .maybeSingle();
  return !!data;
}

function revalidate(athleteId: string) {
  revalidatePath(`/admin/athletes/${athleteId}`);
  revalidatePath(`/admin/athletes/${athleteId}/edit`);
  revalidatePath("/admin/athletes");
  revalidatePath("/parent/children");
  revalidatePath(`/parent/children/${athleteId}`);
}

export async function uploadAthletePhoto(formData: FormData): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin", "parent"]);
  if (!me) return { ok: false, error: t("athletePhoto.errors.forbidden") };
  const athleteId = String(formData.get("athleteId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: t("athletePhoto.errors.noFile") };
  const bad = checkPhotoFile(file);
  if (bad) return { ok: false, error: t.dynamic(bad) };

  const athlete = await loadAthlete(athleteId, me.orgId).catch(() => null);
  if (!athlete) return { ok: false, error: t("athletePhoto.errors.notFound") };
  if (!(await canEditPhoto(me, athlete.family_id))) return { ok: false, error: t("athletePhoto.errors.forbidden") };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);
  if (!sniffed || sniffed !== file.type) return { ok: false, error: t("athletePhoto.errors.type") };

  const path = photoObjectPath(me.orgId, athlete.id, sniffed, crypto.randomUUID());
  const supabase = await createClient();
  const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, bytes, {
    contentType: sniffed,
    upsert: false,
    cacheControl: "300",
  });
  if (up.error) {
    logError("uploadAthletePhoto.storage", up.error);
    return { ok: false, error: t("athletePhoto.errors.uploadFailed") };
  }

  const { error } = await supabase
    .from("athletes")
    .update({ photo_path: path, photo_updated_at: new Date().toISOString() })
    .eq("id", athlete.id)
    .eq("org_id", me.orgId);
  if (error) {
    logError("uploadAthletePhoto.row", error);
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    return { ok: false, error: t("athletePhoto.errors.uploadFailed") };
  }

  // Replace: remove the previous object only after the row points at the new one.
  const previous = athlete.photo_path;
  if (previous && previous !== path && isPhotoPathFor(previous, me.orgId, athlete.id)) {
    const rm = await supabase.storage.from(PHOTO_BUCKET).remove([previous]);
    if (rm.error) logError("uploadAthletePhoto.removeOld", rm.error);
  }
  await writeAudit(me, previous ? "athlete.photo.replace" : "athlete.photo.upload", "athletes", athlete.id, {
    size_bytes: bytes.byteLength,
    type: sniffed,
    by_role: me.roles.includes("admin") ? "admin" : "guardian",
  });
  revalidate(athlete.id);
  return { ok: true, message: t("athletePhoto.saved") };
}

export async function removeAthletePhoto(athleteId: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin", "parent"]);
  if (!me) return { ok: false, error: t("athletePhoto.errors.forbidden") };
  const athlete = await loadAthlete(athleteId, me.orgId).catch(() => null);
  if (!athlete) return { ok: false, error: t("athletePhoto.errors.notFound") };
  if (!(await canEditPhoto(me, athlete.family_id))) return { ok: false, error: t("athletePhoto.errors.forbidden") };
  if (!athlete.photo_path) return { ok: true, message: t("athletePhoto.removed") };

  const supabase = await createClient();
  const { error } = await supabase
    .from("athletes")
    .update({ photo_path: null, photo_updated_at: new Date().toISOString() })
    .eq("id", athlete.id)
    .eq("org_id", me.orgId);
  if (error) {
    logError("removeAthletePhoto.row", error);
    return { ok: false, error: t("athletePhoto.errors.removeFailed") };
  }
  if (isPhotoPathFor(athlete.photo_path, me.orgId, athlete.id)) {
    const rm = await supabase.storage.from(PHOTO_BUCKET).remove([athlete.photo_path]);
    if (rm.error) logError("removeAthletePhoto.storage", rm.error);
  }
  await writeAudit(me, "athlete.photo.remove", "athletes", athlete.id, {
    by_role: me.roles.includes("admin") ? "admin" : "guardian",
  });
  revalidate(athlete.id);
  return { ok: true, message: t("athletePhoto.removed") };
}
