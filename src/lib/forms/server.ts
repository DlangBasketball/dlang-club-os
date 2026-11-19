import "server-only";
import { headers } from "next/headers";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { logError } from "@/lib/log";
import { env } from "@/lib/env";
import type { Json } from "@/types/database";
import { formsAdminDb } from "./db";
import { formsErrorKey } from "./errors";
import { firstForwardedIp, hashIp } from "./paths";

/** Shared plumbing for the forms / contracts / registration-form actions. */
export type FormsResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };
export type Me = SessionUser & { orgId: string };
export type Role = "admin" | "finance" | "coach" | "parent";

export async function requireMe(roles: Role[]): Promise<Me | null> {
  const me = await getSessionUser();
  if (!me?.orgId || !roles.some((r) => me.roles.includes(r))) return null;
  return me as Me;
}

export async function fail(key: string, orgId?: string | null): Promise<{ ok: false; error: string }> {
  const t = await getTranslations(orgId);
  return { ok: false, error: t.dynamic(key, undefined, t("forms.errors.generic")) };
}
export const dbFail = (message: string | null | undefined) => fail(formsErrorKey(message));

export async function ok<T>(messageKey: string, data?: T): Promise<FormsResult<T>> {
  const t = await getTranslations();
  return { ok: true, message: t.dynamic(messageKey, undefined, ""), data };
}

/** Intent-level audit row. Never put answers, signatures or contract text in `data`. */
export async function audit(me: { id: string | null; orgId: string }, action: string, table: string, id: string | null, data: Record<string, unknown> = {}) {
  try {
    const { error } = await formsAdminDb().from("audit_logs").insert({
      org_id: me.orgId, actor_id: me.id, action, target_table: table, target_id: id, new_data: data as Json,
    });
    if (error) logError("forms.audit", error, { action });
  } catch (e) {
    logError("forms.audit", e, { action });
  }
}

/** Keyed hash of the caller's IP for consent / contract evidence. */
export async function requestIpHash(orgId: string): Promise<string | null> {
  try {
    const h = await headers();
    const ip = firstForwardedIp(h.get("x-forwarded-for")) ?? h.get("x-real-ip");
    return hashIp(ip, orgId, env.serviceRoleKey());
  } catch {
    return null;
  }
}
