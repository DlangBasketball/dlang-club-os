import { z } from "zod";
import { ASSIGNMENT_SCOPES, FORM_TYPES, RENEWALS } from "./schema";
import { ACTIVITY_TYPES } from "@/lib/contracts/merge";

/** Server-action input schemas for forms and contracts (messages are i18n keys). */
const E = (k: string) => `forms.errors.${k}`;
const uuid = z.string().uuid(E("invalidRequest"));
const optUuid = z.union([z.literal(""), z.null(), z.string().uuid(E("invalidRequest"))]).optional().transform((v) => (v ? v : null));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, E("date"));
const optDate = z.union([z.literal(""), z.null(), isoDate]).optional().transform((v) => (v ? v : null));

export const formMetaSchema = z.object({
  title: z.string().trim().min(1, E("titleRequired")).max(160, E("tooLong")),
  description: z.string().trim().max(4000, E("tooLong")).optional().default(""),
  formType: z.enum(FORM_TYPES, { errorMap: () => ({ message: E("invalidRequest") }) }),
});
export type FormMetaInput = z.input<typeof formMetaSchema>;

export const assignmentSchema = z
  .object({
    scope: z.enum(ASSIGNMENT_SCOPES, { errorMap: () => ({ message: E("invalidRequest") }) }),
    targetId: optUuid,
    renewal: z.enum(RENEWALS, { errorMap: () => ({ message: E("invalidRequest") }) }),
    renewalMonths: z.union([z.literal(""), z.null(), z.coerce.number().int(E("renewalMonths")).min(1, E("renewalMonths")).max(60, E("renewalMonths"))])
      .optional().transform((v) => (v === "" || v === null || v === undefined ? null : v)),
    dueDate: optDate,
    isRequired: z.boolean().optional().default(true),
    isActive: z.boolean().optional().default(true),
  })
  .refine((v) => v.scope === "all_members" || v.targetId !== null, { message: E("targetRequired"), path: ["targetId"] })
  .refine((v) => v.renewal !== "months" || v.renewalMonths !== null, { message: E("renewalMonths"), path: ["renewalMonths"] });
export type AssignmentInput = z.input<typeof assignmentSchema>;

export const reasonSchema = z.object({ reason: z.string().trim().min(3, E("reasonRequired")).max(500, E("tooLong")) });

export const submitSchema = z.object({
  formId: uuid,
  versionId: uuid,
  athleteId: uuid,
  assignmentId: optUuid,
  answers: z.record(z.string(), z.unknown()),
  /** Drawn signatures as PNG data URLs, by field id. */
  signatures: z.record(z.string(), z.string().max(450_000, E("signatureTooLarge"))).optional().default({}),
});
export type SubmitInput = z.input<typeof submitSchema>;

export const contractTemplateSchema = z.object({
  name: z.string().trim().min(1, E("nameRequired")).max(160, E("tooLong")),
  activityType: z.enum(ACTIVITY_TYPES, { errorMap: () => ({ message: E("invalidRequest") }) }),
  programId: optUuid,
  title: z.string().trim().min(1, E("titleRequired")).max(200, E("tooLong")),
  body: z.string().trim().min(1, E("bodyRequired")).max(50000, E("tooLong")),
  autoIssue: z.boolean().optional().default(true),
});
export type ContractTemplateInput = z.input<typeof contractTemplateSchema>;

export const issueContractSchema = z.object({
  templateId: uuid,
  registrationId: optUuid,
  athleteId: optUuid,
});
export type IssueContractInput = z.input<typeof issueContractSchema>;

export const signContractSchema = z.object({
  contractId: uuid,
  signerName: z.string().trim().min(2, E("signerName")).max(160, E("signerName")),
  accept: z.literal(true, { errorMap: () => ({ message: E("acceptRequired") }) }),
});
export type SignContractInput = z.input<typeof signContractSchema>;

export function zodKey(err: z.ZodError): string {
  const m = err.issues[0]?.message ?? "";
  return m.startsWith("forms.errors.") ? m : E("invalidRequest");
}
