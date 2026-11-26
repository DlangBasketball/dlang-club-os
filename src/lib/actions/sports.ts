"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { writeAudit } from "@/lib/people/server";
import { shopDb } from "@/lib/shop/db";
import { SPORT_ICON_KEYS, SPORT_TERMS } from "@/lib/sports/icons";
import type { Json } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/** Sports list per club (admin) and sport tags on teams / programmes / development items. */
export type SportResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
type Admin = SessionUser & { orgId: string };

const E = (k: string) => `sports.errors.${k}`;

async function fail(key: string, orgId?: string | null): Promise<{ ok: false; error: string }> {
  const t = await getTranslations(orgId);
  return { ok: false, error: t.dynamic(key, undefined, t("sports.errors.generic")) };
}
function dbKey(message: string): string {
  if (/sports_org_name_uidx|duplicate key/.test(message)) return E("nameTaken");
  if (/CROSS_ORG/.test(message)) return E("notFound");
  if (/row-level security|permission denied/.test(message)) return E("notPermitted");
  return E("generic");
}
async function requireAdmin(): Promise<Admin | null> {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin") || !(await tenantMatchesOrg(me.orgId))) return null;
  return me as Admin;
}

const sportSchema = z.object({
  name: z.string().trim().min(1, E("nameRequired")).max(60, E("tooLong")),
  icon: z.string().refine((v) => v === "" || SPORT_ICON_KEYS.includes(v), E("invalidRequest")).default(""),
  terminology: z.record(z.enum(SPORT_TERMS), z.string().trim().max(40, E("tooLong"))).default({}),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
});
export type SportInput = z.input<typeof sportSchema>;

export async function saveSport(id: string | null, input: SportInput): Promise<SportResult<{ id: string }>> {
  const me = await requireAdmin();
  if (!me) return fail(E("notPermitted"));
  if (id && !z.string().uuid().safeParse(id).success) return fail(E("invalidRequest"), me.orgId);
  const p = sportSchema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message.startsWith("sports.") ? p.error.issues[0].message : E("invalidRequest"), me.orgId);
  const terms = Object.fromEntries(Object.entries(p.data.terminology).filter(([, v]) => v));
  const row = { name: p.data.name, icon: p.data.icon || null, terminology: terms as Json, is_active: p.data.isActive, sort_order: p.data.sortOrder };
  const db = await shopDb();
  const res = id
    ? await db.from("sports").update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from("sports").insert({ ...row, org_id: me.orgId }).select("id");
  if (res.error) return fail(dbKey(res.error.message), me.orgId);
  if (!res.data?.length) return fail(E("notFound"), me.orgId);
  revalidatePath("/admin/sports");
  return { ok: true, data: { id: res.data[0].id } };
}

export async function deleteSport(id: string): Promise<SportResult> {
  const me = await requireAdmin();
  if (!me) return fail(E("notPermitted"));
  if (!z.string().uuid().safeParse(id).success) return fail(E("invalidRequest"), me.orgId);
  const db = await shopDb();
  const { data, error } = await db.from("sports").delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return fail(dbKey(error.message), me.orgId);
  if (!data?.length) return fail(E("notFound"), me.orgId);
  revalidatePath("/admin/sports");
  return { ok: true };
}

/** Tables that carry sport_id; the ones with a free-text sport keep it in sync. */
const TAGGABLE = {
  team: { table: "teams", text: true, path: (id: string) => `/admin/teams/${id}` },
  program: { table: "programs", text: false, path: (id: string) => `/admin/programs/${id}` },
  assessment: { table: "assessment_templates", text: true, path: (id: string) => `/admin/development/assessments/${id}` },
  exercise: { table: "exercises", text: true, path: () => "/admin/development/exercises" },
  plan: { table: "training_plans", text: true, path: () => "/admin/development/plans" },
} as const;
export type SportTagKind = keyof typeof TAGGABLE;

export async function setSportTag(kind: SportTagKind, recordId: string, sportId: string | null): Promise<SportResult> {
  const me = await requireAdmin();
  if (!me) return fail(E("notPermitted"));
  const target = TAGGABLE[kind];
  const uuid = z.string().uuid();
  if (!target || !uuid.safeParse(recordId).success || (sportId !== null && !uuid.safeParse(sportId).success)) return fail(E("invalidRequest"), me.orgId);
  const db = await shopDb();
  let name: string | null = null;
  if (sportId) {
    const { data } = await db.from("sports").select("name").eq("id", sportId).eq("org_id", me.orgId).maybeSingle();
    if (!data) return fail(E("notFound"), me.orgId);
    name = data.name;
  }
  const patch: Record<string, unknown> = { sport_id: sportId };
  if (target.text && name) patch.sport = name;
  // Generic client: the target table is one of the fixed names above (RLS applies).
  const generic = (await createClient()) as unknown as SupabaseClient;
  const { data, error } = await generic.from(target.table).update(patch).eq("id", recordId).eq("org_id", me.orgId).select("id");
  if (error) return fail(dbKey(error.message), me.orgId);
  if (!data?.length) return fail(E("notFound"), me.orgId);
  await writeAudit(me, "sport.tag", target.table, recordId, { sport_id: sportId });
  revalidatePath(target.path(recordId));
  return { ok: true };
}
