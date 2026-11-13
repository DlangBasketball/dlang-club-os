import { z } from "zod";
import { checkFields, fieldSchema, type FieldDef } from "@/lib/forms/schema";
import { validateFieldAnswers, type Answers } from "@/lib/forms/logic";

/**
 * Registration form editor (pure). Per programme (camps are programmes):
 * which built-in fields are shown / required, plus custom questions that
 * reuse the form-builder field types. The default config reproduces the
 * registration form as it was before the editor existed.
 */

export const BUILTIN_FIELDS = [
  "address", // parent
  "gender",
  "allergies",
  "conditions",
  "medicalNotes",
  "school",
  "nationality",
  "jerseySize",
  "dominantHand",
  "positionPref",
] as const;
export type BuiltinField = (typeof BUILTIN_FIELDS)[number];

/** Fields that belong to the parent block (asked once), the rest per child. */
export const PARENT_FIELDS: ReadonlySet<BuiltinField> = new Set(["address"]);
/** Built-ins stored on the athlete record (athletes.<column>). */
export const ATHLETE_COLUMNS: Partial<Record<BuiltinField, string>> = {
  school: "school",
  nationality: "nationality",
  jerseySize: "jersey_size",
  dominantHand: "dominant_hand",
  positionPref: "position_pref",
};
/** Medical built-ins (stored in athlete_medical by the registration RPC). */
export const MEDICAL_FIELDS: ReadonlySet<BuiltinField> = new Set(["allergies", "conditions", "medicalNotes"]);

export type BuiltinSetting = { shown: boolean; required: boolean };
export type BuiltinConfig = Record<BuiltinField, BuiltinSetting>;

export const DEFAULT_BUILTIN: BuiltinConfig = {
  address: { shown: true, required: false },
  gender: { shown: true, required: false },
  allergies: { shown: true, required: false },
  conditions: { shown: true, required: false },
  medicalNotes: { shown: true, required: false },
  school: { shown: false, required: false },
  nationality: { shown: false, required: false },
  jerseySize: { shown: false, required: false },
  dominantHand: { shown: false, required: false },
  positionPref: { shown: false, required: false },
};

/** Field types a registration question may use (no uploads / drawn signatures: guests have no family yet). */
export const QUESTION_TYPES = ["text", "long_text", "number", "date", "single_choice", "multi_choice", "yes_no", "consent", "info"] as const;

const E = (k: string) => `forms.errors.${k}`;

export const questionSchema = fieldSchema.refine((f) => (QUESTION_TYPES as readonly string[]).includes(f.type), { message: E("questionType"), path: ["type"] });

export const registrationConfigSchema = z
  .object({
    builtin: z.record(z.string(), z.object({ shown: z.boolean(), required: z.boolean() })).optional().default({}),
    questions: z.array(questionSchema).max(40, E("tooMany")).optional().default([]),
  })
  .superRefine((v, ctx) => {
    for (const k of Object.keys(v.builtin)) {
      if (!(BUILTIN_FIELDS as readonly string[]).includes(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: E("invalidRequest"), path: ["builtin", k] });
    }
    checkFields(v.questions, ctx, ["questions"]);
  });
export type RegistrationConfigInput = z.input<typeof registrationConfigSchema>;

export type RegistrationConfig = { builtin: BuiltinConfig; questions: FieldDef[] };

/** Stored (jsonb) config -> complete config; anything unreadable falls back to the defaults. */
export function resolveConfig(raw: { builtin?: unknown; questions?: unknown } | null | undefined): RegistrationConfig {
  const builtin: BuiltinConfig = { ...DEFAULT_BUILTIN };
  const b = raw?.builtin;
  if (b && typeof b === "object") {
    for (const k of BUILTIN_FIELDS) {
      const s = (b as Record<string, unknown>)[k] as Partial<BuiltinSetting> | undefined;
      if (s && typeof s === "object") {
        const shown = typeof s.shown === "boolean" ? s.shown : builtin[k].shown;
        builtin[k] = { shown, required: shown && s.required === true };
      }
    }
  }
  const q = z.array(questionSchema).safeParse(raw?.questions ?? []);
  return { builtin, questions: q.success ? q.data : [] };
}

/** Normalise an admin-entered config: a hidden field is never required. */
export function normaliseConfig(input: z.output<typeof registrationConfigSchema>): RegistrationConfig {
  return resolveConfig({
    builtin: Object.fromEntries(
      Object.entries(input.builtin).map(([k, s]) => [k, { shown: s.shown, required: s.shown && s.required }]),
    ),
    questions: input.questions,
  });
}

export const isDefaultConfig = (c: RegistrationConfig) =>
  c.questions.length === 0 && BUILTIN_FIELDS.every((k) => c.builtin[k].shown === DEFAULT_BUILTIN[k].shown && c.builtin[k].required === DEFAULT_BUILTIN[k].required);

export type ChildExtras = Partial<Record<BuiltinField, string>>;

const MAX_LEN: Record<BuiltinField, number> = {
  address: 300, gender: 20, allergies: 1000, conditions: 1000, medicalNotes: 2000, school: 160, nationality: 80, jerseySize: 20,
  dominantHand: 20, positionPref: 80,
};

/**
 * Validate the configured built-ins for one child (and the parent block when
 * `parent` is given) plus the custom answers. Error keys are i18n keys; paths
 * are relative (`gender`, `q.<questionId>`).
 */
export function validateRegistrationExtras(
  config: RegistrationConfig,
  values: ChildExtras,
  answers: Record<string, unknown>,
  scope: "child" | "parent" | "all" = "all",
): { ok: boolean; errors: Record<string, string>; extras: ChildExtras; answers: Answers } {
  const errors: Record<string, string> = {};
  const extras: ChildExtras = {};
  for (const k of BUILTIN_FIELDS) {
    if (scope === "child" && PARENT_FIELDS.has(k)) continue;
    if (scope === "parent" && !PARENT_FIELDS.has(k)) continue;
    const s = config.builtin[k];
    const v = (values[k] ?? "").toString().trim();
    if (!s.shown) continue;
    if (!v) {
      if (s.required) errors[k] = E("required");
      continue;
    }
    if (v.length > MAX_LEN[k]) errors[k] = E("tooLong");
    else extras[k] = v;
  }
  let clean: Answers = {};
  if (scope !== "parent") {
    const r = validateFieldAnswers(config.questions, answers);
    for (const [id, key] of Object.entries(r.errors)) errors[`q.${id}`] = key;
    clean = r.values;
  }
  return { ok: Object.keys(errors).length === 0, errors, extras, answers: clean };
}
