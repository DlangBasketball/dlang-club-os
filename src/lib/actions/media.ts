"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireRole, writeAudit, type ActionResult } from "@/lib/people/server";
import { logError } from "@/lib/log";
import {
  ATHLETE_COVER_BUCKET,
  CLUB_MEDIA_BUCKET,
  MEDIA_KINDS,
  MEDIA_MAX_BATCH,
  athleteCoverObjectPath,
  checkCoverFile,
  clubMediaPublicUrl,
  coverErrorKey,
  isAthleteCoverPath,
  isLibraryPath,
  libraryObjectPath,
  mediaAssetUpdateSchema,
  setCoverSchema,
  sniffCoverType,
  type CoverTarget,
  type MediaAssetUpdateInput,
  type MediaKind,
} from "@/lib/media/cover";

/**
 * Covers and the club media library.
 *
 * All Storage and table calls use the SIGNED-IN user's client, so RLS and
 * Storage policies decide as well as the checks here; the org always comes
 * from the session. set_cover() (SQL) is the single write path for cover
 * columns: it re-checks the role per target, the tenant, the path and the
 * public-surface consent, and writes the audit row.
 */

type Me = { id: string; orgId: string; roles: string[] };

const COVER_TABLE: Record<CoverTarget, string> = {
  org: "organizations",
  team: "teams",
  athlete: "athletes",
  program: "programs",
  camp_edition: "camp_editions",
};

function revalidateCover(target: CoverTarget, id: string) {
  switch (target) {
    case "org":
      revalidatePath("/club");
      revalidatePath("/admin/dashboard");
      revalidatePath("/admin/media");
      break;
    case "team":
      revalidatePath(`/admin/teams/${id}`);
      revalidatePath("/admin/teams");
      revalidatePath("/coach/team");
      break;
    case "athlete":
      revalidatePath(`/admin/athletes/${id}`);
      revalidatePath(`/admin/athletes/${id}/edit`);
      revalidatePath(`/parent/children/${id}`);
      revalidatePath(`/coach/development/athletes/${id}`);
      break;
    case "program":
    case "camp_edition":
      revalidatePath("/admin/programs");
      revalidatePath(`/admin/programs/${id}`);
      revalidatePath("/club");
      break;
  }
}

/** Current cover path of a record (through RLS), for focal-only changes. */
async function currentCoverPath(me: Me, target: CoverTarget, id: string): Promise<{ ok: true; path: string | null } | { ok: false; key: string }> {
  // Untyped view: programmes / camp editions get their cover columns from the camps migration.
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const query = supabase.from(COVER_TABLE[target]).select("cover_path");
  const { data, error } = await (target === "org" ? query.eq("id", me.orgId) : query.eq("id", id).eq("org_id", me.orgId)).maybeSingle();
  if (error) return { ok: false, key: coverErrorKey(error.message.includes("cover_path") ? "COVER_TARGET_UNSUPPORTED" : error.message) };
  if (!data) return { ok: false, key: "media.errors.notFound" };
  return { ok: true, path: (data as { cover_path: string | null }).cover_path ?? null };
}

async function readImage(file: File): Promise<{ bytes: Uint8Array; type: ReturnType<typeof sniffCoverType> } | { error: string }> {
  const bad = checkCoverFile(file);
  if (bad) return { error: bad };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffCoverType(bytes);
  if (!type || type !== file.type) return { error: "media.errors.type" };
  return { bytes, type };
}

function bool(v: FormDataEntryValue | null): boolean {
  return v === "true" || v === "on" || v === "1";
}

function optNumber(v: FormDataEntryValue | null): number | undefined {
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Set, change or remove the cover of an org / team / athlete / programme /
 * camp edition. See setCoverSchema (src/lib/media/cover.ts) for the fields;
 * build them with coverFormData().
 *
 * Roles: admin for every target; guardians of the athlete for 'athlete'
 * (upload / focal / remove only; the club library is staff-only). Athlete
 * uploads go to the PRIVATE athlete-covers bucket, everything else to the
 * club library (public bucket, registered in media_assets).
 */
export async function setCover(formData: FormData): Promise<ActionResult<{ path: string | null }>> {
  const { me, t } = await requireRole(["admin", "parent"]);
  if (!me) return { ok: false, error: t("media.errors.forbidden") };
  const parsed = setCoverSchema.safeParse({
    target: formData.get("target"),
    id: formData.get("id"),
    mode: formData.get("mode"),
    assetId: formData.get("assetId") || undefined,
    focalX: optNumber(formData.get("focalX")),
    focalY: optNumber(formData.get("focalY")),
    publicConsent: bool(formData.get("publicConsent")),
    alt: (formData.get("alt") as string | null) || undefined,
    width: optNumber(formData.get("width")),
    height: optNumber(formData.get("height")),
  });
  if (!parsed.success) return { ok: false, error: t("media.errors.invalid") };
  const input = parsed.data;
  const isAdmin = me.roles.includes("admin");
  if (input.target !== "athlete" && !isAdmin) return { ok: false, error: t("media.errors.forbidden") };
  if (input.target === "org" && input.id !== me.orgId) return { ok: false, error: t("media.errors.forbidden") };

  const supabase = await createClient();
  let path: string | null = null;
  let uploadedPrivate: string | null = null;
  let uploadedLibrary: { path: string; id: string } | null = null;

  if (input.mode === "focal") {
    const cur = await currentCoverPath(me, input.target, input.id);
    if (!cur.ok) return { ok: false, error: t.dynamic(cur.key) };
    path = cur.path;
    if (!path) return { ok: false, error: t("media.errors.noCover") };
  } else if (input.mode === "asset") {
    if (!isAdmin || !input.assetId) return { ok: false, error: t("media.errors.forbidden") };
    const { data: asset } = await supabase
      .from("media_assets")
      .select("path")
      .eq("id", input.assetId)
      .eq("org_id", me.orgId)
      .maybeSingle();
    if (!asset || !isLibraryPath(asset.path, me.orgId)) return { ok: false, error: t("media.errors.notFound") };
    path = asset.path;
  } else if (input.mode === "upload") {
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: t("media.errors.noFile") };
    const img = await readImage(file);
    if ("error" in img) return { ok: false, error: t.dynamic(img.error) };
    const type = img.type!;
    if (input.target === "athlete") {
      path = athleteCoverObjectPath(me.orgId, input.id, type, crypto.randomUUID());
      const up = await supabase.storage.from(ATHLETE_COVER_BUCKET).upload(path, img.bytes, { contentType: type, upsert: false, cacheControl: "300" });
      if (up.error) {
        logError("setCover.uploadPrivate", up.error);
        return { ok: false, error: t("media.errors.uploadFailed") };
      }
      uploadedPrivate = path;
    } else {
      path = libraryObjectPath(me.orgId, "cover", type, crypto.randomUUID());
      const up = await supabase.storage.from(CLUB_MEDIA_BUCKET).upload(path, img.bytes, { contentType: type, upsert: false, cacheControl: "3600" });
      if (up.error) {
        logError("setCover.uploadLibrary", up.error);
        return { ok: false, error: t("media.errors.uploadFailed") };
      }
      const { data: row, error } = await supabase
        .from("media_assets")
        .insert({
          org_id: me.orgId,
          path,
          kind: "cover",
          width: input.width ?? null,
          height: input.height ?? null,
          size_bytes: img.bytes.byteLength,
          mime_type: type,
          alt_text: input.alt ?? null,
          uploaded_by: me.id,
        })
        .select("id")
        .single();
      if (error || !row) {
        logError("setCover.assetRow", error);
        await supabase.storage.from(CLUB_MEDIA_BUCKET).remove([path]);
        return { ok: false, error: t("media.errors.uploadFailed") };
      }
      uploadedLibrary = { path, id: row.id };
    }
  }

  const { data: res, error } = await supabase.rpc("set_cover", {
    p_target: input.target,
    p_id: input.id,
    p_path: path,
    p_focal_x: input.focalX,
    p_focal_y: input.focalY,
    p_public_consent: input.publicConsent,
  });
  if (error) {
    // Undo a fresh upload the cover could not use.
    if (uploadedPrivate) await supabase.storage.from(ATHLETE_COVER_BUCKET).remove([uploadedPrivate]);
    if (uploadedLibrary) {
      await supabase.from("media_assets").delete().eq("id", uploadedLibrary.id);
      await supabase.storage.from(CLUB_MEDIA_BUCKET).remove([uploadedLibrary.path]);
    }
    const key = coverErrorKey(error.message);
    if (key === "media.errors.generic") logError("setCover.rpc", error);
    return { ok: false, error: t.dynamic(key) };
  }

  // A replaced private athlete cover is removed (library images stay in the library).
  const previous = (res as { previous_path?: string | null } | null)?.previous_path ?? null;
  if (input.target === "athlete" && previous && previous !== path && isAthleteCoverPath(previous, me.orgId, input.id)) {
    const rm = await supabase.storage.from(ATHLETE_COVER_BUCKET).remove([previous]);
    if (rm.error) logError("setCover.removeOld", rm.error);
  }

  revalidateCover(input.target, input.id);
  const message =
    input.mode === "remove" ? t("media.cover.removed")
    : input.mode === "focal" ? t("media.cover.focalSaved")
    : t("media.cover.saved");
  return { ok: true, message, data: { path } };
}

export type CoverLibraryItem = { id: string; url: string; alt: string | null; width: number | null; height: number | null; publicConfirmed: boolean };

/** Library images for the "Choose from library" tab (admins only). */
export async function listCoverLibrary(): Promise<ActionResult<CoverLibraryItem[]>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("media.errors.forbidden") };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("media_assets")
    .select("id,path,alt_text,width,height,public_use_confirmed_at")
    .eq("org_id", me.orgId)
    .order("created_at", { ascending: false })
    .limit(120);
  if (error) {
    logError("listCoverLibrary", error);
    return { ok: false, error: t("media.errors.generic") };
  }
  return {
    ok: true,
    data: (data ?? [])
      .filter((d) => isLibraryPath(d.path, me.orgId))
      .map((d) => ({
        id: d.id,
        url: clubMediaPublicUrl(d.path),
        alt: d.alt_text,
        width: d.width,
        height: d.height,
        publicConfirmed: !!d.public_use_confirmed_at,
      })),
  };
}

/**
 * Upload one or more images into the club library (admin). FormData: files
 * (repeated), and per file index i: width_i, height_i, alt_i; kind.
 */
export async function uploadMediaAssets(formData: FormData): Promise<ActionResult<{ count: number; failed: number }>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("media.errors.forbidden") };
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return { ok: false, error: t("media.errors.noFile") };
  if (files.length > MEDIA_MAX_BATCH) return { ok: false, error: t("media.errors.tooMany", { max: MEDIA_MAX_BATCH }) };
  const kindRaw = String(formData.get("kind") ?? "cover");
  const kind: MediaKind = (MEDIA_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as MediaKind) : "cover";

  const supabase = await createClient();
  let count = 0;
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    const img = await readImage(files[i]);
    if ("error" in img) {
      failed++;
      continue;
    }
    const type = img.type!;
    const path = libraryObjectPath(me.orgId, kind, type, crypto.randomUUID());
    const up = await supabase.storage.from(CLUB_MEDIA_BUCKET).upload(path, img.bytes, { contentType: type, upsert: false, cacheControl: "3600" });
    if (up.error) {
      logError("uploadMediaAssets.storage", up.error);
      failed++;
      continue;
    }
    const w = optNumber(formData.get(`width_${i}`));
    const h = optNumber(formData.get(`height_${i}`));
    const alt = String(formData.get(`alt_${i}`) ?? "").trim().slice(0, 300) || null;
    const { error } = await supabase.from("media_assets").insert({
      org_id: me.orgId,
      path,
      kind,
      width: w && w >= 1 && w <= 10000 ? Math.round(w) : null,
      height: h && h >= 1 && h <= 10000 ? Math.round(h) : null,
      size_bytes: img.bytes.byteLength,
      mime_type: type,
      alt_text: alt,
      uploaded_by: me.id,
    });
    if (error) {
      logError("uploadMediaAssets.row", error);
      await supabase.storage.from(CLUB_MEDIA_BUCKET).remove([path]);
      failed++;
      continue;
    }
    count++;
  }
  if (count) await writeAudit(me, "media.upload", "media_assets", null, { count, failed, kind });
  revalidatePath("/admin/media");
  if (!count) return { ok: false, error: t("media.errors.uploadFailed") };
  return {
    ok: true,
    message: failed ? t("media.library.uploadedPartial", { count, failed }) : t("media.library.uploaded", { count }),
    data: { count, failed },
  };
}

/** Edit alt text / consent note / kind of a library image (admin). */
export async function updateMediaAsset(input: MediaAssetUpdateInput): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("media.errors.forbidden") };
  const p = mediaAssetUpdateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("media.errors.invalid") };
  const supabase = await createClient();
  const patch: Record<string, unknown> = { alt_text: p.data.altText, consent_note: p.data.consentNote };
  if (p.data.kind) patch.kind = p.data.kind;
  const { data, error } = await supabase
    .from("media_assets")
    .update(patch)
    .eq("id", p.data.id)
    .eq("org_id", me.orgId)
    .select("id")
    .maybeSingle();
  if (error) {
    logError("updateMediaAsset", error);
    return { ok: false, error: t("media.errors.generic") };
  }
  if (!data) return { ok: false, error: t("media.errors.notFound") };
  revalidatePath("/admin/media");
  return { ok: true, message: t("media.library.saved") };
}

/** Delete a library image that nothing uses (the database refuses otherwise). */
export async function deleteMediaAsset(id: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("media.errors.forbidden") };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: t("media.errors.invalid") };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("media_assets")
    .delete()
    .eq("id", id)
    .eq("org_id", me.orgId)
    .select("path")
    .maybeSingle();
  if (error) {
    const key = coverErrorKey(error.message);
    if (key === "media.errors.generic") logError("deleteMediaAsset", error);
    return { ok: false, error: t.dynamic(key) };
  }
  if (!data) return { ok: false, error: t("media.errors.notFound") };
  if (isLibraryPath(data.path, me.orgId)) {
    const rm = await supabase.storage.from(CLUB_MEDIA_BUCKET).remove([data.path]);
    if (rm.error) logError("deleteMediaAsset.storage", rm.error);
  }
  revalidatePath("/admin/media");
  return { ok: true, message: t("media.library.deleted") };
}
