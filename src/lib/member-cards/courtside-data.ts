import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCardCheckInEnabled } from "./check-in-setting";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { hasFeature } from "@/lib/upgrades/server";
import { logError } from "@/lib/log";
import { PHOTO_BUCKET, PHOTO_URL_TTL, isPhotoPathFor } from "@/lib/people/validation";
import { CARD_BRAND_SOURCES, type CardBrandSource, type CourtsideBrand, type CourtsideCardData } from "./courtside";

/**
 * Server reads for the Courtside card. The card JSON comes from
 * public.member_card_courtside() (admin, guardian of the athlete, or the
 * athlete's own player login; tenant + role checked in the database). The
 * QR is the EXISTING card credential (member_cards nonce + version, club
 * key): reading a card never rotates or re-issues it.
 *
 * Signed URLs: brand logos (private bucket "member-card-brands") and the
 * athlete photo (private bucket "athlete-photos") are signed with the
 * signed-in user's client, so Storage RLS decides. A player has no Storage
 * read on the photo bucket, so their OWN photo is signed with the service
 * role after the RPC has authorised the read (path checked against org +
 * athlete).
 */
export const CARD_BRAND_BUCKET = "member-card-brands";
export const CARD_BRAND_URL_TTL = 600;

type Db = SupabaseClient;
const db = async (): Promise<Db> => (await createClient()) as unknown as Db;

type RpcBrand = {
  billing_entity_id: string; entity_name: string; display_name: string; subtitle: string | null;
  logo_path: string | null; watermark_path: string | null; sources: string[]; is_fallback: boolean;
};
type RpcCard = {
  athlete_id: string; first_name: string; last_name: string; token: string | null; card_active: boolean;
  photo_path: string | null; brands: RpcBrand[];
};

export type CardViewer = "admin" | "guardian" | "player";
export type LoadCardResult =
  | { ok: true; card: CourtsideCardData; viewer: CardViewer }
  | { ok: false; reason: "feature" | "forbidden" | "notFound" | "error" };

/** Sign brand asset paths of this org (missing / foreign paths get no URL). */
export async function signBrandAssets(orgId: string, paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = Array.from(new Set(paths.filter((p): p is string => !!p && p.startsWith(`${orgId}/`))));
  if (!wanted.length) return out;
  try {
    const client = await db();
    const { data, error } = await client.storage.from(CARD_BRAND_BUCKET).createSignedUrls(wanted, CARD_BRAND_URL_TTL);
    if (error || !data) return out;
    for (const item of data) if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
  } catch (e) {
    logError("memberCard.signBrandAssets", e);
  }
  return out;
}

async function signPhoto(path: string | null, orgId: string, athleteId: string): Promise<string | null> {
  if (!path || !isPhotoPathFor(path, orgId, athleteId)) return null;
  try {
    const client = await db();
    const { data } = await client.storage.from(PHOTO_BUCKET).createSignedUrl(path, PHOTO_URL_TTL);
    if (data?.signedUrl) return data.signedUrl;
    // A player login has no Storage read on the photo bucket. The card RPC
    // has already authorised this athlete for the caller and the path is
    // checked against org + athlete, so sign it server-side.
    const admin = createAdminClient();
    const res = await admin.storage.from(PHOTO_BUCKET).createSignedUrl(path, PHOTO_URL_TTL);
    return res.data?.signedUrl ?? null;
  } catch (e) {
    logError("memberCard.signPhoto", e);
    return null;
  }
}

function toSources(list: string[] | null | undefined): CardBrandSource[] {
  return (list ?? []).filter((s): s is CardBrandSource => (CARD_BRAND_SOURCES as readonly string[]).includes(s));
}

export async function qrSvgFor(token: string): Promise<string> {
  return QRCode.toString(token, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}

/** The Courtside card of an athlete for the signed-in admin, guardian or player. */
export async function loadCourtsideCard(athleteId: string): Promise<LoadCardResult> {
  if (!/^[0-9a-f-]{36}$/i.test(athleteId)) return { ok: false, reason: "notFound" };
  const me = await getSessionUser();
  if (!me?.orgId || !(await tenantMatchesOrg(me.orgId))) return { ok: false, reason: "forbidden" };
  const roles = me.roles as string[];
  if (!roles.some((r) => r === "admin" || r === "parent" || r === "player")) return { ok: false, reason: "forbidden" };
  if (!(await hasFeature(me.orgId, "member_cards"))) return { ok: false, reason: "feature" };

  const client = await db();
  const { data, error } = await client.rpc("member_card_courtside", { p_athlete: athleteId });
  if (error || !data) {
    const msg = error?.message ?? "";
    if (/NOT_AUTHORIZED|permission denied/.test(msg)) return { ok: false, reason: "forbidden" };
    if (/ATHLETE_NOT_FOUND/.test(msg)) return { ok: false, reason: "notFound" };
    logError("memberCard.load", error);
    return { ok: false, reason: "error" };
  }
  const row = data as RpcCard;
  const viewer: CardViewer = roles.includes("admin") ? "admin" : roles.includes("parent") ? "guardian" : "player";
  const checkIn = await getCardCheckInEnabled();
  const [assets, photoUrl, qrSvg] = await Promise.all([
    signBrandAssets(me.orgId, row.brands.flatMap((b) => [b.logo_path, b.watermark_path])),
    signPhoto(row.photo_path, me.orgId, row.athlete_id),
    // No QR is rendered (nor sent to the browser) while the club has not turned check-in on.
    row.token && checkIn ? qrSvgFor(row.token) : Promise.resolve(null),
  ]);

  let brands: CourtsideBrand[] = row.brands.map((b) => ({
    entityId: b.billing_entity_id,
    displayName: b.display_name,
    subtitle: b.subtitle,
    logoUrl: b.logo_path ? assets.get(b.logo_path) ?? null : null,
    watermarkUrl: b.watermark_path ? assets.get(b.watermark_path) ?? null : null,
    sources: toSources(b.sources),
    isFallback: b.is_fallback,
  }));
  if (brands.length === 0) {
    // No billing entity at all: a text-only card with the club name.
    const { data: org } = await client.from("organizations").select("name").eq("id", me.orgId).maybeSingle();
    brands = [{ entityId: null, displayName: (org as { name?: string } | null)?.name ?? "", subtitle: null, logoUrl: null,
      watermarkUrl: null, sources: [], isFallback: true }];
  }

  return {
    ok: true,
    viewer,
    card: {
      athleteId: row.athlete_id,
      name: `${row.first_name} ${row.last_name}`.replace(/\s+/g, " ").trim(),
      qrSvg,
      cardActive: row.card_active,
      checkIn,
      photoUrl,
      brands,
    },
  };
}

// ---------------------------------------------------------------------------
// Admin: brands per billing entity (Settings -> Billing entities)
// ---------------------------------------------------------------------------
export type CardBrandRow = {
  entityId: string;
  entityName: string;
  isActive: boolean;
  isDefault: boolean;
  /** Saved brand row (null = not branded yet: entity name, text-only). */
  displayName: string | null;
  subtitle: string | null;
  logoPath: string | null;
  watermarkPath: string | null;
  logoUrl: string | null;
  watermarkUrl: string | null;
};

export async function listCardBrands(): Promise<{ ok: true; rows: CardBrandRow[]; canEdit: boolean } | { ok: false; reason: "forbidden" | "error" }> {
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance")) || !(await tenantMatchesOrg(me.orgId))) {
    return { ok: false, reason: "forbidden" };
  }
  const client = await db();
  const [ents, brands] = await Promise.all([
    client.from("billing_entities").select("id,name,is_active,is_default").eq("org_id", me.orgId)
      .order("is_default", { ascending: false }).order("name"),
    client.from("member_card_brands").select("billing_entity_id,display_name,subtitle,logo_path,watermark_path").eq("org_id", me.orgId),
  ]);
  if (ents.error || brands.error) {
    logError("memberCard.listBrands", ents.error ?? brands.error);
    return { ok: false, reason: "error" };
  }
  type B = { billing_entity_id: string; display_name: string; subtitle: string | null; logo_path: string | null; watermark_path: string | null };
  const byEntity = new Map((brands.data as B[] ?? []).map((b) => [b.billing_entity_id, b]));
  const assets = await signBrandAssets(me.orgId, (brands.data as B[] ?? []).flatMap((b) => [b.logo_path, b.watermark_path]));
  type E = { id: string; name: string; is_active: boolean; is_default: boolean };
  return {
    ok: true,
    canEdit: me.roles.includes("admin"),
    rows: ((ents.data as E[]) ?? []).map((e) => {
      const b = byEntity.get(e.id);
      return {
        entityId: e.id, entityName: e.name, isActive: e.is_active, isDefault: e.is_default,
        displayName: b?.display_name ?? null, subtitle: b?.subtitle ?? null,
        logoPath: b?.logo_path ?? null, watermarkPath: b?.watermark_path ?? null,
        logoUrl: b?.logo_path ? assets.get(b.logo_path) ?? null : null,
        watermarkUrl: b?.watermark_path ? assets.get(b.watermark_path) ?? null : null,
      };
    }),
  };
}
