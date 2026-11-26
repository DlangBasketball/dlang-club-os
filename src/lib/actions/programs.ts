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
import { notifyWebsite } from "@/lib/website/webhooks";
import { revalidateSiteLive } from "@/lib/site/revalidate";
import { logError } from "@/lib/log";
import { programRpc } from "@/lib/programs/db";
import { parseProgramDeleteOutcome, parseProgramImpact, programErrorKey, type ProgramImpact } from "@/lib/programs/program-delete";

export type { ProgramInput } from "@/lib/club-ops/validation";
export type ProgramActionResult = { ok: true; id?: string; archived?: boolean } | { ok: false; error: string };

/** Admin of the current club only; org comes from the session, never from input. */
async function requireAdmin() {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return null;
  if (!(await tenantMatchesOrg(me.orgId))) return null;
  return me as typeof me & { orgId: string };
}

async function fail(key: string, orgId?: string | null): Promise<{ ok: false; error: string }> {
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
  notifyWebsite(me.orgId, "programs", "camps");
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
  notifyWebsite(me.orgId, "programs", "camps");
  revalidatePath("/register", "layout");
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Status, delete, archive, restore
//
// Delete / archive / restore go through the database functions of migration
// 20250420105300_program_delete_archive.sql: they check the admin role and the
// club again, lock the programme row and re-count linked records in the same
// transaction. A delete never archives silently: with linked records it is
// refused ("blocked" + fresh counts) and archiving is a separate call.
// ---------------------------------------------------------------------------

/** After a delete / archive / restore: every portal, public page, selector and the website. */
function revalidateProgramEverywhere(orgId: string) {
  try {
    revalidatePath("/", "layout");
  } catch {
    // No request context: short cache windows cover it.
  }
  revalidateSiteLive(orgId);
  notifyWebsite(orgId, "programs", "camps");
}

async function rpcFail(context: string, message: string, orgId: string): Promise<{ ok: false; error: string }> {
  logError(context, { message });
  const t = await getTranslations(orgId);
  return { ok: false, error: t.dynamic(programErrorKey(message), undefined, t("programDelete.errors.failed")) };
}

/** Publish / unpublish. Archiving goes through archiveProgram (audited, previous status kept). */
export async function setProgramStatus(id: string, status: ProgramStatus): Promise<ProgramActionResult> {
  if (status === "archived") {
    const res = await archiveProgram(id);
    return res.ok ? { ok: true, id, archived: true } : res;
  }
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
  notifyWebsite(me.orgId, "programs", "camps");
  revalidatePath("/register", "layout");
  return { ok: true, id };
}

export type ProgramImpactResult = { ok: true; impact: ProgramImpact } | { ok: false; error: string };

/** What deleting the programme would touch (linked records per category, upcoming sessions, current enrolments). */
export async function previewProgramDelete(id: string): Promise<ProgramImpactResult> {
  const me = await requireAdmin();
  if (!me) return fail("programDelete.errors.forbidden");
  if (!z.string().uuid().safeParse(id).success) return fail("programDelete.errors.notFound", me.orgId);
  const { data, error } = await programRpc("program_delete_impact", id);
  if (error) return rpcFail("programDelete.preview", error.message, me.orgId);
  const impact = parseProgramImpact(data);
  return impact ? { ok: true, impact } : fail("programDelete.errors.failed", me.orgId);
}

export type ProgramDeleteResult =
  | { ok: true; deleted: true }
  | { ok: true; deleted: false; impact: ProgramImpact; error: string }
  | { ok: false; error: string };

/**
 * Permanent delete of a programme with no linked records. With linked
 * records (also ones added since the preview) nothing changes: the result is
 * deleted=false with fresh counts, and the dialog offers "Archive programme".
 */
export async function deleteProgram(id: string): Promise<ProgramDeleteResult> {
  const me = await requireAdmin();
  if (!me) return fail("programDelete.errors.forbidden");
  if (!z.string().uuid().safeParse(id).success) return fail("programDelete.errors.notFound", me.orgId);
  const { data, error } = await programRpc("program_delete", id);
  if (error) return rpcFail("programDelete.delete", error.message, me.orgId);
  const outcome = parseProgramDeleteOutcome(data);
  if (!outcome) return fail("programDelete.errors.failed", me.orgId);
  if (!outcome.deleted) {
    const t = await getTranslations(me.orgId);
    return { ok: true, deleted: false, impact: outcome.impact, error: t("programDelete.errors.linked") };
  }
  revalidateProgramEverywhere(me.orgId);
  return { ok: true, deleted: true };
}

/** Archive: hidden from new registrations and active selectors; every linked record stays. */
export async function archiveProgram(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAdmin();
  if (!me) return fail("programDelete.errors.forbidden");
  if (!z.string().uuid().safeParse(id).success) return fail("programDelete.errors.notFound", me.orgId);
  const { error } = await programRpc("program_archive", id);
  if (error) return rpcFail("programDelete.archive", error.message, me.orgId);
  revalidateProgramEverywhere(me.orgId);
  return { ok: true };
}

/** Restore an archived programme to its status before archiving (draft when unknown). */
export async function restoreProgram(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAdmin();
  if (!me) return fail("programDelete.errors.forbidden");
  if (!z.string().uuid().safeParse(id).success) return fail("programDelete.errors.notFound", me.orgId);
  const { error } = await programRpc("program_restore", id);
  if (error) return rpcFail("programDelete.restore", error.message, me.orgId);
  revalidateProgramEverywhere(me.orgId);
  return { ok: true };
}

