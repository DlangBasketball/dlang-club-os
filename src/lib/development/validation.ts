import { z } from "zod";
import { LEVELS } from "./scoring";

/**
 * Validation for athlete development (assessments, evaluations, rankings
 * settings, exercises, plans, nutrition, wellness). Pure: shared by server
 * actions and unit tests. Messages are i18n keys under `development.errors.*`.
 */

const E = (k: string) => `development.errors.${k}`;

/** Form input: numeric fields may arrive as strings (coerced by zod). */
type Loose<T> = T extends number ? number | string : T extends (infer U)[] ? Loose<U>[] : T extends object ? { [K in keyof T]: Loose<T[K]> } : T;
const uuid = z.string().uuid(E("invalidRequest"));
const optUuid = z.union([z.literal(""), z.null(), z.string().uuid(E("invalidRequest"))]).optional().transform((v) => (v ? v : null));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, E("invalidDate"));
const text = (max: number) => z.string().trim().max(max, E("tooLong")).optional().default("");
const optInt = (min: number, max: number, key: string) =>
  z.union([z.literal(""), z.null(), z.coerce.number().int(E(key)).min(min, E(key)).max(max, E(key))]).optional()
    .transform((v) => (v === "" || v === null || v === undefined ? null : v));
const optNum = (min: number, max: number, key: string) =>
  z.union([z.literal(""), z.null(), z.coerce.number({ invalid_type_error: E(key) }).min(min, E(key)).max(max, E(key))]).optional()
    .transform((v) => (v === "" || v === null || v === undefined ? null : v));
const ageRange = <T extends { ageMin: number | null; ageMax: number | null }>(v: T) => v.ageMin === null || v.ageMax === null || v.ageMin <= v.ageMax;

export const EXERCISE_CATEGORIES = ["strength_conditioning", "skills", "mobility", "conditioning", "recovery", "other"] as const;
export const MEALS = ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "pre_training", "post_training"] as const;
export { LEVELS };

// ---- Assessment templates ----------------------------------------------------
export const itemSchema = z
  .object({
    id: optUuid,
    kind: z.enum(["skill", "measurement", "text"]),
    label: z.string().trim().min(1, E("labelRequired")).max(120, E("tooLong")),
    description: text(500),
    category: text(60),
    scaleMin: z.coerce.number().int(E("scale")).min(0, E("scale")).max(100, E("scale")).optional().default(1),
    scaleMax: z.coerce.number().int(E("scale")).min(1, E("scale")).max(100, E("scale")).optional().default(5),
    unit: text(20),
    higherIsBetter: z.boolean().optional().default(true),
    weight: z.coerce.number({ invalid_type_error: E("weight") }).gt(0, E("weight")).max(100, E("weight")).optional().default(1),
  })
  .refine((v) => v.scaleMax > v.scaleMin, { message: E("scale"), path: ["scaleMax"] });
export type ItemInput = Loose<z.input<typeof itemSchema>>;

export const templateSchema = z
  .object({
    name: z.string().trim().min(1, E("nameRequired")).max(120, E("tooLong")),
    description: text(2000),
    sport: text(60),
    ageGroup: text(40),
    ageMin: optInt(0, 99, "age"),
    ageMax: optInt(0, 99, "age"),
    isActive: z.boolean().optional().default(true),
    items: z.array(itemSchema).min(1, E("itemsRequired")).max(60, E("tooMany")),
  })
  .refine(ageRange, { message: E("ageRange"), path: ["ageMax"] });
export type TemplateInput = Loose<z.input<typeof templateSchema>>;

// ---- Evaluations ---------------------------------------------------------------
export const scoreSchema = z.object({
  itemId: uuid,
  score: optNum(0, 100, "score"),
  value: optNum(-1_000_000, 1_000_000, "value"),
  textValue: text(2000),
});
export const evaluationEntrySchema = z.object({
  athleteId: uuid,
  comments: text(4000),
  scores: z.array(scoreSchema).max(60, E("tooMany")),
});
export const evaluationBatchSchema = z.object({
  templateId: uuid,
  teamId: optUuid,
  evaluatedOn: isoDate,
  share: z.boolean().optional().default(false),
  entries: z.array(evaluationEntrySchema).min(1, E("athleteRequired")).max(60, E("tooMany")),
});
export type EvaluationBatchInput = Loose<z.input<typeof evaluationBatchSchema>>;

// ---- Settings ------------------------------------------------------------------
export const levelTierSchema = z.object({
  min: z.coerce.number().int(E("threshold")).min(0, E("threshold")).max(100, E("threshold")),
  emoji: z.string().trim().min(1, E("emojiRequired")).max(16, E("tooLong")),
  label: text(40),
});
export const settingsSchema = z
  .object({
    attendanceWeight: z.coerce.number({ invalid_type_error: E("weight") }).min(0, E("weight")).max(100, E("weight")),
    evaluationWeight: z.coerce.number({ invalid_type_error: E("weight") }).min(0, E("weight")).max(100, E("weight")),
    windowDays: z.coerce.number().int(E("window")).min(7, E("window")).max(730, E("window")),
    familyRankVisible: z.boolean().optional().default(true),
    levels: z.array(levelTierSchema).min(1, E("levelsRequired")).max(10, E("tooMany")),
  })
  .refine((v) => v.attendanceWeight + v.evaluationWeight > 0, { message: E("weightsZero"), path: ["attendanceWeight"] })
  .refine((v) => new Set(v.levels.map((l) => l.min)).size === v.levels.length, { message: E("thresholdDuplicate"), path: ["levels"] });
export type SettingsInput = Loose<z.input<typeof settingsSchema>>;

// ---- Exercises -----------------------------------------------------------------
export const exerciseSchema = z.object({
  name: z.string().trim().min(1, E("nameRequired")).max(120, E("tooLong")),
  description: text(4000),
  sport: text(60),
  category: z.enum(EXERCISE_CATEGORIES),
  videoUrl: z.union([z.literal(""), z.string().trim().max(500, E("tooLong")).url(E("videoUrl")).refine((u) => u.startsWith("https://"), E("videoUrl"))]).optional().default(""),
  equipment: z.string().trim().max(300, E("tooLong")).optional().default("")
    .transform((s) => Array.from(new Set(s.split(",").map((x) => x.trim()).filter(Boolean))).slice(0, 20)),
  difficulty: z.enum(LEVELS),
  isActive: z.boolean().optional().default(true),
});
export type ExerciseInput = Loose<z.input<typeof exerciseSchema>>;

export const VIDEO_TYPES = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" } as const;
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const videoUploadSchema = z.object({
  exerciseId: uuid,
  contentType: z.enum(Object.keys(VIDEO_TYPES) as [keyof typeof VIDEO_TYPES, ...(keyof typeof VIDEO_TYPES)[]], { errorMap: () => ({ message: E("videoType") }) }),
  size: z.coerce.number().int().min(1, E("videoSize")).max(VIDEO_MAX_BYTES, E("videoSize")),
});

/** Storage path of an exercise video: <org>/<exercise>/<random>.<ext>. */
export function isVideoPathFor(path: string, orgId: string, exerciseId: string): boolean {
  return new RegExp(`^${orgId}/${exerciseId}/[A-Za-z0-9-]{8,64}\\.(mp4|webm|mov)$`).test(path);
}

// ---- Training plans --------------------------------------------------------------
export const planItemSchema = z
  .object({
    id: optUuid,
    week: z.coerce.number().int(E("week")).min(1, E("week")).max(52, E("week")),
    day: z.coerce.number().int(E("day")).min(1, E("day")).max(7, E("day")),
    exerciseId: optUuid,
    title: text(120),
    sets: optInt(0, 100, "sets"),
    reps: optInt(0, 1000, "reps"),
    durationSec: optInt(0, 86400, "duration"),
    restSec: optInt(0, 3600, "duration"),
    notes: text(1000),
  })
  .refine((v) => v.exerciseId !== null || v.title.length > 0, { message: E("itemWhat"), path: ["title"] });

export const planSchema = z
  .object({
    name: z.string().trim().min(1, E("nameRequired")).max(120, E("tooLong")),
    description: text(4000),
    sport: text(60),
    ageMin: optInt(0, 99, "age"),
    ageMax: optInt(0, 99, "age"),
    level: z.union([z.literal(""), z.null(), z.enum(LEVELS)]).optional().transform((v) => (v ? v : null)),
    weeks: z.coerce.number().int(E("weeks")).min(1, E("weeks")).max(52, E("weeks")),
    isTemplate: z.boolean().optional().default(true),
    autoAssign: z.boolean().optional().default(false),
    isActive: z.boolean().optional().default(true),
    items: z.array(planItemSchema).max(400, E("tooMany")),
  })
  .refine(ageRange, { message: E("ageRange"), path: ["ageMax"] })
  .refine((v) => v.items.every((i) => i.week <= v.weeks), { message: E("weekBeyondPlan"), path: ["items"] })
  .transform((v) => (v.isTemplate ? v : { ...v, autoAssign: false }));
export type PlanInput = Loose<z.input<typeof planSchema>>;

export const assignSchema = z.object({
  planId: uuid,
  athleteIds: z.array(uuid).min(1, E("athleteRequired")).max(200, E("tooMany")),
  startsOn: isoDate,
  atHome: z.boolean().optional().default(true),
  notes: text(1000),
});
export type AssignInput = Loose<z.input<typeof assignSchema>>;

export const completionSchema = z.object({
  assignmentId: uuid,
  itemId: uuid,
  done: z.boolean(),
  rating: optInt(1, 5, "rating"),
  comment: text(1000),
});
export type CompletionInput = Loose<z.input<typeof completionSchema>>;

// ---- Nutrition -------------------------------------------------------------------
export const mealSchema = z.object({
  day: z.coerce.number().int(E("day")).min(0, E("day")).max(7, E("day")),
  meal: z.enum(MEALS),
  description: z.string().trim().min(1, E("mealRequired")).max(1000, E("tooLong")),
});
export const nutritionSchema = z
  .object({
    name: z.string().trim().min(1, E("nameRequired")).max(120, E("tooLong")),
    description: text(2000),
    ageMin: optInt(0, 99, "age"),
    ageMax: optInt(0, 99, "age"),
    athleteId: optUuid,
    hydrationMl: optInt(0, 10000, "hydration"),
    guidelines: text(4000),
    isActive: z.boolean().optional().default(true),
    meals: z.array(mealSchema).max(100, E("tooMany")),
  })
  .refine(ageRange, { message: E("ageRange"), path: ["ageMax"] });
export type NutritionInput = Loose<z.input<typeof nutritionSchema>>;

export const assignNutritionSchema = z.object({
  planId: uuid,
  athleteIds: z.array(uuid).min(1, E("athleteRequired")).max(200, E("tooMany")),
  startsOn: isoDate,
});
export type AssignNutritionInput = Loose<z.input<typeof assignNutritionSchema>>;

// ---- Wellness ----------------------------------------------------------------------
const one5 = z.coerce.number().int(E("wellnessValue")).min(1, E("wellnessValue")).max(5, E("wellnessValue"));
export const wellnessSchema = z.object({
  athleteId: uuid,
  date: isoDate,
  sleep: one5,
  energy: one5,
  soreness: one5,
  mood: one5,
  note: text(500),
});
export type WellnessInput = Loose<z.input<typeof wellnessSchema>>;

export const teamWellnessSchema = z.object({ teamId: uuid, enabled: z.boolean() });

// ---- Errors -------------------------------------------------------------------------
const DB_ERRORS: [RegExp, string][] = [
  [/CROSS_ORG_REFERENCE/, "notFound"],
  [/SCORE_OUT_OF_RANGE/, "score"],
  [/ITEM_TEMPLATE_MISMATCH/, "itemMismatch"],
  [/ASSIGNMENT_MISMATCH/, "invalidRequest"],
  [/ASSIGNMENT_CLOSED/, "assignmentClosed"],
  [/WELLNESS_DISABLED/, "wellnessDisabled"],
  [/WELLNESS_FUTURE_DATE/, "invalidDate"],
  [/tpa_one_active_per_plan|nutrition_plan_assignments_plan_id_athlete_id_key/, "alreadyAssigned"],
  [/evaluations_template_id_fkey/, "templateInUse"],
  [/row-level security|permission denied/i, "notPermitted"],
];

/** DB error message -> i18n key. */
export function developmentErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  for (const [re, key] of DB_ERRORS) if (re.test(m)) return E(key);
  return E("generic");
}

/** First zod issue as an i18n key. */
export function zodKey(error: z.ZodError): string {
  const msg = error.issues[0]?.message ?? "";
  return msg.startsWith("development.errors.") ? msg : E("invalidRequest");
}
