"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Json } from "@/types/database";
import { formsDb } from "@/lib/forms/db";
import { firstIssueKey } from "@/lib/forms/schema";
import { normaliseConfig, registrationConfigSchema, type RegistrationConfigInput } from "@/lib/registration-form/config";
import { audit, dbFail, fail, ok, requireMe, type FormsResult } from "@/lib/forms/server";

/** Registration form editor: per programme / camp built-in fields and custom questions (admins). */
const isUuid = (v: unknown): v is string => typeof v === "string" && z.string().uuid().safeParse(v).success;

async function programSlug(programId: string, orgId: string): Promise<string | null | false> {
  const db = await formsDb();
  const { data } = await db.from("programs").select("id,slug").eq("id", programId).eq("org_id", orgId).maybeSingle();
  return data ? data.slug : false;
}

function revalidateConfig(programId: string, slug: string | null) {
  revalidatePath(`/admin/programs/${programId}`);
  revalidatePath(`/admin/programs/${programId}/registration-form`);
  if (slug) revalidatePath(`/register/${slug}`);
  revalidatePath("/parent/camps", "layout");
}

export async function saveRegistrationFormConfig(programId: string, input: RegistrationConfigInput): Promise<FormsResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  if (!isUuid(programId)) return fail("forms.errors.invalidRequest");
  const p = registrationConfigSchema.safeParse(input);
  if (!p.success) return fail(firstIssueKey(p.error));
  const slug = await programSlug(programId, me.orgId);
  if (slug === false) return fail("forms.errors.notFound");
  const cfg = normaliseConfig(p.data);
  const db = await formsDb();
  const { error } = await db.from("registration_form_configs").upsert({
    org_id: me.orgId, program_id: programId, builtin: cfg.builtin as unknown as Json, questions: cfg.questions as unknown as Json, updated_by: me.id,
  }, { onConflict: "program_id" });
  if (error) return dbFail(error.message);
  await audit(me, "registrationForm.save", "registration_form_configs", null, { programId, questions: cfg.questions.length });
  revalidateConfig(programId, slug);
  return ok("forms.messages.saved");
}

/** Back to the default form (the behaviour before any configuration). */
export async function resetRegistrationFormConfig(programId: string): Promise<FormsResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  if (!isUuid(programId)) return fail("forms.errors.invalidRequest");
  const slug = await programSlug(programId, me.orgId);
  if (slug === false) return fail("forms.errors.notFound");
  const db = await formsDb();
  const { error } = await db.from("registration_form_configs").delete().eq("program_id", programId).eq("org_id", me.orgId);
  if (error) return dbFail(error.message);
  await audit(me, "registrationForm.reset", "registration_form_configs", null, { programId });
  revalidateConfig(programId, slug);
  return ok("forms.messages.resetDone");
}
