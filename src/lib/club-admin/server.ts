import "server-only";
import { randomUUID } from "node:crypto";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { logError } from "@/lib/log";
import type { Json } from "@/types/database";
import { caAdminDb, CLUB_ADMIN_BUCKET, SIGNED_URL_TTL } from "./db";
import { fileKey, isFileKeyFor, MAX_UPLOAD_BYTES, UPLOAD_TYPES } from "./validation";

/** Shared plumbing for the club-admin server actions. */
export type CaResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };
export type Me = SessionUser & { orgId: string };
export type Role = "admin" | "finance" | "coach" | "parent";

/** Session + role gate. The org always comes from the signed-in profile. */
export async function requireMe(roles: Role[]): Promise<Me | null> {
  const me = await getSessionUser();
  if (!me?.orgId || !roles.some((r) => me.roles.includes(r))) return null;
  return me as Me;
}

/** Translated failure; `key` is a full i18n key (clubadmin.errors.*). */
export async function fail(key: string): Promise<{ ok: false; error: string }> {
  const t = await getTranslations();
  return { ok: false, error: t.dynamic(key, undefined, t("clubadmin.errors.generic")) };
}

export async function done<T>(key: string, data?: T, values?: Record<string, string | number>): Promise<CaResult<T>> {
  const t = await getTranslations();
  return { ok: true, message: t.dynamic(key, values, ""), data };
}

/** Database error -> i18n key (RPC exception names are stable codes). */
export function dbErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  const codes = [
    "ALREADY_MEMBER", "ALREADY_RENEWED", "ATHLETE_REQUIRED", "AGE_OUT_OF_RANGE", "TYPE_INACTIVE", "TYPE_NOT_FOUND",
    "MEMBERSHIP_CANCELLED", "OFFER_NOT_OPEN", "OFFER_NOT_FOUND", "NO_SPOT_LEFT", "ENTRY_NOT_WAITING", "PRICE_OPTION_NOT_FOUND",
    "AHV_INVALID", "CONSENT_REQUIRED", "COACH_COMPLIANCE_MISSING", "REASON_REQUIRED", "ATHLETE_NOT_IN_FAMILY",
  ];
  for (const c of codes) if (m.includes(c)) return `clubadmin.errors.codes.${c}`;
  if (m.includes("waitlist_one_active_uidx")) return "clubadmin.errors.codes.ALREADY_WAITING";
  if (/row-level security|NOT_AUTHORIZED|permission denied/i.test(m)) return "clubadmin.errors.forbidden";
  return "clubadmin.errors.generic";
}

/**
 * Intent-level audit row (row-level triggers also capture the data change,
 * with sensitive columns redacted). Never put health details, identity
 * numbers or free text about a child in `data`.
 */
export async function audit(
  me: { id: string | null; orgId: string },
  action: string,
  table: string,
  id: string | null,
  data: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { error } = await caAdminDb().from("audit_logs").insert({
      org_id: me.orgId, actor_id: me.id, action, target_table: table, target_id: id, new_data: data as Json,
    });
    if (error) logError("clubadmin.audit", error, { action });
  } catch (e) {
    logError("clubadmin.audit", e, { action });
  }
}

/**
 * Upload one document (PDF / image) to the private bucket. The caller has
 * already checked the user may write the owning record. Returns the key.
 */
export async function uploadPrivateFile(
  orgId: string,
  area: "certificates" | "incidents",
  ownerId: string,
  file: File,
): Promise<{ ok: true; path: string; name: string } | { ok: false; key: string }> {
  const ext = UPLOAD_TYPES[file.type];
  if (!ext) return { ok: false, key: "clubadmin.errors.fileType" };
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) return { ok: false, key: "clubadmin.errors.fileSize" };
  const path = fileKey(orgId, area, ownerId, randomUUID(), ext);
  const { error } = await caAdminDb().storage.from(CLUB_ADMIN_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), {
    contentType: file.type, upsert: false,
  });
  if (error) {
    logError("clubadmin.upload", error, { area });
    return { ok: false, key: "clubadmin.errors.uploadFailed" };
  }
  const name = (file.name || `document.${ext}`).replace(/[^\p{L}\p{N} ._-]/gu, "_").slice(0, 200);
  return { ok: true, path, name };
}

export async function removePrivateFile(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    await caAdminDb().storage.from(CLUB_ADMIN_BUCKET).remove([path]);
  } catch (e) {
    logError("clubadmin.remove", e);
  }
}

/**
 * Short-lived signed URL for a document the caller was allowed to read (the
 * caller selected the owning row through RLS first). Audit-logged.
 */
export async function signedFileUrl(
  me: { id: string; orgId: string },
  area: "certificates" | "incidents",
  ownerId: string,
  path: string | null | undefined,
  table: string,
  rowId: string,
): Promise<string | null> {
  if (!isFileKeyFor(path, me.orgId, area, ownerId)) return null;
  const { data, error } = await caAdminDb().storage.from(CLUB_ADMIN_BUCKET).createSignedUrl(path as string, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) return null;
  await audit(me, `${area}.file.read`, table, rowId);
  return data.signedUrl;
}

/** The club's local calendar day. */
export function clubDay(timeZone: string, d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
