"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "@/lib/i18n/server";
import { logError } from "@/lib/log";
import { sendEmail } from "@/lib/email/resend";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { escapeHtml } from "@/lib/contracts/merge";
import type { Json } from "@/types/database";
import { formsAdminDb, formsDb, FORM_FILES_BUCKET } from "@/lib/forms/db";
import { formDefinitionSchema, firstIssueKey, parseDefinition, type FormDefinitionInput } from "@/lib/forms/schema";
import { answerPaths, needsAction, signatureOf, validateAnswers, type Answers } from "@/lib/forms/logic";
import { MAX_UPLOAD_BYTES, UPLOAD_TYPES, decodePngDataUrl, formFilePath, isFormFilePathFor } from "@/lib/forms/paths";
import { assignmentSchema, formMetaSchema, reasonSchema, submitSchema, zodKey, type AssignmentInput, type FormMetaInput, type SubmitInput } from "@/lib/forms/validation";
import { getCompletion, guardianAthletes } from "@/lib/forms/data";
import { audit, dbFail, fail, ok, requestIpHash, requireMe, type FormsResult, type Me } from "@/lib/forms/server";

/**
 * Form builder, assignments, submissions and reminders. Every action: role
 * check, org from the session, zod validation, RLS-scoped writes with the
 * user's own session (service role only for audit rows, scope evaluation and
 * notifications), an audit_logs row, path revalidation, translated messages.
 */

const isUuid = (v: unknown): v is string => typeof v === "string" && z.string().uuid().safeParse(v).success;

function revalidateForms(id?: string) {
  revalidatePath("/admin/forms", "layout");
  if (id) revalidatePath(`/admin/forms/${id}`);
  revalidatePath("/parent/forms", "layout");
}

// ===========================================================================
// Builder
// ===========================================================================
export async function createForm(input: FormMetaInput): Promise<FormsResult<{ id: string }>> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  const p = formMetaSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const db = await formsDb();
  const draft = { sections: [{ id: "s1", title: "", description: "", fields: [] }] };
  const { data, error } = await db.from("forms").insert({
    org_id: me.orgId, title: p.data.title, description: p.data.description || null, form_type: p.data.formType, draft_schema: draft, created_by: me.id,
  }).select("id").single();
  if (error || !data) return dbFail(error?.message);
  await audit(me, "forms.create", "forms", data.id, { formType: p.data.formType });
  revalidateForms(data.id);
  return ok("forms.messages.created", { id: data.id });
}

export async function saveFormDraft(id: string, meta: FormMetaInput, definition: FormDefinitionInput): Promise<FormsResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  if (!isUuid(id)) return fail("forms.errors.invalidRequest");
  const m = formMetaSchema.safeParse(meta);
  if (!m.success) return fail(zodKey(m.error));
  const d = formDefinitionSchema.safeParse(definition);
  if (!d.success) return fail(firstIssueKey(d.error));
  const db = await formsDb();
  const { data, error } = await db.from("forms").update({
    title: m.data.title, description: m.data.description || null, form_type: m.data.formType, draft_schema: d.data as unknown as Json,
  }).eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("forms.errors.notFound");
  await audit(me, "forms.draft.save", "forms", id, { fields: d.data.sections.reduce((n, s) => n + s.fields.length, 0) });
  revalidateForms(id);
  return ok("forms.messages.saved");
}

/** Publish the saved draft as a new immutable version (old submissions keep theirs). */
export async function publishForm(id: string): Promise<FormsResult<{ versionId: string }>> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  if (!isUuid(id)) return fail("forms.errors.invalidRequest");
  const db = await formsDb();
  const { data: f } = await db.from("forms").select("draft_schema").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!f) return fail("forms.errors.notFound");
  const d = formDefinitionSchema.safeParse(f.draft_schema);
  if (!d.success) return fail(firstIssueKey(d.error));
  const { data, error } = await db.rpc("publish_form", { p_form: id });
  if (error) return dbFail(error.message);
  await audit(me, "forms.publish", "forms", id, { versionId: data });
  revalidateForms(id);
  return ok("forms.messages.published", { versionId: String(data) });
}

export async function setFormArchived(id: string, archived: boolean): Promise<FormsResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  if (!isUuid(id)) return fail("forms.errors.invalidRequest");
  const db = await formsDb();
  const { data: f } = await db.from("forms").select("current_version_id").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!f) return fail("forms.errors.notFound");
  const status = archived ? "archived" : f.current_version_id ? "published" : "draft";
  const { error } = await db.from("forms").update({ status }).eq("id", id).eq("org_id", me.orgId);
  if (error) return dbFail(error.message);
  await audit(me, archived ? "forms.archive" : "forms.restore", "forms", id);
  revalidateForms(id);
  return ok(archived ? "forms.messages.archived" : "forms.messages.restored");
}

export async function deleteDraftForm(id: string): Promise<FormsResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  if (!isUuid(id)) return fail("forms.errors.invalidRequest");
  const db = await formsDb();
  const { data, error } = await db.from("forms").delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("forms.errors.cannotDelete");
  await audit(me, "forms.delete", "forms", id);
  revalidateForms();
  return ok("forms.messages.deleted");
}

// ===========================================================================
// Assignments
// ===========================================================================
export async function saveAssignment(formId: string, id: string | null, input: AssignmentInput): Promise<FormsResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  if (!isUuid(formId) || (id !== null && !isUuid(id))) return fail("forms.errors.invalidRequest");
  const p = assignmentSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const row = {
    scope: v.scope,
    program_id: v.scope === "program" ? v.targetId : null,
    team_id: v.scope === "team" ? v.targetId : null,
    training_service_id: v.scope === "training_service" ? v.targetId : null,
    renewal: v.renewal,
    renewal_months: v.renewal === "months" ? v.renewalMonths : null,
    due_date: v.dueDate,
    is_required: v.isRequired,
    is_active: v.isActive,
  };
  const db = await formsDb();
  if (id) {
    const { data, error } = await db.from("form_assignments").update(row).eq("id", id).eq("form_id", formId).eq("org_id", me.orgId).select("id");
    if (error) return dbFail(error.message);
    if (!data?.length) return fail("forms.errors.notFound");
  } else {
    const { error } = await db.from("form_assignments").insert({ ...row, org_id: me.orgId, form_id: formId, created_by: me.id });
    if (error) return dbFail(error.message);
  }
  await audit(me, id ? "forms.assignment.update" : "forms.assignment.create", "form_assignments", id, { formId, scope: v.scope, renewal: v.renewal });
  revalidateForms(formId);
  return ok("forms.messages.saved");
}

export async function deleteAssignment(id: string): Promise<FormsResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  if (!isUuid(id)) return fail("forms.errors.invalidRequest");
  const db = await formsDb();
  const { data, error } = await db.from("form_assignments").delete().eq("id", id).eq("org_id", me.orgId).select("form_id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("forms.errors.notFound");
  await audit(me, "forms.assignment.delete", "form_assignments", id);
  revalidateForms(data[0].form_id);
  return ok("forms.messages.deleted");
}

// ===========================================================================
// Filling in
// ===========================================================================
/** The athlete's family, if the caller is an admin of the org or one of its guardians. */
async function familyFor(me: Me, athleteId: string): Promise<string | null> {
  if (me.roles.includes("admin")) {
    const { data } = await formsAdminDb().from("athletes").select("family_id").eq("id", athleteId).eq("org_id", me.orgId).maybeSingle();
    if (data) return data.family_id;
  }
  return (await guardianAthletes(me)).find((a) => a.id === athleteId)?.familyId ?? null;
}

/** Upload one attachment for a form answer (private bucket, family folder). */
export async function uploadFormFile(formData: FormData): Promise<FormsResult<{ path: string; name: string; mime: string }>> {
  const me = await requireMe(["parent", "admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  const athleteId = formData.get("athleteId");
  const file = formData.get("file");
  if (!isUuid(athleteId) || !(file instanceof File)) return fail("forms.errors.invalidRequest");
  const ext = UPLOAD_TYPES[file.type];
  if (!ext) return fail("forms.errors.fileType");
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) return fail("forms.errors.fileSize");
  const familyId = await familyFor(me, athleteId);
  if (!familyId) return fail("forms.errors.notPermitted");
  const path = formFilePath(me.orgId, familyId, ext);
  const db = await formsDb();
  const { error } = await db.storage.from(FORM_FILES_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    logError("forms.upload", error);
    return fail("forms.errors.uploadFailed");
  }
  await audit(me, "forms.file.upload", "form_submissions", null, { athleteId, mime: file.type, size: file.size });
  return { ok: true, data: { path, name: file.name.slice(0, 200), mime: file.type } };
}

export async function submitForm(input: SubmitInput): Promise<FormsResult<{ id: string }> & { fieldErrors?: Record<string, string> }> {
  const me = await requireMe(["parent", "admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  const p = submitSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const familyId = await familyFor(me, v.athleteId);
  if (!familyId) return fail("forms.errors.notPermitted");

  const db = await formsDb();
  const { data: form } = await db.from("forms").select("id,status,current_version_id").eq("id", v.formId).eq("org_id", me.orgId).maybeSingle();
  if (!form || form.status !== "published") return fail("forms.errors.notFound");
  if (form.current_version_id !== v.versionId) return fail("forms.errors.versionChanged");
  const { data: version } = await db.from("form_versions").select("schema").eq("id", v.versionId).maybeSingle();
  if (!version) return fail("forms.errors.notFound");
  const def = parseDefinition(version.schema);

  // Drawn signatures: PNG uploaded to the family folder before validation.
  const raw: Record<string, unknown> = { ...v.answers };
  for (const f of def.sections.flatMap((s) => s.fields)) {
    if (f.type !== "signature") continue;
    const typed = (raw[f.id] ?? {}) as { name?: unknown };
    const dataUrl = v.signatures[f.id];
    let path: string | null = null;
    if (dataUrl) {
      const png = decodePngDataUrl(dataUrl);
      if (!png) return fail("forms.errors.signatureDrawn");
      path = formFilePath(me.orgId, familyId, "png");
      const { error } = await db.storage.from(FORM_FILES_BUCKET).upload(path, png, { contentType: "image/png", upsert: false });
      if (error) {
        logError("forms.signatureUpload", error);
        return fail("forms.errors.uploadFailed");
      }
    }
    raw[f.id] = { name: typeof typed.name === "string" ? typed.name : "", path };
  }

  const res = validateAnswers(def, raw, { pathOk: (path) => isFormFilePathFor(path, me.orgId, familyId) });
  if (!res.ok) {
    const t = await getTranslations();
    const fieldErrors = Object.fromEntries(Object.entries(res.errors).map(([k, key]) => [k, t.dynamic(key, undefined, t("forms.errors.generic"))]));
    return { ok: false, error: t("forms.errors.fixFields"), fieldErrors };
  }
  const sig = signatureOf(def, res.values);
  const { data, error } = await db.from("form_submissions").insert({
    org_id: me.orgId, form_id: v.formId, form_version_id: v.versionId, assignment_id: v.assignmentId, athlete_id: v.athleteId,
    family_id: familyId, answers: res.values as unknown as Json, signer_name: sig?.name ?? null, signature_path: sig?.path ?? null,
    ip_hash: await requestIpHash(me.orgId), submitted_by: me.id,
  }).select("id").single();
  if (error || !data) return dbFail(error?.message);
  await audit(me, "forms.submit", "form_submissions", data.id, {
    formId: v.formId, versionId: v.versionId, athleteId: v.athleteId, files: answerPaths(def, res.values as Answers).length,
  });
  revalidateForms(v.formId);
  revalidatePath(`/admin/athletes/${v.athleteId}`);
  return ok("forms.messages.submitted", { id: data.id });
}

export async function voidSubmission(id: string, reason: string): Promise<FormsResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  if (!isUuid(id)) return fail("forms.errors.invalidRequest");
  const p = reasonSchema.safeParse({ reason });
  if (!p.success) return fail(zodKey(p.error));
  const db = await formsDb();
  const { data, error } = await db.from("form_submissions").update({ status: "voided", void_reason: p.data.reason })
    .eq("id", id).eq("org_id", me.orgId).select("form_id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("forms.errors.notFound");
  await audit(me, "forms.submission.void", "form_submissions", id);
  revalidateForms(data[0].form_id);
  revalidatePath(`/admin/forms/submissions/${id}`);
  return ok("forms.messages.voided");
}

// ===========================================================================
// Reminders
// ===========================================================================
const REMINDER_COOLDOWN_DAYS = 3;

/** Remind families with missing / expired / expiring forms (in-app + email). */
export async function sendFormReminders(formId: string | null): Promise<FormsResult<{ families: number; skipped: number }>> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  if (formId !== null && !isUuid(formId)) return fail("forms.errors.invalidRequest");
  const completion = await getCompletion(formId ? { formId } : {});
  if (completion.error !== null) return fail("forms.errors.generic");

  // family -> assignment ids + form titles needing action
  const byFamily = new Map<string, { assignments: Set<string>; titles: Set<string>; athleteIds: Set<string> }>();
  for (const c of completion.data) {
    if (!c.assignment.isRequired) continue;
    for (const a of c.athletes) {
      if (!needsAction(a.status)) continue;
      const cur = byFamily.get(a.familyId) ?? { assignments: new Set(), titles: new Set(), athleteIds: new Set() };
      cur.assignments.add(c.assignment.id);
      cur.titles.add(c.formTitle);
      cur.athleteIds.add(a.athleteId);
      byFamily.set(a.familyId, cur);
    }
  }
  if (!byFamily.size) return ok("forms.messages.nothingToRemind", { families: 0, skipped: 0 });

  const admin = formsAdminDb();
  const since = new Date(Date.now() - REMINDER_COOLDOWN_DAYS * 864e5).toISOString();
  const { data: recent } = await admin.from("form_reminders").select("family_id,assignment_id").eq("org_id", me.orgId).gte("sent_at", since);
  const recentKeys = new Set((recent ?? []).map((r) => `${r.family_id}|${r.assignment_id}`));
  const famIds = Array.from(byFamily.keys());
  const { data: members } = await admin.from("family_members").select("family_id,profile_id").in("family_id", famIds);
  const profileIds = Array.from(new Set((members ?? []).map((m) => m.profile_id)));
  const { data: profiles } = profileIds.length
    ? await admin.from("profiles").select("id,email,org_id").in("id", profileIds).eq("org_id", me.orgId)
    : { data: [] as { id: string; email: string; org_id: string }[] };
  const profMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const org = await getOrgEmailContext(me.orgId);
  const t = await getTranslations(me.orgId);
  const link = org.link("/parent/forms");
  let sent = 0;
  let skipped = 0;
  for (const [familyId, info] of Array.from(byFamily.entries())) {
    const due = Array.from(info.assignments).filter((a) => !recentKeys.has(`${familyId}|${a}`));
    if (!due.length) {
      skipped++;
      continue;
    }
    const titles = Array.from(info.titles).join(", ");
    const title = t("forms.reminder.title");
    const body = t("forms.reminder.body", { forms: titles, club: org.clubName });
    const guardians = (members ?? []).filter((m) => m.family_id === familyId).map((m) => profMap.get(m.profile_id)).filter((p): p is NonNullable<typeof p> => !!p);
    for (const g of guardians) {
      const { error } = await admin.from("notifications").insert({ org_id: me.orgId, recipient_id: g.id, type: "consent_required", title, body, link: "/parent/forms" });
      if (error) logError("forms.reminder.notify", error);
      if (g.email) {
        const html = `<p>${escapeHtml(body)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(t("forms.reminder.cta"))}</a></p>`;
        const r = await sendEmail({ to: g.email, subject: t("forms.reminder.subject", { club: org.clubName }), html, fromName: org.senderName ?? org.clubName });
        if (!r.ok) logError("forms.reminder.email", r.error ?? "send failed");
      }
    }
    const { error } = await admin.from("form_reminders").insert(due.map((assignment_id) => ({ org_id: me.orgId, assignment_id, family_id: familyId, sent_by: me.id })));
    if (error) logError("forms.reminder.log", error);
    sent++;
  }
  await audit(me, "forms.reminders.send", "form_reminders", null, { families: sent, skipped, formId });
  revalidateForms(formId ?? undefined);
  const tt = await getTranslations();
  return { ok: true, message: tt("forms.messages.remindersSent", { count: sent }), data: { families: sent, skipped } };
}
