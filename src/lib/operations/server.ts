import "server-only";
import type { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { opsDbErrorKey, opsErrorKey } from "./validation";
import { opsDb } from "./db";

export { writeAudit } from "@/lib/people/server";

export type OpsResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };
export type Staff = SessionUser & { orgId: string };
type Role = "admin" | "finance" | "coach" | "parent";

/**
 * Session gate for the operations actions. The org always comes from the
 * signed-in user's profile and must match the club of the request host.
 */
export async function gate(roles: Role[]): Promise<{ me: Staff; t: Translator } | { me: null; t: Translator }> {
  const me = await getSessionUser();
  const t = await getTranslations(me?.orgId);
  if (!me?.orgId || !roles.some((r) => me.roles.includes(r)) || !(await tenantMatchesOrg(me.orgId))) return { me: null, t };
  return { me: me as Staff, t };
}

/**
 * Board area gate: an admin of the org, or a current member of the committee.
 * Uses the caller's RLS-scoped client, so the database decides (a committee
 * is only visible to its members and admins).
 */
export async function gateCommittee(committeeId: string): Promise<{ me: Staff; t: Translator } | { me: null; t: Translator }> {
  const me = await getSessionUser();
  const t = await getTranslations(me?.orgId);
  if (!me?.orgId || !(await tenantMatchesOrg(me.orgId))) return { me: null, t };
  const db = await opsDb();
  const { data } = await db.from("committees").select("id").eq("id", committeeId).eq("org_id", me.orgId).maybeSingle();
  return data ? { me: me as Staff, t } : { me: null, t };
}

export function fail(t: Translator, key: string): { ok: false; error: string } {
  return { ok: false, error: t.dynamic(key, undefined, t("operations.errors.generic")) };
}

export function dbFail(t: Translator, message: string | null | undefined): { ok: false; error: string } {
  return fail(t, opsDbErrorKey(message));
}

/** Validate input; on failure returns a translated error. */
export function parseInput<S extends z.ZodTypeAny>(schema: S, input: unknown, t: Translator):
  { ok: true; data: z.output<S> } | { ok: false; error: string } {
  const p = schema.safeParse(input);
  if (p.success) return { ok: true, data: p.data };
  return fail(t, opsErrorKey(p.error.issues));
}
