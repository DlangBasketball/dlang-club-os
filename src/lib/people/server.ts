import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { logError } from "@/lib/log";
import { PHOTO_BUCKET, PHOTO_URL_TTL, isPhotoPathFor } from "./validation";
import { COACH_PHOTO_BUCKET } from "@/lib/coaches/validation";

export type ActionResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };

type Staff = SessionUser & { orgId: string };

/**
 * Session + role gate for the people/records server actions. The org always
 * comes from the signed-in user's profile, never from the client.
 */
export async function requireRole(roles: ("admin" | "finance" | "parent" | "coach")[]): Promise<{ me: Staff; t: Translator } | { me: null; t: Translator }> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId || !roles.some((r) => me.roles.includes(r))) return { me: null, t };
  return { me: me as Staff, t };
}

/**
 * Append an application-level audit entry (who did what to which record).
 * Row-level changes are also captured by the database audit triggers; this
 * adds the intent ("athlete.photo.replace", "family.guardian.link", ...).
 * Never put special-category values (health, free-text notes) in `data`.
 */
export async function writeAudit(
  me: { id: string; orgId: string },
  action: string,
  targetTable: string,
  targetId: string | null,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("audit_logs").insert({
      org_id: me.orgId,
      actor_id: me.id,
      action,
      target_table: targetTable,
      target_id: targetId,
      new_data: data ?? null,
    });
    if (error) logError("people.audit", error, { action });
  } catch (e) {
    logError("people.audit", e, { action });
  }
}

/**
 * Short-lived signed URLs for photos in a private bucket (athlete-photos,
 * coach-photos), minted with the SIGNED-IN user's client: Storage RLS decides
 * who may read. Rows the caller cannot read simply get no URL (initials shown).
 * Keys must be <org_id>/<row id>/<file>.
 */
async function signPhotos(
  bucket: string,
  rows: { id: string; orgId?: string | null; photoPath: string | null }[],
  orgId?: string | null,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = rows.filter((r) => r.photoPath && (!orgId || isPhotoPathFor(r.photoPath, orgId, r.id)));
  if (!wanted.length) return out;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls(wanted.map((r) => r.photoPath as string), PHOTO_URL_TTL);
    if (error || !data) return out;
    const byPath = new Map(wanted.map((r) => [r.photoPath as string, r.id]));
    for (const item of data) {
      const id = item.path ? byPath.get(item.path) : undefined;
      if (id && item.signedUrl && !item.error) out.set(id, item.signedUrl);
    }
  } catch (e) {
    logError("people.signPhotos", e, { bucket });
  }
  return out;
}

/** Athlete photos: admin / guardian / coach of that athlete (Storage RLS). */
export async function signAthletePhotos(
  rows: { id: string; orgId?: string | null; photoPath: string | null }[],
  orgId?: string | null,
): Promise<Map<string, string>> {
  return signPhotos(PHOTO_BUCKET, rows, orgId);
}

/** Coach photos: any signed-in member of the coach's org (Storage RLS). */
export async function signCoachPhotos(
  rows: { id: string; orgId?: string | null; photoPath: string | null }[],
  orgId?: string | null,
): Promise<Map<string, string>> {
  return signPhotos(COACH_PHOTO_BUCKET, rows, orgId);
}

/** Photo URLs for a list of coach ids (reads photo_path through RLS). */
export async function photoUrlsForCoaches(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (!unique.length) return {};
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("coaches").select("id,org_id,photo_path").in("id", unique);
    const rows = (data ?? [])
      .filter((c) => isPhotoPathFor(c.photo_path, c.org_id, c.id))
      .map((c) => ({ id: c.id, photoPath: c.photo_path }));
    return Object.fromEntries(await signCoachPhotos(rows));
  } catch (e) {
    logError("people.photoUrlsForCoaches", e);
    return {};
  }
}

/** Photo URLs for a list of athlete ids (reads photo_path through RLS). */
export async function photoUrlsForAthletes(ids: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return {};
  const supabase = await createClient();
  const { data } = await supabase.from("athletes").select("id,org_id,photo_path").in("id", unique);
  const rows = (data ?? [])
    .filter((a) => isPhotoPathFor(a.photo_path, a.org_id, a.id))
    .map((a) => ({ id: a.id, photoPath: a.photo_path }));
  return Object.fromEntries(await signAthletePhotos(rows));
}
