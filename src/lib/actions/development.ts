"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { logError } from "@/lib/log";
import type { Json } from "@/types/database";
import { devAdminDb, devDb, type DevClient } from "@/lib/development/db";
import { athleteFacts } from "@/lib/development/data";
import { autoAssignments } from "@/lib/development/matching";
import {
  VIDEO_TYPES, assignNutritionSchema, assignSchema, completionSchema, developmentErrorKey, evaluationBatchSchema, exerciseSchema,
  isVideoPathFor, nutritionSchema, planSchema, settingsSchema, teamWellnessSchema, templateSchema, videoUploadSchema, wellnessSchema, zodKey,
  type AssignInput, type AssignNutritionInput, type CompletionInput, type EvaluationBatchInput, type ExerciseInput, type NutritionInput,
  type PlanInput, type SettingsInput, type TemplateInput, type WellnessInput,
} from "@/lib/development/validation";

/**
 * Athlete development mutations. Every action: role check, org from the
 * session (never from the client), zod validation, RLS-scoped writes with the
 * user's own session (the service role is used only for storage signing and
 * audit rows), an audit_logs row and path revalidation.
 */

export type DevResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
type Me = SessionUser & { orgId: string };
type Role = "admin" | "finance" | "coach" | "parent";
const VIDEO_BUCKET = "exercise-videos";

async function fail(key: string): Promise<{ ok: false; error: string }> {
  const t = await getTranslations();
  return { ok: false, error: t.dynamic(key, undefined, t("development.errors.generic")) };
}
const dbFail = (message: string | null | undefined) => fail(developmentErrorKey(message));
const isUuid = (v: unknown): v is string => typeof v === "string" && z.string().uuid().safeParse(v).success;
const STAFF: Role[] = ["admin", "coach"];

async function requireRole(roles: Role[]): Promise<Me | null> {
  const me = await getSessionUser();
  if (!me?.orgId || !roles.some((r) => me.roles.includes(r))) return null;
  return me as Me;
}

function revalidateDev() {
  for (const p of ["/admin/development", "/coach/development", "/parent/development"]) revalidatePath(p, "layout");
}

async function audit(me: Me, action: string, table: string, id: string | null, data: Record<string, unknown>) {
  try {
    const { error } = await devAdminDb().from("audit_logs").insert({
      org_id: me.orgId, actor_id: me.id, action, target_table: table, target_id: id, new_data: data as Json,
    });
    if (error) logError("development.audit", error, { action });
  } catch (e) {
    logError("development.audit", e, { action });
  }
}

async function myCoachId(db: DevClient, me: Me): Promise<string | null> {
  const { data } = await db.from("coaches").select("id").eq("profile_id", me.id).eq("org_id", me.orgId).maybeSingle();
  return data?.id ?? null;
}

// ===========================================================================
// Assessment templates
// ===========================================================================
export async function saveAssessmentTemplate(id: string | null, input: TemplateInput): Promise<DevResult<{ id: string }>> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  if (id !== null && !isUuid(id)) return fail("development.errors.invalidRequest");
  const p = templateSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const db = await devDb();
  const row = {
    name: v.name, description: v.description || null, sport: v.sport || null, age_group: v.ageGroup || null,
    age_min: v.ageMin, age_max: v.ageMax, is_active: v.isActive,
  };
  let templateId = id;
  if (id) {
    const { data, error } = await db.from("assessment_templates").update(row).eq("id", id).eq("org_id", me.orgId).select("id");
    if (error) return dbFail(error.message);
    if (!data?.length) return fail("development.errors.notFound");
  } else {
    const { data, error } = await db.from("assessment_templates").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id").single();
    if (error) return dbFail(error.message);
    templateId = data.id;
  }

  const { data: existing, error: exErr } = await db.from("assessment_items").select("id").eq("template_id", templateId!).eq("org_id", me.orgId);
  if (exErr) return dbFail(exErr.message);
  const keep = new Set<string>();
  for (const [i, it] of v.items.entries()) {
    const r = {
      kind: it.kind, label: it.label, description: it.description || null, category: it.category || null,
      scale_min: it.scaleMin, scale_max: it.scaleMax, unit: it.kind === "measurement" ? it.unit || null : null,
      higher_is_better: it.higherIsBetter, weight: it.weight, sort_order: i + 1,
    };
    if (it.id && (existing ?? []).some((e) => e.id === it.id)) {
      keep.add(it.id);
      const { error } = await db.from("assessment_items").update(r).eq("id", it.id).eq("org_id", me.orgId);
      if (error) return dbFail(error.message);
    } else {
      const { error } = await db.from("assessment_items").insert({ ...r, org_id: me.orgId, template_id: templateId });
      if (error) return dbFail(error.message);
    }
  }
  // Removed items: only when no evaluation used them (history is never lost).
  const removed = (existing ?? []).map((e) => e.id).filter((x) => !keep.has(x));
  if (removed.length) {
    const { count } = await devAdminDb().from("evaluation_scores").select("id", { count: "exact", head: true }).eq("org_id", me.orgId).in("item_id", removed);
    if ((count ?? 0) > 0) return fail("development.errors.itemInUse");
    const { error } = await db.from("assessment_items").delete().in("id", removed).eq("org_id", me.orgId);
    if (error) return dbFail(error.message);
  }
  await audit(me, id ? "development.template.update" : "development.template.create", "assessment_templates", templateId, { name: v.name, items: v.items.length });
  revalidateDev();
  return { ok: true, data: { id: templateId! } };
}

export async function deleteAssessmentTemplate(id: string): Promise<DevResult> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  if (!isUuid(id)) return fail("development.errors.invalidRequest");
  const db = await devDb();
  const { data, error } = await db.from("assessment_templates").delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("development.errors.notFound");
  await audit(me, "development.template.delete", "assessment_templates", id, {});
  revalidateDev();
  return { ok: true };
}

// ===========================================================================
// Evaluations (single athlete or a team batch)
// ===========================================================================
export async function saveEvaluations(input: EvaluationBatchInput): Promise<DevResult<{ ids: string[] }>> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  const p = evaluationBatchSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const db = await devDb();
  const { data: items, error: iErr } = await db.from("assessment_items").select("id,kind").eq("template_id", v.templateId).eq("org_id", me.orgId);
  if (iErr) return dbFail(iErr.message);
  if (!items?.length) return fail("development.errors.notFound");
  const kinds = new Map(items.map((i) => [i.id, i.kind]));
  const coachId = await myCoachId(db, me);
  const ids: string[] = [];
  for (const entry of v.entries) {
    const scores = entry.scores.filter((s) => kinds.has(s.itemId)).filter((s) => {
      const k = kinds.get(s.itemId);
      return k === "skill" ? s.score !== null : k === "measurement" ? s.value !== null : s.textValue.length > 0;
    });
    if (scores.length === 0 && !entry.comments) continue; // nothing recorded for this athlete
    const { data: ev, error } = await db.from("evaluations").insert({
      org_id: me.orgId, athlete_id: entry.athleteId, template_id: v.templateId, team_id: v.teamId, coach_id: coachId,
      evaluated_on: v.evaluatedOn, comments: entry.comments || null, shared_with_family: v.share, created_by: me.id,
    }).select("id").single();
    if (error) return dbFail(error.message);
    if (scores.length) {
      const { error: sErr } = await db.from("evaluation_scores").insert(scores.map((s) => ({
        org_id: me.orgId, evaluation_id: ev.id, item_id: s.itemId, score: s.score, value: s.value, text_value: s.textValue || null,
      })));
      if (sErr) {
        await db.from("evaluations").delete().eq("id", ev.id).eq("org_id", me.orgId);
        return dbFail(sErr.message);
      }
    }
    ids.push(ev.id);
    await audit(me, "development.evaluation.create", "evaluations", ev.id, { athlete_id: entry.athleteId, template_id: v.templateId, shared: v.share });
  }
  if (ids.length === 0) return fail("development.errors.nothingRecorded");
  revalidateDev();
  return { ok: true, data: { ids } };
}

export async function setEvaluationShared(id: string, shared: boolean): Promise<DevResult> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  if (!isUuid(id) || typeof shared !== "boolean") return fail("development.errors.invalidRequest");
  const db = await devDb();
  const { data, error } = await db.from("evaluations").update({ shared_with_family: shared }).eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("development.errors.notPermitted");
  await audit(me, shared ? "development.evaluation.share" : "development.evaluation.unshare", "evaluations", id, { shared });
  revalidateDev();
  return { ok: true };
}

export async function deleteEvaluation(id: string): Promise<DevResult> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  if (!isUuid(id)) return fail("development.errors.invalidRequest");
  const db = await devDb();
  const { data, error } = await db.from("evaluations").delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("development.errors.notPermitted");
  await audit(me, "development.evaluation.delete", "evaluations", id, {});
  revalidateDev();
  return { ok: true };
}

// ===========================================================================
// Settings (ranking weights, levels / emoji) and per-team wellness
// ===========================================================================
export async function saveDevelopmentSettings(input: SettingsInput): Promise<DevResult> {
  const me = await requireRole(["admin"]);
  if (!me) return fail("development.errors.notPermitted");
  const p = settingsSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const levels = v.levels.slice().sort((a, b) => a.min - b.min).map((l, i) => ({ min: i === 0 ? 0 : l.min, emoji: l.emoji, label: l.label || null }));
  const db = await devDb();
  const { error } = await db.from("development_settings").upsert({
    org_id: me.orgId, attendance_weight: v.attendanceWeight, evaluation_weight: v.evaluationWeight, window_days: v.windowDays,
    levels: levels as unknown as Json, family_rank_visible: v.familyRankVisible, updated_by: me.id,
  }, { onConflict: "org_id" });
  if (error) return dbFail(error.message);
  await audit(me, "development.settings.update", "development_settings", null, { ...v, levels });
  revalidateDev();
  return { ok: true };
}

export async function setTeamWellness(teamId: string, enabled: boolean): Promise<DevResult> {
  const me = await requireRole(["admin"]);
  if (!me) return fail("development.errors.notPermitted");
  const p = teamWellnessSchema.safeParse({ teamId, enabled });
  if (!p.success) return fail(zodKey(p.error));
  const db = await devDb();
  const { data, error } = await db.from("teams").update({ wellness_enabled: p.data.enabled }).eq("id", p.data.teamId).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("development.errors.notFound");
  await audit(me, "development.wellness.team", "teams", p.data.teamId, { wellness_enabled: p.data.enabled });
  revalidateDev();
  return { ok: true };
}

// ===========================================================================
// Exercise library (+ private videos)
// ===========================================================================
export async function saveExercise(id: string | null, input: ExerciseInput): Promise<DevResult<{ id: string }>> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  if (id !== null && !isUuid(id)) return fail("development.errors.invalidRequest");
  const p = exerciseSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const db = await devDb();
  const row = {
    name: v.name, description: v.description || null, sport: v.sport || null, category: v.category, video_url: v.videoUrl || null,
    equipment: v.equipment, difficulty: v.difficulty, is_active: v.isActive,
  };
  let exId = id;
  if (id) {
    const { data, error } = await db.from("exercises").update(row).eq("id", id).eq("org_id", me.orgId).select("id");
    if (error) return dbFail(error.message);
    if (!data?.length) return fail("development.errors.notPermitted");
  } else {
    const { data, error } = await db.from("exercises").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id").single();
    if (error) return dbFail(error.message);
    exId = data.id;
  }
  await audit(me, id ? "development.exercise.update" : "development.exercise.create", "exercises", exId, { name: v.name });
  revalidateDev();
  return { ok: true, data: { id: exId! } };
}

export async function deleteExercise(id: string): Promise<DevResult> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  if (!isUuid(id)) return fail("development.errors.invalidRequest");
  const db = await devDb();
  const { data, error } = await db.from("exercises").delete().eq("id", id).eq("org_id", me.orgId).select("id,video_path");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("development.errors.notPermitted");
  if (data[0].video_path) await devAdminDb().storage.from(VIDEO_BUCKET).remove([data[0].video_path]);
  await audit(me, "development.exercise.delete", "exercises", id, {});
  revalidateDev();
  return { ok: true };
}

/** Exercise the caller may edit (RLS update check by a no-op update). */
async function editableExercise(db: DevClient, me: Me, exerciseId: string) {
  const { data } = await db.from("exercises").update({ updated_at: new Date().toISOString() }).eq("id", exerciseId).eq("org_id", me.orgId).select("id,video_path");
  return data?.[0] ?? null;
}

/** Signed one-time upload URL for an exercise video (browser uploads straight to the private bucket). */
export async function createExerciseVideoUpload(input: { exerciseId: string; contentType: string; size: number }): Promise<DevResult<{ path: string; token: string }>> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  const p = videoUploadSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const db = await devDb();
  if (!(await editableExercise(db, me, p.data.exerciseId))) return fail("development.errors.notPermitted");
  const path = `${me.orgId}/${p.data.exerciseId}/${randomUUID()}.${VIDEO_TYPES[p.data.contentType]}`;
  const { data, error } = await devAdminDb().storage.from(VIDEO_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return fail("development.errors.uploadFailed");
  return { ok: true, data: { path, token: data.token } };
}

export async function attachExerciseVideo(exerciseId: string, path: string | null): Promise<DevResult> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  if (!isUuid(exerciseId) || (path !== null && (typeof path !== "string" || !isVideoPathFor(path, me.orgId, exerciseId)))) return fail("development.errors.invalidRequest");
  const db = await devDb();
  const ex = await editableExercise(db, me, exerciseId);
  if (!ex) return fail("development.errors.notPermitted");
  const { error } = await db.from("exercises").update({ video_path: path }).eq("id", exerciseId).eq("org_id", me.orgId);
  if (error) return dbFail(error.message);
  if (ex.video_path && ex.video_path !== path) await devAdminDb().storage.from(VIDEO_BUCKET).remove([ex.video_path]);
  await audit(me, path ? "development.exercise.video" : "development.exercise.videoRemove", "exercises", exerciseId, {});
  revalidateDev();
  return { ok: true };
}

/** Short-lived signed URL; anyone in the club who may read the exercise (RLS) may watch it. */
export async function getExerciseVideoUrl(exerciseId: string): Promise<DevResult<{ url: string }>> {
  const me = await requireRole(["admin", "coach", "parent"]);
  if (!me) return fail("development.errors.notPermitted");
  if (!isUuid(exerciseId)) return fail("development.errors.invalidRequest");
  const db = await devDb();
  const { data } = await db.from("exercises").select("id,video_path").eq("id", exerciseId).eq("org_id", me.orgId).maybeSingle();
  if (!data?.video_path || !isVideoPathFor(data.video_path, me.orgId, exerciseId)) return fail("development.errors.notFound");
  const { data: signed, error } = await devAdminDb().storage.from(VIDEO_BUCKET).createSignedUrl(data.video_path, 3600);
  if (error || !signed) return fail("development.errors.generic");
  return { ok: true, data: { url: signed.signedUrl } };
}

// ===========================================================================
// Training plans
// ===========================================================================
async function runAutoAssignFor(db: DevClient, me: Me, planIds: string[]): Promise<number> {
  const { data: plans } = await db.from("training_plans").select("id,sport,age_min,age_max,level,auto_assign,is_active,is_template,weeks").in("id", planIds).eq("org_id", me.orgId);
  if (!plans?.length) return 0;
  const { data: ath } = await db.from("athletes").select("id").eq("org_id", me.orgId).neq("status", "archived");
  const athleteIds = (ath ?? []).map((a) => a.id);
  const facts = await athleteFacts(db, athleteIds);
  const { data: existing } = await db.from("training_plan_assignments").select("plan_id,athlete_id").in("plan_id", planIds).eq("status", "active");
  const pairs = autoAssignments(
    plans.map((p) => ({ id: p.id, sport: p.sport, ageMin: p.age_min, ageMax: p.age_max, level: (p.level as never) ?? null, autoAssign: p.auto_assign, isActive: p.is_active, isTemplate: p.is_template })),
    facts,
    (existing ?? []).map((e) => ({ planId: e.plan_id, athleteId: e.athlete_id })),
    new Date().toISOString().slice(0, 10),
  );
  let n = 0;
  for (const pair of pairs) {
    // RLS decides per athlete (a coach assigns only athletes they coach).
    const { error } = await db.from("training_plan_assignments").insert({
      org_id: me.orgId, plan_id: pair.planId, athlete_id: pair.athleteId, source: "auto", at_home: true, assigned_by: me.id,
    });
    if (!error) n += 1;
  }
  if (n) await audit(me, "development.plan.autoAssign", "training_plans", planIds.length === 1 ? planIds[0] : null, { assigned: n });
  return n;
}

export async function saveTrainingPlan(id: string | null, input: PlanInput): Promise<DevResult<{ id: string; autoAssigned: number }>> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  if (id !== null && !isUuid(id)) return fail("development.errors.invalidRequest");
  const p = planSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const db = await devDb();
  const row = {
    name: v.name, description: v.description || null, sport: v.sport || null, age_min: v.ageMin, age_max: v.ageMax, level: v.level,
    weeks: v.weeks, is_template: v.isTemplate, auto_assign: v.autoAssign, is_active: v.isActive,
  };
  let planId = id;
  if (id) {
    const { data, error } = await db.from("training_plans").update(row).eq("id", id).eq("org_id", me.orgId).select("id");
    if (error) return dbFail(error.message);
    if (!data?.length) return fail("development.errors.notPermitted");
  } else {
    const { data, error } = await db.from("training_plans").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id").single();
    if (error) return dbFail(error.message);
    planId = data.id;
  }
  const { data: existing } = await db.from("training_plan_items").select("id").eq("plan_id", planId!).eq("org_id", me.orgId);
  const keep = new Set<string>();
  for (const [i, it] of v.items.entries()) {
    const r = {
      week: it.week, day: it.day, exercise_id: it.exerciseId, title: it.title || null, sets: it.sets, reps: it.reps,
      duration_sec: it.durationSec, rest_sec: it.restSec, notes: it.notes || null, sort_order: i + 1,
    };
    if (it.id && (existing ?? []).some((e) => e.id === it.id)) {
      keep.add(it.id);
      const { error } = await db.from("training_plan_items").update(r).eq("id", it.id).eq("org_id", me.orgId);
      if (error) return dbFail(error.message);
    } else {
      const { error } = await db.from("training_plan_items").insert({ ...r, org_id: me.orgId, plan_id: planId });
      if (error) return dbFail(error.message);
    }
  }
  const removed = (existing ?? []).map((e) => e.id).filter((x) => !keep.has(x));
  if (removed.length) {
    const { error } = await db.from("training_plan_items").delete().in("id", removed).eq("org_id", me.orgId);
    if (error) return dbFail(error.message);
  }
  await audit(me, id ? "development.plan.update" : "development.plan.create", "training_plans", planId, { name: v.name, items: v.items.length });
  const autoAssigned = v.autoAssign && v.isActive ? await runAutoAssignFor(db, me, [planId!]) : 0;
  revalidateDev();
  return { ok: true, data: { id: planId!, autoAssigned } };
}

export async function deleteTrainingPlan(id: string): Promise<DevResult> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  if (!isUuid(id)) return fail("development.errors.invalidRequest");
  const db = await devDb();
  const { data, error } = await db.from("training_plans").delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("development.errors.notPermitted");
  await audit(me, "development.plan.delete", "training_plans", id, {});
  revalidateDev();
  return { ok: true };
}

export async function runPlanAutoAssign(planId: string): Promise<DevResult<{ assigned: number }>> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  if (!isUuid(planId)) return fail("development.errors.invalidRequest");
  const db = await devDb();
  const assigned = await runAutoAssignFor(db, me, [planId]);
  revalidateDev();
  return { ok: true, data: { assigned } };
}

export async function assignTrainingPlan(input: AssignInput): Promise<DevResult<{ assigned: number }>> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  const p = assignSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const db = await devDb();
  const { data: plan } = await db.from("training_plans").select("id").eq("id", v.planId).eq("org_id", me.orgId).maybeSingle();
  if (!plan) return fail("development.errors.notFound");
  const { data: existing } = await db.from("training_plan_assignments").select("athlete_id").eq("plan_id", v.planId).eq("status", "active");
  const have = new Set((existing ?? []).map((e) => e.athlete_id));
  let assigned = 0;
  for (const athleteId of Array.from(new Set(v.athleteIds))) {
    if (have.has(athleteId)) continue;
    const { data, error } = await db.from("training_plan_assignments").insert({
      org_id: me.orgId, plan_id: v.planId, athlete_id: athleteId, starts_on: v.startsOn, at_home: v.atHome, notes: v.notes || null,
      source: "manual", assigned_by: me.id,
    }).select("id").single();
    if (error) return dbFail(error.message);
    assigned += 1;
    await audit(me, "development.plan.assign", "training_plan_assignments", data.id, { plan_id: v.planId, athlete_id: athleteId });
  }
  revalidateDev();
  return { ok: true, data: { assigned } };
}

export async function setAssignmentStatus(id: string, status: "active" | "completed" | "cancelled"): Promise<DevResult> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  if (!isUuid(id) || !["active", "completed", "cancelled"].includes(status)) return fail("development.errors.invalidRequest");
  const db = await devDb();
  const { data, error } = await db.from("training_plan_assignments").update({ status }).eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("development.errors.notPermitted");
  await audit(me, "development.plan.assignmentStatus", "training_plan_assignments", id, { status });
  revalidateDev();
  return { ok: true };
}

/** Check off / un-check a plan item, with optional rating + comment (guardian, coach of the athlete or admin). */
export async function setPlanItemDone(input: CompletionInput): Promise<DevResult> {
  const me = await requireRole(["admin", "coach", "parent"]);
  if (!me) return fail("development.errors.notPermitted");
  const p = completionSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const db = await devDb();
  const { data: a } = await db.from("training_plan_assignments").select("id,athlete_id,status").eq("id", v.assignmentId).eq("org_id", me.orgId).maybeSingle();
  if (!a) return fail("development.errors.notFound");
  if (!v.done) {
    const { error } = await db.from("training_plan_completions").delete().eq("assignment_id", v.assignmentId).eq("item_id", v.itemId).eq("org_id", me.orgId);
    if (error) return dbFail(error.message);
  } else {
    const { error } = await db.from("training_plan_completions").upsert({
      org_id: me.orgId, assignment_id: v.assignmentId, item_id: v.itemId, athlete_id: a.athlete_id,
      completed_on: new Date().toISOString().slice(0, 10), rating: v.rating, comment: v.comment || null, completed_by: me.id,
    }, { onConflict: "assignment_id,item_id" });
    if (error) return dbFail(error.message);
  }
  await audit(me, v.done ? "development.plan.itemDone" : "development.plan.itemUndone", "training_plan_completions", null, { assignment_id: v.assignmentId, item_id: v.itemId, rating: v.rating });
  revalidateDev();
  return { ok: true };
}

// ===========================================================================
// Nutrition
// ===========================================================================
export async function saveNutritionPlan(id: string | null, input: NutritionInput): Promise<DevResult<{ id: string }>> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  if (id !== null && !isUuid(id)) return fail("development.errors.invalidRequest");
  const p = nutritionSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const db = await devDb();
  const row = {
    name: v.name, description: v.description || null, age_min: v.ageMin, age_max: v.ageMax, athlete_id: v.athleteId,
    hydration_ml: v.hydrationMl, guidelines: v.guidelines || null, is_active: v.isActive,
  };
  let planId = id;
  if (id) {
    const { data, error } = await db.from("nutrition_plans").update(row).eq("id", id).eq("org_id", me.orgId).select("id");
    if (error) return dbFail(error.message);
    if (!data?.length) return fail("development.errors.notPermitted");
    const { error: dErr } = await db.from("nutrition_plan_meals").delete().eq("plan_id", id).eq("org_id", me.orgId);
    if (dErr) return dbFail(dErr.message);
  } else {
    const { data, error } = await db.from("nutrition_plans").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id").single();
    if (error) return dbFail(error.message);
    planId = data.id;
  }
  if (v.meals.length) {
    const { error } = await db.from("nutrition_plan_meals").insert(v.meals.map((m, i) => ({
      org_id: me.orgId, plan_id: planId, day: m.day, meal: m.meal, description: m.description, sort_order: i + 1,
    })));
    if (error) return dbFail(error.message);
  }
  await audit(me, id ? "development.nutrition.update" : "development.nutrition.create", "nutrition_plans", planId, { name: v.name, meals: v.meals.length, client_specific: v.athleteId !== null });
  revalidateDev();
  return { ok: true, data: { id: planId! } };
}

export async function deleteNutritionPlan(id: string): Promise<DevResult> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  if (!isUuid(id)) return fail("development.errors.invalidRequest");
  const db = await devDb();
  const { data, error } = await db.from("nutrition_plans").delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("development.errors.notPermitted");
  await audit(me, "development.nutrition.delete", "nutrition_plans", id, {});
  revalidateDev();
  return { ok: true };
}

export async function assignNutritionPlan(input: AssignNutritionInput): Promise<DevResult<{ assigned: number }>> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  const p = assignNutritionSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const db = await devDb();
  const { data: plan } = await db.from("nutrition_plans").select("id").eq("id", v.planId).eq("org_id", me.orgId).maybeSingle();
  if (!plan) return fail("development.errors.notFound");
  let assigned = 0;
  for (const athleteId of Array.from(new Set(v.athleteIds))) {
    const { data, error } = await db.from("nutrition_plan_assignments").upsert({
      org_id: me.orgId, plan_id: v.planId, athlete_id: athleteId, starts_on: v.startsOn, assigned_by: me.id,
    }, { onConflict: "plan_id,athlete_id" }).select("id").single();
    if (error) return dbFail(error.message);
    assigned += 1;
    await audit(me, "development.nutrition.assign", "nutrition_plan_assignments", data.id, { plan_id: v.planId, athlete_id: athleteId });
  }
  revalidateDev();
  return { ok: true, data: { assigned } };
}

export async function unassignNutritionPlan(assignmentId: string): Promise<DevResult> {
  const me = await requireRole(STAFF);
  if (!me) return fail("development.errors.notPermitted");
  if (!isUuid(assignmentId)) return fail("development.errors.invalidRequest");
  const db = await devDb();
  const { data, error } = await db.from("nutrition_plan_assignments").delete().eq("id", assignmentId).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("development.errors.notPermitted");
  await audit(me, "development.nutrition.unassign", "nutrition_plan_assignments", assignmentId, {});
  revalidateDev();
  return { ok: true };
}

// ===========================================================================
// Wellness check-in (guardian, the athlete's coach or admin; one per day)
// ===========================================================================
export async function submitWellness(input: WellnessInput): Promise<DevResult> {
  const me = await requireRole(["admin", "coach", "parent"]);
  if (!me) return fail("development.errors.notPermitted");
  const p = wellnessSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const db = await devDb();
  const { data, error } = await db.from("wellness_checkins").upsert({
    org_id: me.orgId, athlete_id: v.athleteId, checkin_date: v.date, sleep: v.sleep, energy: v.energy, soreness: v.soreness, mood: v.mood,
    note: v.note || null, submitted_by: me.id,
  }, { onConflict: "athlete_id,checkin_date" }).select("id").single();
  if (error) return dbFail(error.message);
  // The action-level audit row carries no answers (the table trigger keeps the row history).
  await audit(me, "development.wellness.submit", "wellness_checkins", data.id, { athlete_id: v.athleteId, date: v.date });
  revalidateDev();
  return { ok: true };
}
