import { NON_ANSWER_TYPES, allFields, type FieldDef, type FormDefinition, type Renewal } from "./schema";

/**
 * Pure form logic: conditional visibility, answer validation and
 * normalisation, renewal / completion status. Mirrors the database rules in
 * migration 20250420100800_forms_contracts.sql (valid_until).
 */

export type SignatureAnswer = { name: string; path: string | null };
export type FileAnswer = { path: string; name: string; mime: string };
export type AnswerValue = string | number | boolean | string[] | SignatureAnswer | FileAnswer;
export type Answers = Record<string, AnswerValue>;

const E = (k: string) => `forms.errors.${k}`;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Does the given raw answer satisfy "equals" (choice value, yes / no, text)? */
function matches(value: unknown, equals: string): boolean {
  if (Array.isArray(value)) return value.map(String).includes(equals);
  if (typeof value === "boolean") return (value ? "yes" : "no") === equals;
  if (value === null || value === undefined) return false;
  return String(value).trim().toLowerCase() === equals.trim().toLowerCase();
}

/**
 * A field shows when it has no condition, or when the field it depends on is
 * itself visible and its answer equals the expected value. Conditions only
 * point at earlier fields (enforced by the schema), so this terminates; a
 * guard set protects against a malformed stored definition anyway.
 */
export function isFieldVisible(field: FieldDef, answers: Record<string, unknown>, byId: Map<string, FieldDef>, guard = new Set<string>()): boolean {
  if (!field.showIf) return true;
  if (guard.has(field.id)) return false;
  const target = byId.get(field.showIf.field);
  if (!target) return false;
  guard.add(field.id);
  return isFieldVisible(target, answers, byId, guard) && matches(answers[target.id], field.showIf.equals);
}

export function visibleFieldIds(fields: FieldDef[], answers: Record<string, unknown>): Set<string> {
  const byId = new Map(fields.map((f) => [f.id, f]));
  return new Set(fields.filter((f) => isFieldVisible(f, answers, byId)).map((f) => f.id));
}

export type ValidationResult = { ok: boolean; values: Answers; errors: Record<string, string> };

const isEmpty = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/**
 * Validate raw answers against field definitions. Hidden fields, info blocks
 * and unknown keys are dropped (an answer to a field that is not shown is
 * never stored). `pathOk` checks storage keys of uploads / signatures.
 */
export function validateFieldAnswers(
  fields: FieldDef[],
  raw: Record<string, unknown>,
  opts: { pathOk?: (path: string) => boolean } = {},
): ValidationResult {
  const visible = visibleFieldIds(fields, raw);
  const values: Answers = {};
  const errors: Record<string, string> = {};
  const pathOk = opts.pathOk ?? (() => true);

  for (const f of fields) {
    if (NON_ANSWER_TYPES.has(f.type) || !visible.has(f.id)) continue;
    const v = raw[f.id];
    if (f.type === "signature") {
      const s = (v ?? {}) as Partial<SignatureAnswer>;
      const name = typeof s.name === "string" ? s.name.trim() : "";
      const path = typeof s.path === "string" && s.path ? s.path : null;
      if (!name && !path) {
        if (f.required) errors[f.id] = E("signatureRequired");
        continue;
      }
      if (name.length < 2 || name.length > 160) { errors[f.id] = E("signerName"); continue; }
      if (!path) { errors[f.id] = E("signatureDrawn"); continue; }
      if (!pathOk(path)) { errors[f.id] = E("invalidFile"); continue; }
      values[f.id] = { name, path };
      continue;
    }
    if (f.type === "file") {
      const file = (v ?? null) as Partial<FileAnswer> | null;
      if (!file || typeof file.path !== "string" || !file.path) {
        if (f.required) errors[f.id] = E("fileRequired");
        continue;
      }
      if (!pathOk(file.path)) { errors[f.id] = E("invalidFile"); continue; }
      values[f.id] = { path: file.path, name: String(file.name ?? "").slice(0, 200), mime: String(file.mime ?? "").slice(0, 100) };
      continue;
    }
    if (f.type === "consent") {
      if (v === true || v === "true" || v === "on") values[f.id] = true;
      else if (f.required) errors[f.id] = E("consentRequired");
      continue;
    }
    if (isEmpty(v)) {
      if (f.required) errors[f.id] = E("required");
      continue;
    }
    switch (f.type) {
      case "text":
      case "long_text": {
        const s = String(v).trim();
        const max = f.type === "text" ? 500 : 10000;
        if (s.length > max) errors[f.id] = E("tooLong");
        else values[f.id] = s;
        break;
      }
      case "number": {
        const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
        if (!Number.isFinite(n)) errors[f.id] = E("number");
        else if ((f.min !== null && n < f.min) || (f.max !== null && n > f.max)) errors[f.id] = E("numberRange");
        else values[f.id] = n;
        break;
      }
      case "date":
        if (!isIsoDate(v)) errors[f.id] = E("date");
        else values[f.id] = v;
        break;
      case "single_choice": {
        const s = String(v);
        if (!f.options.some((o) => o.value === s)) errors[f.id] = E("choice");
        else values[f.id] = s;
        break;
      }
      case "multi_choice": {
        const arr = (Array.isArray(v) ? v : [v]).map(String);
        const allowed = new Set(f.options.map((o) => o.value));
        if (arr.some((x) => !allowed.has(x))) errors[f.id] = E("choice");
        else values[f.id] = Array.from(new Set(arr));
        break;
      }
      case "yes_no": {
        const s = v === true ? "yes" : v === false ? "no" : String(v);
        if (s !== "yes" && s !== "no") errors[f.id] = E("choice");
        else values[f.id] = s;
        break;
      }
    }
  }
  return { ok: Object.keys(errors).length === 0, values, errors };
}

export function validateAnswers(def: FormDefinition, raw: Record<string, unknown>, opts?: { pathOk?: (path: string) => boolean }): ValidationResult {
  return validateFieldAnswers(allFields(def), raw, opts);
}

/** The signer of a form: the first signature answer, if any. */
export function signatureOf(def: FormDefinition, answers: Answers): SignatureAnswer | null {
  for (const f of allFields(def)) {
    if (f.type !== "signature") continue;
    const v = answers[f.id] as SignatureAnswer | undefined;
    if (v && typeof v === "object" && "name" in v) return v;
  }
  return null;
}

/** Storage keys referenced by answers (signatures + uploads). */
export function answerPaths(def: FormDefinition, answers: Answers): string[] {
  const out: string[] = [];
  for (const f of allFields(def)) {
    const v = answers[f.id] as { path?: unknown } | undefined;
    if ((f.type === "signature" || f.type === "file") && v && typeof v.path === "string" && v.path) out.push(v.path);
  }
  return out;
}

/** Human-readable answer (for PDFs, exports, the detail view). */
export function displayAnswer(field: FieldDef, value: unknown, labels: { yes: string; no: string; accepted: string }): string {
  if (value === undefined || value === null) return "";
  switch (field.type) {
    case "single_choice":
      return field.options.find((o) => o.value === value)?.label ?? String(value);
    case "multi_choice":
      return (Array.isArray(value) ? value : [value]).map((v) => field.options.find((o) => o.value === v)?.label ?? String(v)).join(", ");
    case "yes_no":
      return value === "yes" || value === true ? labels.yes : labels.no;
    case "consent":
      return value === true ? labels.accepted : "";
    case "signature":
      return typeof value === "object" && value && "name" in value ? String((value as SignatureAnswer).name) : "";
    case "file":
      return typeof value === "object" && value && "name" in value ? String((value as FileAnswer).name) : "";
    default:
      return String(value);
  }
}

// ---------------------------------------------------------------------------
// Renewal and completion
// ---------------------------------------------------------------------------
function addMonthsIso(fromIso: string, months: number): string {
  const [y, m, d] = fromIso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** valid_until of a submission made on `submittedOn` (mirrors the SQL trigger). */
export function validUntilFor(renewal: Renewal, months: number | null, submittedOn: string): string | null {
  if (renewal === "yearly") return addMonthsIso(submittedOn, 12);
  if (renewal === "months" && months && months > 0) return addMonthsIso(submittedOn, months);
  return null;
}

export type CompletionStatus = "complete" | "expiring" | "expired" | "missing" | "overdue";
export const EXPIRING_DAYS = 30;

/**
 * Status of one athlete for one assignment. `latest` is the newest
 * non-voided submission of that form for the athlete (any version: a new
 * version does not invalidate existing submissions).
 */
export function completionStatus(
  latest: { validUntil: string | null } | null,
  dueDate: string | null,
  today: string,
): CompletionStatus {
  if (!latest) return dueDate && dueDate < today ? "overdue" : "missing";
  if (latest.validUntil === null) return "complete";
  if (latest.validUntil < today) return "expired";
  const soon = addDaysIso(today, EXPIRING_DAYS);
  return latest.validUntil <= soon ? "expiring" : "complete";
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Needs action from the family (shown in "My forms", counted for reminders). */
export const needsAction = (s: CompletionStatus) => s === "missing" || s === "overdue" || s === "expired" || s === "expiring";

export type CompletionSummary = { total: number; complete: number; expiring: number; expired: number; missing: number; overdue: number; pct: number };
export function summarise(statuses: CompletionStatus[]): CompletionSummary {
  const s = { total: statuses.length, complete: 0, expiring: 0, expired: 0, missing: 0, overdue: 0, pct: 0 };
  for (const x of statuses) s[x]++;
  // "Expiring" still counts as done until it lapses.
  s.pct = s.total ? Math.round(((s.complete + s.expiring) / s.total) * 100) : 100;
  return s;
}

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------
/** Next version number (publishing never reuses or rewrites a version). */
export function nextVersion(existing: number[]): number {
  return existing.length ? Math.max(...existing) + 1 : 1;
}

/** True when the draft differs from the published version (=> "unpublished changes"). */
export function hasUnpublishedChanges(draft: unknown, published: unknown | null): boolean {
  if (published === null || published === undefined) return true;
  return stableStringify(draft) !== stableStringify(published);
}

export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * Pick the version a submission is shown against: always its own version,
 * never the form's current one (old submissions stay tied to old versions).
 */
export function versionForSubmission<V extends { id: string }>(submission: { formVersionId: string }, versions: V[]): V | null {
  return versions.find((v) => v.id === submission.formVersionId) ?? null;
}
