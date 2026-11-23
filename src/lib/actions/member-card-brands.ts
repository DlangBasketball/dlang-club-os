"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { logError } from "@/lib/log";
import { PHOTO_TYPES, sniffImageType, type PhotoType } from "@/lib/people/validation";
import { CARD_BRAND_BUCKET } from "@/lib/member-cards/courtside-data";

/**
 * Member card brands (Settings -> Billing entities): display name, second
 * line, logo and watermark per billing entity. Admin only; the database
 * function member_card_brand_save() re-checks role, org and that asset paths
 * live under <org_id>/<billing_entity_id>/. Logos go to the private bucket
 * "member-card-brands" (Storage RLS: admins write, club members read via
 * signed URLs). Replacing a logo uploads the new file first, saves the
 * pointer, then deletes the old object.
 */
export type BrandResult = { ok: true; message: string } | { ok: false; error: string };

const BRAND_LOGO_MAX_BYTES = 1024 * 1024;

const saveSchema = z.object({
  entityId: z.string().uuid(),
  displayName: z.string().trim().max(60),
  subtitle: z.string().trim().max(80),
});

type Brand = { display_name: string; subtitle: string | null; logo_path: string | null; watermark_path: string | null };

async function admin() {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId || !me.roles.includes("admin") || !(await tenantMatchesOrg(me.orgId))) return { me: null, t } as const;
  return { me: { ...me, orgId: me.orgId }, t } as const;
}

const ERR: [RegExp, string][] = [
  [/NOT_AUTHORIZED|permission denied/, "forbidden"],
  [/ENTITY_NOT_FOUND/, "entityNotFound"],
  [/INVALID_LOGO_PATH/, "logoPath"],
  [/BRAND_TOO_LONG/, "tooLong"],
];
function errKey(message: string): string {
  for (const [re, k] of ERR) if (re.test(message)) return k;
  return "generic";
}

async function current(db: SupabaseClient, orgId: string, entityId: string): Promise<Brand | null> {
  const { data } = await db.from("member_card_brands").select("display_name,subtitle,logo_path,watermark_path")
    .eq("org_id", orgId).eq("billing_entity_id", entityId).maybeSingle();
  return (data as Brand | null) ?? null;
}

async function entityName(db: SupabaseClient, orgId: string, entityId: string): Promise<string | null> {
  const { data } = await db.from("billing_entities").select("name").eq("org_id", orgId).eq("id", entityId).maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}

async function save(db: SupabaseClient, entityId: string, b: Brand): Promise<string | null> {
  const { error } = await db.rpc("member_card_brand_save", {
    p_payload: { billing_entity_id: entityId, display_name: b.display_name, subtitle: b.subtitle ?? "",
                 logo_path: b.logo_path ?? "", watermark_path: b.watermark_path ?? "" },
  });
  return error ? error.message : null;
}

function revalidate() {
  revalidatePath("/admin/settings/billing-entities");
  revalidatePath("/admin/settings/billing-entities/card-preview");
  revalidatePath("/parent/children", "layout");
  revalidatePath("/admin/athletes", "layout");
  revalidatePath("/player/home");
}

export async function saveCardBrand(input: z.input<typeof saveSchema>): Promise<BrandResult> {
  const { me, t } = await admin();
  if (!me) return { ok: false, error: t("memberCard.brands.errors.forbidden") };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("memberCard.brands.errors.tooLong") };
  const db = (await createClient()) as unknown as SupabaseClient;
  const name = await entityName(db, me.orgId, parsed.data.entityId);
  if (!name) return { ok: false, error: t("memberCard.brands.errors.entityNotFound") };
  const prev = await current(db, me.orgId, parsed.data.entityId);
  const err = await save(db, parsed.data.entityId, {
    display_name: parsed.data.displayName || name,
    subtitle: parsed.data.subtitle || null,
    logo_path: prev?.logo_path ?? null,
    watermark_path: prev?.watermark_path ?? null,
  });
  if (err) {
    logError("memberCard.saveBrand", err);
    return { ok: false, error: t.dynamic(`memberCard.brands.errors.${errKey(err)}`, undefined, t("memberCard.brands.errors.generic")) };
  }
  revalidate();
  return { ok: true, message: t("memberCard.brands.saved") };
}

const EXT: Record<PhotoType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Upload (or replace) the logo or the watermark of a brand. FormData: entityId, kind (logo|watermark), file. */
export async function uploadCardBrandAsset(formData: FormData): Promise<BrandResult> {
  const { me, t } = await admin();
  if (!me) return { ok: false, error: t("memberCard.brands.errors.forbidden") };
  const entityId = String(formData.get("entityId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const file = formData.get("file");
  if (!z.string().uuid().safeParse(entityId).success || (kind !== "logo" && kind !== "watermark")) {
    return { ok: false, error: t("memberCard.brands.errors.generic") };
  }
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: t("memberCard.brands.errors.noFile") };
  if (file.size > BRAND_LOGO_MAX_BYTES) return { ok: false, error: t("memberCard.brands.errors.size") };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type || !(PHOTO_TYPES as readonly string[]).includes(type)) return { ok: false, error: t("memberCard.brands.errors.type") };

  const db = (await createClient()) as unknown as SupabaseClient;
  const name = await entityName(db, me.orgId, entityId);
  if (!name) return { ok: false, error: t("memberCard.brands.errors.entityNotFound") };
  const prev = await current(db, me.orgId, entityId);

  const path = `${me.orgId}/${entityId}/${kind}_${crypto.randomUUID().replace(/-/g, "")}.${EXT[type]}`;
  const up = await db.storage.from(CARD_BRAND_BUCKET).upload(path, bytes, { contentType: type, upsert: false, cacheControl: "300" });
  if (up.error) {
    logError("memberCard.uploadAsset", up.error);
    return { ok: false, error: t("memberCard.brands.errors.uploadFailed") };
  }
  const next: Brand = {
    display_name: prev?.display_name ?? name,
    subtitle: prev?.subtitle ?? null,
    logo_path: kind === "logo" ? path : prev?.logo_path ?? null,
    watermark_path: kind === "watermark" ? path : prev?.watermark_path ?? null,
  };
  const err = await save(db, entityId, next);
  if (err) {
    logError("memberCard.uploadAsset.save", err);
    await db.storage.from(CARD_BRAND_BUCKET).remove([path]);
    return { ok: false, error: t("memberCard.brands.errors.uploadFailed") };
  }
  const old = kind === "logo" ? prev?.logo_path : prev?.watermark_path;
  if (old && old !== path && old.startsWith(`${me.orgId}/${entityId}/`)) {
    const rm = await db.storage.from(CARD_BRAND_BUCKET).remove([old]);
    if (rm.error) logError("memberCard.uploadAsset.removeOld", rm.error);
  }
  revalidate();
  return { ok: true, message: t("memberCard.brands.logoSaved") };
}

/** Remove the logo or the watermark (the card falls back to the text-only lockup / the logo). */
export async function removeCardBrandAsset(entityId: string, kind: "logo" | "watermark"): Promise<BrandResult> {
  const { me, t } = await admin();
  if (!me) return { ok: false, error: t("memberCard.brands.errors.forbidden") };
  if (!z.string().uuid().safeParse(entityId).success || (kind !== "logo" && kind !== "watermark")) {
    return { ok: false, error: t("memberCard.brands.errors.generic") };
  }
  const db = (await createClient()) as unknown as SupabaseClient;
  const prev = await current(db, me.orgId, entityId);
  const old = kind === "logo" ? prev?.logo_path : prev?.watermark_path;
  if (!prev || !old) return { ok: true, message: t("memberCard.brands.logoRemoved") };
  const err = await save(db, entityId, {
    ...prev,
    logo_path: kind === "logo" ? null : prev.logo_path,
    watermark_path: kind === "watermark" ? null : prev.watermark_path,
  });
  if (err) {
    logError("memberCard.removeAsset", err);
    return { ok: false, error: t("memberCard.brands.errors.generic") };
  }
  if (old.startsWith(`${me.orgId}/${entityId}/`)) {
    const rm = await db.storage.from(CARD_BRAND_BUCKET).remove([old]);
    if (rm.error) logError("memberCard.removeAsset.storage", rm.error);
  }
  revalidate();
  return { ok: true, message: t("memberCard.brands.logoRemoved") };
}
