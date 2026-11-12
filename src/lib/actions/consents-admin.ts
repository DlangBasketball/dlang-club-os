"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { requireRole, writeAudit, type ActionResult as PeopleResult } from "@/lib/people/server";
import {
  consentRecordSchema,
  consentWithdrawSchema,
  firstIssueKey,
  type ConsentRecordInput,
} from "@/lib/people/validation";
import { logError } from "@/lib/log";

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

/**
 * Record a consent given outside the app (paper form, e-mail, ...). Appends a
 * NEW acceptance row: who signed (guardian account and/or signer name), when
 * it was signed, which form version, and who recorded it. Existing records
 * are never overwritten; the wording snapshot is filled by the DB trigger.
 * Runs with the admin's session so consent RLS applies.
 */
export async function recordConsent(input: ConsentRecordInput): Promise<PeopleResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const p = consentRecordSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(firstIssueKey(p.error)) };
  const session = await createClient();
  const [{ data: athlete }, { data: form }] = await Promise.all([
    session.from("athletes").select("id,family_id").eq("id", p.data.athleteId).eq("org_id", me.orgId).maybeSingle(),
    session.from("consent_forms").select("id,version").eq("id", p.data.consentFormId).eq("org_id", me.orgId).maybeSingle(),
  ]);
  if (!athlete || !form) return { ok: false, error: t("editPeople.errors.notFound") };
  if (p.data.guardianId) {
    const { data: link } = await session
      .from("family_members")
      .select("profile_id")
      .eq("family_id", athlete.family_id)
      .eq("profile_id", p.data.guardianId)
      .maybeSingle();
    if (!link) return { ok: false, error: t("editPeople.consents.guardianNotInFamily") };
  }
  const { data, error } = await session
    .from("consent_acceptances")
    .insert({
      org_id: me.orgId,
      athlete_id: athlete.id,
      consent_form_id: form.id,
      accepted_version: form.version,
      accepted_by: p.data.guardianId,
      accepted_at: new Date(`${p.data.signedOn}T12:00:00Z`).toISOString(),
      status: "accepted",
      source: p.data.source,
      recorded_by: me.id,
      signer_name: p.data.signerName,
    })
    .select("id")
    .single();
  if (error || !data) {
    logError("recordConsent", error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  await writeAudit(me, "consent.record_manual", "consent_acceptances", data.id, { source: p.data.source, form_version: form.version });
  revalidatePath(`/admin/consents/${form.id}`);
  revalidatePath(`/admin/athletes/${athlete.id}`);
  revalidatePath(`/admin/athletes/${athlete.id}/edit`);
  return { ok: true, message: t("editPeople.consents.recorded") };
}

/** Withdraw (revoke) a consent with a reason. The record stays; only its status changes. */
export async function withdrawConsentRecord(acceptanceId: string, reason: string): Promise<PeopleResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const p = consentWithdrawSchema.safeParse({ acceptanceId, reason });
  if (!p.success) return { ok: false, error: t.dynamic(firstIssueKey(p.error)) };
  const session = await createClient();
  const { data: row } = await session
    .from("consent_acceptances")
    .select("athlete_id,consent_form_id")
    .eq("id", p.data.acceptanceId)
    .eq("org_id", me.orgId)
    .maybeSingle();
  if (!row) return { ok: false, error: t("editPeople.errors.notFound") };
  const { error } = await session.rpc("withdraw_consent_with_reason", { p_id: p.data.acceptanceId, p_reason: p.data.reason });
  if (error) {
    if (/NOT_ACTIVE/.test(error.message)) return { ok: false, error: t("editPeople.consents.alreadyWithdrawn") };
    logError("withdrawConsentRecord", error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  await writeAudit(me, "consent.withdraw", "consent_acceptances", p.data.acceptanceId);
  revalidatePath(`/admin/consents/${row.consent_form_id}`);
  revalidatePath(`/admin/athletes/${row.athlete_id}`);
  revalidatePath(`/admin/athletes/${row.athlete_id}/edit`);
  return { ok: true, message: t("editPeople.consents.withdrawn") };
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
