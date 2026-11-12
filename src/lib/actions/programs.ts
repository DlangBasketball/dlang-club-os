"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { dbErrorKey, programRow, programSchema, zodErrorKey, PROGRAM_STATUSES, type ProgramInput, type ProgramStatus } from "@/lib/club-ops/validation";

export type { ProgramInput } from "@/lib/club-ops/validation";
export type ProgramActionResult = { ok: true; id?: string; archived?: boolean } | { ok: false; error: string };

/** Admin of the current club only; org comes from the session, never from input. */
async function requireAdmin() {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return null;
  if (!(await tenantMatchesOrg(me.orgId))) return null;
  return me as typeof me & { orgId: string };
}

async function fail(key: string, orgId?: string | null): Promise<ProgramActionResult> {
  const t = await getTranslations(orgId);
  return { ok: false, error: t.dynamic(key, undefined, t("editOps.errors.generic")) };
}

/** Public registration URLs look programmes up by slug, so make it unique platform-wide. */
function slugFor(name: string): string {
  const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "program";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

function revalidateProgram(id?: string) {
  revalidatePath("/admin/programs");
  if (id) {
    revalidatePath(`/admin/programs/${id}`);
    revalidatePath(`/admin/programs/${id}/edit`);
  }
}

export async function createProgram(input: ProgramInput): Promise<ProgramActionResult> {
  const me = await requireAdmin();
  if (!me) return fail("editOps.errors.notPermitted");
  const parsed = programSchema.safeParse(input);
  if (!parsed.success) return fail(zodErrorKey(parsed.error), me.orgId);

  const supabase = await createClient();
  // org_id comes from the session, and RLS (programs_admin_write) re-checks it.
  const { data, error } = await supabase
    .from("programs")
    .insert({ ...programRow(parsed.data), org_id: me.orgId, slug: slugFor(parsed.data.name) } as never)
    .select("id")
    .single();
  if (error || !data) return fail(dbErrorKey(error?.message), me.orgId);
  revalidateProgram();
  redirect(`/admin/programs/${(data as { id: string }).id}`);
}

export async function updateProgram(id: string, input: ProgramInput): Promise<ProgramActionResult> {
  const me = await requireAdmin();
  if (!me) return fail("editOps.errors.notPermitted");
  if (!z.string().uuid().safeParse(id).success) return fail("editOps.errors.invalidRequest", me.orgId);
  const parsed = programSchema.safeParse(input);
  if (!parsed.success) return fail(zodErrorKey(parsed.error), me.orgId);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("programs")
    .update(programRow(parsed.data) as never)
    .eq("id", id)
    .eq("org_id", me.orgId)
    .select("id");
  if (error) return fail(dbErrorKey(error.message), me.orgId);
  if (!data?.length) return fail("editOps.errors.notFound", me.orgId);
  revalidateProgram(id);
  revalidatePath("/register", "layout");
  return { ok: true, id };
}

export async function setProgramStatus(id: string, status: ProgramStatus): Promise<ProgramActionResult> {
  const me = await requireAdmin();
  if (!me) return fail("editOps.errors.notPermitted");
  if (!z.string().uuid().safeParse(id).success || !(PROGRAM_STATUSES as readonly string[]).includes(status)) {
    return fail("editOps.errors.invalidRequest", me.orgId);
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("programs")
    .update({ status } as never)
    .eq("id", id)
    .eq("org_id", me.orgId)
    .select("id");
  if (error) return fail(dbErrorKey(error.message), me.orgId);
  if (!data?.length) return fail("editOps.errors.notFound", me.orgId);
  revalidateProgram(id);
  revalidatePath("/register", "layout");
  return { ok: true, id };
}

/**
 * Deletes a programme that has no registrations. With registrations it is
 * archived instead (history, invoices and attendance stay intact).
 */
export async function deleteProgram(id: string): Promise<ProgramActionResult> {
  const me = await requireAdmin();
  if (!me) return fail("editOps.errors.notPermitted");
  if (!z.string().uuid().safeParse(id).success) return fail("editOps.errors.invalidRequest", me.orgId);
  const supabase = await createClient();
  const { count, error: cErr } = await supabase
    .from("registrations")
    .select("id", { count: "exact", head: true })
    .eq("program_id", id)
    .eq("org_id", me.orgId);
  if (cErr) return fail(dbErrorKey(cErr.message), me.orgId);

  if ((count ?? 0) > 0) {
    const res = await setProgramStatus(id, "archived");
    return res.ok ? { ok: true, id, archived: true } : res;
  }
  const { data, error } = await supabase.from("programs").delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) {
    // Registrations raced in: fall back to archiving.
    if (/PROGRAM_HAS_REGISTRATIONS/.test(error.message)) {
      const res = await setProgramStatus(id, "archived");
      return res.ok ? { ok: true, id, archived: true } : res;
    }
    return fail(dbErrorKey(error.message), me.orgId);
  }
  if (!data?.length) return fail("editOps.errors.notFound", me.orgId);
  revalidateProgram();
  return { ok: true };
}
