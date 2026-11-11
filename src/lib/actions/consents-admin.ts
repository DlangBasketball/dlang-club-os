"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function admin() {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return null;
  return me as typeof me & { orgId: string };
}

const schema = z.object({ key: z.string().min(2), title: z.string().min(2), body: z.string().min(10), required: z.boolean() });

/** Publish a new version of a consent form: supersede the active one, insert v+1. */
export async function publishConsentVersion(input: z.input<typeof schema>): Promise<ActionResult> {
  const me = await admin();
  if (!me) return { ok: false, error: "Admins only" };
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid input" };
  const sb = createAdminClient();
  const { data: existing } = await sb.from("consent_forms").select("version").eq("org_id", me.orgId).eq("key", p.data.key).order("version", { ascending: false }).limit(1);
  const nextVersion = ((existing?.[0]?.version as number | undefined) ?? 0) + 1;
  await sb.from("consent_forms").update({ is_active: false }).eq("org_id", me.orgId).eq("key", p.data.key);
  const { error } = await sb.from("consent_forms").insert({ org_id: me.orgId, key: p.data.key, title: p.data.title, body: p.data.body, version: nextVersion, locale: "en", is_required: p.data.required, is_active: true });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/consents");
  return { ok: true };
}

export async function toggleConsentForm(id: string, field: "is_active" | "is_required", value: boolean): Promise<ActionResult> {
  const me = await admin();
  if (!me) return { ok: false, error: "Admins only" };
  const sb = createAdminClient();
  const patch: Record<string, unknown> = { [field]: value };
  const { error } = await sb.from("consent_forms").update(patch).eq("id", id).eq("org_id", me.orgId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/consents");
  return { ok: true };
}
