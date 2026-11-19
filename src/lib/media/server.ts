import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/log";
import {
  ATHLETE_COVER_BUCKET,
  COVER_URL_TTL,
  clampFocal,
  clubMediaPublicUrl,
  isAthleteCoverPath,
  isLibraryPath,
  type CoverView,
} from "./cover";

export const EMPTY_COVER: CoverView = { url: null, focalX: 50, focalY: 50, path: null };

type CoverRow = { cover_path?: string | null; cover_focal_x?: number | null; cover_focal_y?: number | null };

/**
 * Turn a stored cover into something a page can render. Library paths become
 * public club-media URLs; a private athlete cover gets a short-lived signed
 * URL minted with the SIGNED-IN user's client, so Storage RLS (admin of the
 * org, the athlete's guardians, coaches who may access the athlete) decides.
 */
export async function resolveCover(row: CoverRow | null | undefined, ctx: { orgId: string; athleteId?: string }): Promise<CoverView> {
  const path = row?.cover_path ?? null;
  const focalX = clampFocal(row?.cover_focal_x ?? 50);
  const focalY = clampFocal(row?.cover_focal_y ?? 50);
  if (!path) return { url: null, focalX, focalY, path: null };
  if (isLibraryPath(path, ctx.orgId)) return { url: clubMediaPublicUrl(path), focalX, focalY, path };
  if (ctx.athleteId && isAthleteCoverPath(path, ctx.orgId, ctx.athleteId)) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.storage.from(ATHLETE_COVER_BUCKET).createSignedUrl(path, COVER_URL_TTL);
      if (error || !data?.signedUrl) return { url: null, focalX, focalY, path };
      return { url: data.signedUrl, focalX, focalY, path };
    } catch (e) {
      logError("media.resolveCover", e);
    }
  }
  return { url: null, focalX, focalY, path };
}

/**
 * Club hub hero / admin dashboard: the org cover. Public page, so this uses
 * the service-role client pinned to the org resolved server-side (request
 * host or the signed-in user's profile). Returns only the cover fields.
 */
export const getOrgCover = cache(async (orgId: string | null | undefined): Promise<CoverView> => {
  if (!orgId) return EMPTY_COVER;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("organizations")
      .select("cover_path,cover_focal_x,cover_focal_y")
      .eq("id", orgId)
      .maybeSingle();
    return resolveCover(data, { orgId });
  } catch (e) {
    logError("media.getOrgCover", e);
    return EMPTY_COVER;
  }
});

/** Team banner (staff of the club; RLS on teams decides). */
export async function getTeamCover(teamId: string): Promise<CoverView> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("teams")
      .select("org_id,cover_path,cover_focal_x,cover_focal_y")
      .eq("id", teamId)
      .maybeSingle();
    const row = data as (CoverRow & { org_id: string }) | null;
    if (!row) return EMPTY_COVER;
    return resolveCover(row, { orgId: row.org_id });
  } catch (e) {
    logError("media.getTeamCover", e);
    return EMPTY_COVER;
  }
}

/** Player-profile banner (private; RLS on athletes + the private bucket decide). */
export async function getAthleteCover(athleteId: string): Promise<CoverView> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("athletes")
      .select("id,org_id,cover_path,cover_focal_x,cover_focal_y")
      .eq("id", athleteId)
      .maybeSingle();
    if (!data) return EMPTY_COVER;
    return resolveCover(data, { orgId: data.org_id, athleteId: data.id });
  } catch (e) {
    logError("media.getAthleteCover", e);
    return EMPTY_COVER;
  }
}

export type MediaAssetView = {
  id: string;
  path: string;
  url: string;
  kind: "cover" | "banner" | "gallery";
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  altText: string | null;
  consentNote: string | null;
  publicUseConfirmedAt: string | null;
  createdAt: string;
  uses: number;
};

/** The club's media library (staff; RLS on media_assets decides). */
export async function listMediaAssets(orgId: string, limit = 200): Promise<MediaAssetView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("media_assets")
    .select("id,path,kind,width,height,size_bytes,alt_text,consent_note,public_use_confirmed_at,created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) {
    if (error) logError("media.listMediaAssets", error);
    return [];
  }
  const ids = data.map((d) => d.id);
  const usage = new Map<string, number>();
  if (ids.length) {
    const { data: u } = await supabase.rpc("media_asset_usage", { p_ids: ids });
    for (const r of u ?? []) usage.set(r.asset_id, Number(r.uses) || 0);
  }
  return data
    .filter((d) => isLibraryPath(d.path, orgId))
    .map((d) => ({
      id: d.id,
      path: d.path,
      url: clubMediaPublicUrl(d.path),
      kind: d.kind,
      width: d.width,
      height: d.height,
      sizeBytes: d.size_bytes,
      altText: d.alt_text,
      consentNote: d.consent_note,
      publicUseConfirmedAt: d.public_use_confirmed_at,
      createdAt: d.created_at,
      uses: usage.get(d.id) ?? 0,
    }));
}
