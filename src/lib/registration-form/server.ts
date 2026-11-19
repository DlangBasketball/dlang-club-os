import "server-only";
import type { Json } from "@/types/database";
import { logError } from "@/lib/log";
import { formsAdminDb } from "@/lib/forms/db";
import type { Answers } from "@/lib/forms/logic";
import { ATHLETE_COLUMNS, resolveConfig, type ChildExtras, type RegistrationConfig } from "./config";

/**
 * Registration form config reads and answer storage (server only). Public
 * pages resolve the programme from its slug server-side, so the config is
 * read with the service role filtered by that programme's org.
 */
export async function getRegistrationConfig(orgId: string, programId: string): Promise<RegistrationConfig> {
  try {
    const { data } = await formsAdminDb().from("registration_form_configs").select("builtin,questions").eq("org_id", orgId).eq("program_id", programId).maybeSingle();
    return resolveConfig(data ? { builtin: data.builtin, questions: data.questions } : null);
  } catch (e) {
    logError("registrationForm.config", e);
    return resolveConfig(null);
  }
}

export type ChildAnswers = { athleteId: string; registrationId: string; extras: ChildExtras; answers: Answers };

/**
 * After a successful registration RPC: store per-child custom answers with
 * the registration (plus the question snapshot) and copy the configured
 * built-ins that live on the athlete record. Never throws (the registration
 * is already committed); failures are logged.
 */
export async function storeRegistrationExtras(orgId: string, programId: string, config: RegistrationConfig, rows: ChildAnswers[]): Promise<void> {
  const db = formsAdminDb();
  for (const r of rows) {
    try {
      const update: Record<string, string> = {};
      for (const [k, col] of Object.entries(ATHLETE_COLUMNS)) {
        const v = r.extras[k as keyof ChildExtras];
        if (col && v) update[col] = v;
      }
      if (Object.keys(update).length) {
        const { error } = await db.from("athletes").update(update).eq("id", r.athleteId).eq("org_id", orgId);
        if (error) logError("registrationForm.athlete", error);
      }
      if (config.questions.length && Object.keys(r.answers).length) {
        const { error } = await db.from("registration_answers").upsert({
          org_id: orgId, registration_id: r.registrationId, athlete_id: r.athleteId, program_id: programId,
          answers: r.answers as unknown as Json, questions: config.questions as unknown as Json,
        }, { onConflict: "registration_id" });
        if (error) logError("registrationForm.answers", error);
      }
    } catch (e) {
      logError("registrationForm.store", e);
    }
  }
}

export type RegistrationAnswerView = { label: string; value: unknown; field: RegistrationConfig["questions"][number] };

/** Answers of one registration with the questions as they were asked (RLS client of the caller). */
export function answerRows(questions: unknown, answers: unknown): RegistrationAnswerView[] {
  const cfg = resolveConfig({ questions });
  const a = (answers ?? {}) as Record<string, unknown>;
  return cfg.questions.filter((q) => q.type !== "info" && a[q.id] !== undefined).map((q) => ({ label: q.label, value: a[q.id], field: q }));
}
