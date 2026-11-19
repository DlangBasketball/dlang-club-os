"use server";

import { revalidatePath } from "next/cache";
import { requireRole, writeAudit, type ActionResult } from "@/lib/people/server";
import { sniffImageType } from "@/lib/people/validation";
import { staffDb } from "@/lib/staff/db";
import {
  LESSON_PLAN_BUCKET,
  LESSON_PLAN_MAX_BYTES,
  LESSON_PLAN_TYPES,
  lessonPlanSchema,
  staffErrorKey,
  uuid,
  type LessonPlanInput,
} from "@/lib/staff/validation";
import { logError } from "@/lib/log";

/**
 * Lesson plans per programme session / team event. Written by the session's
 * coach (or a coach of the event's team) and admins; RLS (lesson_plans_*) and
 * public.can_plan_lesson enforce the same rule. Attachments live in the
 * private "lesson-plans" bucket at <org_id>/<plan_id>/<random>.<ext>.
 * Audit: the table trigger records each change; writeAudit adds the intent.
 */

function revalidatePlan(kind: "session" | "event", itemId: string) {
  revalidatePath(`/coach/lesson-plans/${kind}/${itemId}`);
  revalidatePath(`/admin/lesson-plans/${kind}/${itemId}`);
  revalidatePath("/admin/lesson-plans");
  revalidatePath("/coach", "layout");
  revalidatePath("/parent/schedule");
  revalidatePath("/parent/calendar");
}

export async function saveLessonPlan(input: LessonPlanInput): Promise<ActionResult<{ id: string }>> {
  const { me, t } = await requireRole(["admin", "coach"]);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  const p = lessonPlanSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("staff.errors.invalid") };
  const db = await staffDb();
  const { kind, itemId } = p.data;
  const { data: can } = await db.rpc("can_plan_lesson", { p_session: kind === "session" ? itemId : null, p_event: kind === "event" ? itemId : null });
  if (can !== true) return { ok: false, error: t("staff.errors.forbidden") };

  const col = kind === "session" ? "program_session_id" : "event_id";
  const { data: existing } = await db.from("lesson_plans").select("id,shared_with_parents,shared_at").eq("org_id", me.orgId).eq(col, itemId).maybeSingle();
  const { data: coach } = await db.from("coaches").select("id").eq("org_id", me.orgId).eq("profile_id", me.id).limit(1).maybeSingle();
  const fields = {
    title: p.data.title,
    objectives: p.data.objectives,
    drills: p.data.drills,
    notes: p.data.notes,
    shared_with_parents: p.data.sharedWithParents,
    shared_at: p.data.sharedWithParents ? (existing?.shared_with_parents ? existing.shared_at : new Date().toISOString()) : null,
  };
  const res = existing
    ? await db.from("lesson_plans").update(fields).eq("id", existing.id).eq("org_id", me.orgId).select("id").maybeSingle()
    : await db.from("lesson_plans").insert({
        ...fields,
        org_id: me.orgId,
        [col]: itemId,
        coach_id: coach?.id ?? null,
        author_id: me.id,
      }).select("id").single();
  if (res.error || !res.data) {
    logError("lessonPlans.save", res.error);
    return { ok: false, error: t.dynamic(staffErrorKey(res.error?.message ?? "NOT_AUTHORIZED")) };
  }
  await writeAudit(me, existing ? "lesson_plan.update" : "lesson_plan.create", "lesson_plans", res.data.id, {
    kind, shared: p.data.sharedWithParents, drills: p.data.drills.length,
  });
  revalidatePlan(kind, itemId);
  return { ok: true, message: t("staff.messages.planSaved"), data: { id: res.data.id } };
}

async function loadPlan(planId: string, orgId: string) {
  const db = await staffDb();
  const { data } = await db.from("lesson_plans").select("id,org_id,program_session_id,event_id,attachment_path").eq("id", planId).eq("org_id", orgId).maybeSingle();
  return data;
}

export async function deleteLessonPlan(planId: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin", "coach"]);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  if (!uuid.safeParse(planId).success) return { ok: false, error: t("staff.errors.notFound") };
  const plan = await loadPlan(planId, me.orgId);
  if (!plan) return { ok: false, error: t("staff.errors.notFound") };
  const db = await staffDb();
  const { data, error } = await db.from("lesson_plans").delete().eq("id", planId).eq("org_id", me.orgId).select("id");
  if (error || !data?.length) return { ok: false, error: t("staff.errors.forbidden") };
  if (plan.attachment_path) await db.storage.from(LESSON_PLAN_BUCKET).remove([plan.attachment_path]);
  await writeAudit(me, "lesson_plan.delete", "lesson_plans", planId);
  revalidatePlan(plan.program_session_id ? "session" : "event", (plan.program_session_id ?? plan.event_id) as string);
  return { ok: true, message: t("staff.messages.planDeleted") };
}

function sniffType(bytes: Uint8Array): string | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "application/pdf";
  return sniffImageType(bytes);
}

export async function uploadLessonPlanAttachment(formData: FormData): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin", "coach"]);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  const planId = String(formData.get("planId") ?? "");
  if (!uuid.safeParse(planId).success) return { ok: false, error: t("staff.errors.notFound") };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: t("staff.errors.invalid") };
  if (file.size > LESSON_PLAN_MAX_BYTES) return { ok: false, error: t("staff.errors.fileTooLarge") };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(bytes);
  if (!type || !LESSON_PLAN_TYPES[type]) return { ok: false, error: t("staff.errors.fileType") };

  const plan = await loadPlan(planId, me.orgId);
  if (!plan) return { ok: false, error: t("staff.errors.notFound") };
  const db = await staffDb();
  const path = `${me.orgId}/${plan.id}/${crypto.randomUUID()}.${LESSON_PLAN_TYPES[type]}`;
  const up = await db.storage.from(LESSON_PLAN_BUCKET).upload(path, bytes, { contentType: type, upsert: false });
  if (up.error) {
    logError("lessonPlans.upload", up.error);
    return { ok: false, error: t("staff.errors.uploadFailed") };
  }
  const name = file.name.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 200) || `attachment.${LESSON_PLAN_TYPES[type]}`;
  const { data, error } = await db.from("lesson_plans").update({ attachment_path: path, attachment_name: name }).eq("id", plan.id).eq("org_id", me.orgId).select("id");
  if (error || !data?.length) {
    await db.storage.from(LESSON_PLAN_BUCKET).remove([path]);
    return { ok: false, error: t("staff.errors.forbidden") };
  }
  if (plan.attachment_path) await db.storage.from(LESSON_PLAN_BUCKET).remove([plan.attachment_path]);
  await writeAudit(me, "lesson_plan.attachment.upload", "lesson_plans", plan.id, { type });
  revalidatePlan(plan.program_session_id ? "session" : "event", (plan.program_session_id ?? plan.event_id) as string);
  return { ok: true, message: t("staff.messages.attachmentUploaded") };
}

export async function removeLessonPlanAttachment(planId: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin", "coach"]);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  if (!uuid.safeParse(planId).success) return { ok: false, error: t("staff.errors.notFound") };
  const plan = await loadPlan(planId, me.orgId);
  if (!plan) return { ok: false, error: t("staff.errors.notFound") };
  const db = await staffDb();
  const { data, error } = await db.from("lesson_plans").update({ attachment_path: null, attachment_name: null }).eq("id", plan.id).eq("org_id", me.orgId).select("id");
  if (error || !data?.length) return { ok: false, error: t("staff.errors.forbidden") };
  if (plan.attachment_path) await db.storage.from(LESSON_PLAN_BUCKET).remove([plan.attachment_path]);
  await writeAudit(me, "lesson_plan.attachment.remove", "lesson_plans", plan.id);
  revalidatePlan(plan.program_session_id ? "session" : "event", (plan.program_session_id ?? plan.event_id) as string);
  return { ok: true, message: t("staff.messages.attachmentRemoved") };
}
