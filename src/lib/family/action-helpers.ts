import "server-only";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { logError } from "@/lib/log";
import { familyAdminDb } from "./db";

export type FamilyResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

/** Database error codes raised by the family migration, mapped to family.errors.<code>. */
export const DB_CODES = [
  "NO_MEMBERSHIP", "NOT_FOUND", "NOT_ALLOWED", "NOT_A_GUARDIAN", "CANNOT_REMOVE_PRIMARY", "SHARES_MUST_TOTAL_100",
  "SPLIT_NEEDS_TWO_PAYERS", "SHARE_NOT_A_PAYER", "INVALID_SHARES", "ALREADY_SPLIT", "INVOICE_NOT_OPEN",
  "INVOICE_NOT_SPLITTABLE", "FAMILY_NOT_SPLIT", "INVOICE_LINKED", "SAME_FAMILY", "NOT_OPEN", "EVENT_CLOSED",
  "NOT_ENOUGH_SEATS", "GUARDIAN_CONSENT_REQUIRED", "INVALID_EXPIRY", "NO_FIELDS", "CROSS_ORG_REFERENCE",
] as const;
export type DbCode = (typeof DB_CODES)[number];

/** First known code in a database error message, else "generic". */
export function dbCode(message: string | null | undefined): DbCode | "generic" | "forbidden" {
  if (!message) return "generic";
  for (const c of DB_CODES) if (message.includes(c)) return c;
  if (/row-level security|permission denied/i.test(message)) return "forbidden";
  return "generic";
}

/** Translated failure for a code under family.errors.*. */
export async function fail(code: string): Promise<{ ok: false; error: string }> {
  const t = await getTranslations();
  return { ok: false, error: t.dynamic(`family.errors.${code}`, undefined, t("family.errors.generic")) };
}

/** Translated failure for a database error (logged without personal data). */
export async function failDb(scope: string, err: { message?: string } | null | undefined): Promise<{ ok: false; error: string }> {
  const code = dbCode(err?.message);
  if (code === "generic") logError(scope, err);
  return fail(code);
}

export async function ok<T>(messageKey: string, data?: T): Promise<{ ok: true; data?: T; message: string }> {
  const t = await getTranslations();
  return { ok: true, data, message: t.dynamic(messageKey) };
}

/** Signed-in user with a current club (org comes from the session, never the client). */
export async function requireMember(): Promise<(SessionUser & { orgId: string }) | null> {
  const me = await getSessionUser();
  if (!me?.orgId) return null;
  return me as SessionUser & { orgId: string };
}

/** Append-only audit row (service role; org from the session). */
export async function audit(me: { id: string; orgId: string }, action: string, table: string, targetId: string | null, data?: Record<string, unknown>): Promise<void> {
  try {
    await familyAdminDb().from("audit_logs").insert({
      org_id: me.orgId, actor_id: me.id, action, target_table: table, target_id: targetId, new_data: (data ?? null) as never,
    });
  } catch (e) {
    logError("family.audit", e);
  }
}

/** The current user's families in the current club (guardian links). */
export async function myFamilyIds(me: { id: string; orgId: string }): Promise<string[]> {
  const db = familyAdminDb();
  const { data: links } = await db.from("family_members").select("family_id").eq("profile_id", me.id);
  const ids = (links ?? []).map((l) => l.family_id);
  if (!ids.length) return [];
  const { data: fams } = await db.from("families").select("id").in("id", ids).eq("org_id", me.orgId);
  return (fams ?? []).map((f) => f.id);
}
