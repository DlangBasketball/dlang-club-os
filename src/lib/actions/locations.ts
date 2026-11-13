"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { writeAudit } from "@/lib/people/server";
import { sniffImageType } from "@/lib/people/validation";
import { logError } from "@/lib/log";
import { CLUB_MEDIA_BUCKET, shopDb } from "@/lib/shop/db";
import type { Json } from "@/types/database";
import { locationSchema, type LocationInput } from "@/lib/sports/locations";

/**
 * Locations (venues) admin: one place for address, map link, opening hours,
 * geofence, capacity, notes, photo and active state. Admins of the session's
 * club only; every change is audited.
 */
export type { LocationInput };
export type LocationResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
type Admin = SessionUser & { orgId: string };
const E = (k: string) => `sports.locations.errors.${k}`;

async function fail(key: string, orgId?: string | null): Promise<{ ok: false; error: string }> {
  const t = await getTranslations(orgId);
  return { ok: false, error: t.dynamic(key, undefined, t("sports.locations.errors.generic")) };
}
async function requireAdmin(): Promise<Admin | null> {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin") || !(await tenantMatchesOrg(me.orgId))) return null;
  return me as Admin;
}



export async function saveLocation(id: string | null, input: LocationInput): Promise<LocationResult<{ id: string }>> {
  const me = await requireAdmin();
  if (!me) return fail(E("notPermitted"));
  if (id && !z.string().uuid().safeParse(id).success) return fail(E("invalidRequest"), me.orgId);
  const p = locationSchema.safeParse(input);
  if (!p.success) {
    const m = p.error.issues[0]?.message ?? "";
    return fail(m.startsWith("sports.") ? m : E("invalidRequest"), me.orgId);
  }
  const v = p.data;
  const hours = v.openingHours && Object.keys(v.openingHours).length ? v.openingHours : null;
  const row = {
    name: v.name, address: v.address || null, city: v.city || null, postal_code: v.postalCode || null,
    country: v.country ? v.country.toUpperCase() : null, capacity: v.capacity, notes: v.notes || null, map_url: v.mapUrl || null,
    latitude: v.latitude, longitude: v.longitude, geofence_radius_m: v.geofenceRadiusM, opening_hours: hours as Json, is_active: v.isActive,
  };
  const db = await shopDb();
  const res = id
    ? await db.from("venues").update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from("venues").insert({ ...row, org_id: me.orgId }).select("id");
  if (res.error) return fail(/duplicate key/.test(res.error.message) ? E("nameTaken") : E("generic"), me.orgId);
  if (!res.data?.length) return fail(E("notFound"), me.orgId);
  const vid = res.data[0].id;
  await writeAudit(me, id ? "location.update" : "location.create", "venues", vid, { has_coordinates: v.latitude !== null, active: v.isActive });
  for (const path of ["/admin/locations", `/admin/locations/${vid}`, "/admin/schedule", "/admin/staff-schedules", "/admin/availability"]) revalidatePath(path);
  return { ok: true, data: { id: vid } };
}

export async function uploadLocationPhoto(form: FormData): Promise<LocationResult> {
  const me = await requireAdmin();
  if (!me) return fail(E("notPermitted"));
  const id = String(form.get("venueId") ?? "");
  const file = form.get("file");
  if (!z.string().uuid().safeParse(id).success || !(file instanceof File)) return fail(E("invalidRequest"), me.orgId);
  if (file.size === 0 || file.size > 3 * 1024 * 1024) return fail(E("photoSize"), me.orgId);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) return fail(E("photoType"), me.orgId);
  const db = await shopDb();
  const { data: venue } = await db.from("venues").select("photo_path").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!venue) return fail(E("notFound"), me.orgId);
  const path = `${me.orgId}/venues/${id}-${randomUUID()}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`;
  const up = await db.storage.from(CLUB_MEDIA_BUCKET).upload(path, bytes, { contentType: type, upsert: false, cacheControl: "3600" });
  if (up.error) {
    logError("location.photo", up.error);
    return fail(E("generic"), me.orgId);
  }
  const { error } = await db.from("venues").update({ photo_path: path }).eq("id", id).eq("org_id", me.orgId);
  if (error) {
    await db.storage.from(CLUB_MEDIA_BUCKET).remove([path]);
    return fail(E("generic"), me.orgId);
  }
  const prev = (venue as { photo_path: string | null }).photo_path;
  if (prev && prev.startsWith(`${me.orgId}/venues/`)) await db.storage.from(CLUB_MEDIA_BUCKET).remove([prev]);
  await writeAudit(me, "location.photo", "venues", id, { size_bytes: bytes.byteLength });
  revalidatePath(`/admin/locations/${id}`);
  revalidatePath("/admin/locations");
  return { ok: true };
}

export async function removeLocationPhoto(id: string): Promise<LocationResult> {
  const me = await requireAdmin();
  if (!me) return fail(E("notPermitted"));
  if (!z.string().uuid().safeParse(id).success) return fail(E("invalidRequest"), me.orgId);
  const db = await shopDb();
  const { data: venue } = await db.from("venues").select("photo_path").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!venue) return fail(E("notFound"), me.orgId);
  const prev = (venue as { photo_path: string | null }).photo_path;
  const { error } = await db.from("venues").update({ photo_path: null }).eq("id", id).eq("org_id", me.orgId);
  if (error) return fail(E("generic"), me.orgId);
  if (prev && prev.startsWith(`${me.orgId}/venues/`)) await db.storage.from(CLUB_MEDIA_BUCKET).remove([prev]);
  revalidatePath(`/admin/locations/${id}`);
  return { ok: true };
}
