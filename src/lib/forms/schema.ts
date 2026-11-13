import { z } from "zod";

/**
 * Form builder definitions (pure; shared by server actions, the builder UI,
 * the fill-in UI, the registration form editor and unit tests).
 *
 * A form is a list of sections, each with fields. Labels, help texts and
 * option labels are tenant content (typed by the club), not UI strings.
 * Validation messages are i18n keys under `forms.errors.*`.
 */

export const FIELD_TYPES = [
  "text", "long_text", "number", "date", "single_choice", "multi_choice", "yes_no", "signature", "file", "consent", "info",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FORM_TYPES = ["waiver", "medical", "media_consent", "custom"] as const;
export type FormType = (typeof FORM_TYPES)[number];

export const ASSIGNMENT_SCOPES = ["all_members", "program", "team", "training_service"] as const;
export type AssignmentScope = (typeof ASSIGNMENT_SCOPES)[number];

export const RENEWALS = ["none", "yearly", "months"] as const;
export type Renewal = (typeof RENEWALS)[number];

/** Types that hold no answer of their own. */
export const NON_ANSWER_TYPES: ReadonlySet<FieldType> = new Set(["info"]);
export const CHOICE_TYPES: ReadonlySet<FieldType> = new Set(["single_choice", "multi_choice"]);

const E = (k: string) => `forms.errors.${k}`;
export const FIELD_ID_RE = /^[a-z][a-z0-9_]{0,39}$/;

export const optionSchema = z.object({
  value: z.string().trim().min(1, E("optionRequired")).max(80, E("tooLong")),
  label: z.string().trim().min(1, E("optionRequired")).max(200, E("tooLong")),
});
export type FieldOption = z.infer<typeof optionSchema>;

export const showIfSchema = z.object({
  field: z.string().regex(FIELD_ID_RE, E("invalidFieldId")),
  equals: z.string().trim().min(1, E("conditionValue")).max(80, E("tooLong")),
});
export type ShowIf = z.infer<typeof showIfSchema>;

export const fieldSchema = z.object({
  id: z.string().regex(FIELD_ID_RE, E("invalidFieldId")),
  type: z.enum(FIELD_TYPES),
  label: z.string().trim().min(1, E("labelRequired")).max(300, E("tooLong")),
  help: z.string().trim().max(2000, E("tooLong")).optional().default(""),
  required: z.boolean().optional().default(false),
  options: z.array(optionSchema).max(30, E("tooMany")).optional().default([]),
  showIf: showIfSchema.nullable().optional().default(null),
  /** Coaches of the athlete may read this answer (allergies, emergency contact ...). */
  safety: z.boolean().optional().default(false),
  min: z.number().finite().nullable().optional().default(null),
  max: z.number().finite().nullable().optional().default(null),
});
export type FieldDef = z.infer<typeof fieldSchema>;
export type FieldInput = z.input<typeof fieldSchema>;

export const sectionSchema = z.object({
  id: z.string().regex(FIELD_ID_RE, E("invalidFieldId")),
  title: z.string().trim().max(160, E("tooLong")).optional().default(""),
  description: z.string().trim().max(4000, E("tooLong")).optional().default(""),
  fields: z.array(fieldSchema).max(80, E("tooMany")),
});
export type SectionDef = z.infer<typeof sectionSchema>;

/** Checks shared by forms and registration questions: ids, options, conditions. */
export function checkFields(fields: FieldDef[], ctx: z.RefinementCtx, pathPrefix: (string | number)[] = []) {
  const seen = new Map<string, FieldDef>();
  fields.forEach((f, i) => {
    const path = [...pathPrefix, i];
    if (seen.has(f.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: E("duplicateFieldId"), path: [...path, "id"] });
    if (CHOICE_TYPES.has(f.type)) {
      if (f.options.length < 2) ctx.addIssue({ code: z.ZodIssueCode.custom, message: E("optionsRequired"), path: [...path, "options"] });
      const values = new Set(f.options.map((o) => o.value));
      if (values.size !== f.options.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: E("duplicateOption"), path: [...path, "options"] });
    }
    if (f.type === "number" && f.min !== null && f.max !== null && f.min > f.max)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: E("minMax"), path: [...path, "max"] });
    if (f.showIf) {
      // Conditions may only point at an EARLIER answer field: no cycles, and
      // the condition is always answerable before the field shows.
      const target = seen.get(f.showIf.field);
      if (!target || NON_ANSWER_TYPES.has(target.type) || target.type === "signature" || target.type === "file")
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: E("conditionTarget"), path: [...path, "showIf"] });
      else if (CHOICE_TYPES.has(target.type) && !target.options.some((o) => o.value === f.showIf!.equals))
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: E("conditionValue"), path: [...path, "showIf"] });
      else if (target.type === "yes_no" && !["yes", "no"].includes(f.showIf.equals))
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: E("conditionValue"), path: [...path, "showIf"] });
    }
    seen.set(f.id, f);
  });
}

export const formDefinitionSchema = z
  .object({ sections: z.array(sectionSchema).min(1, E("sectionsRequired")).max(20, E("tooMany")) })
  .superRefine((def, ctx) => {
    const sectionIds = new Set<string>();
    def.sections.forEach((s, i) => {
      if (sectionIds.has(s.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: E("duplicateFieldId"), path: ["sections", i, "id"] });
      sectionIds.add(s.id);
    });
    const all = def.sections.flatMap((s) => s.fields);
    if (all.length > 200) ctx.addIssue({ code: z.ZodIssueCode.custom, message: E("tooMany"), path: ["sections"] });
    checkFields(all, ctx, ["fields"]);
  });
export type FormDefinition = z.infer<typeof formDefinitionSchema>;
export type FormDefinitionInput = z.input<typeof formDefinitionSchema>;

export const allFields = (def: Pick<FormDefinition, "sections">): FieldDef[] => def.sections.flatMap((s) => s.fields);

/** Parse a stored (jsonb) definition; an unreadable one becomes an empty form. */
export function parseDefinition(raw: unknown): FormDefinition {
  const p = formDefinitionSchema.safeParse(raw);
  if (p.success) return p.data;
  const loose = z.object({ sections: z.array(sectionSchema) }).safeParse(raw);
  return loose.success ? loose.data : { sections: [] };
}

/** First zod issue as an i18n key (messages are keys by construction). */
export function firstIssueKey(err: z.ZodError): string {
  const m = err.issues[0]?.message ?? "";
  return m.startsWith("forms.errors.") ? m : E("invalidRequest");
}

/** A fresh field / section id that does not collide with the given ones. */
export function newFieldId(existing: Iterable<string>, prefix = "f"): string {
  const taken = new Set(existing);
  for (let i = 1; ; i++) {
    const id = `${prefix}${i}`;
    if (!taken.has(id)) return id;
  }
}
