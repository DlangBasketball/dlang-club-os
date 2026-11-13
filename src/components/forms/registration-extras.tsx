"use client";

import * as React from "react";
import { Input, Label } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { visibleFieldIds } from "@/lib/forms/logic";
import type { RegistrationConfig, BuiltinField } from "@/lib/registration-form/config";
import { FieldInput } from "./field-input";

/**
 * Extra built-in fields (school, nationality, jersey size ...) and the
 * programme's custom questions for one child, as configured in the
 * registration form editor. The classic fields (gender, allergies ...) stay
 * in the existing forms and are toggled with `shows()`.
 */
const EXTRA_BUILTINS: BuiltinField[] = ["school", "nationality", "jerseySize", "dominantHand", "positionPref"];

export const shows = (config: RegistrationConfig | null | undefined, k: BuiltinField) => (config ? config.builtin[k].shown : true);
export const requiredMark = (config: RegistrationConfig | null | undefined, k: BuiltinField) => (config?.builtin[k].required ? " *" : "");

export function ChildExtrasFields({
  config, extras, answers, onExtras, onAnswers, errors, idPrefix, builtins = true,
}: {
  config: RegistrationConfig;
  extras: Partial<Record<BuiltinField, string>>;
  answers: Record<string, unknown>;
  onExtras: (k: BuiltinField, v: string) => void;
  onAnswers: (id: string, v: unknown) => void;
  errors: Record<string, string | undefined>;
  idPrefix: string;
  builtins?: boolean;
}) {
  const t = useT();
  const shownExtras = builtins ? EXTRA_BUILTINS.filter((k) => config.builtin[k].shown) : [];
  const visible = visibleFieldIds(config.questions, answers);
  if (!shownExtras.length && !config.questions.length) return null;
  return (
    <div className="space-y-4">
      {shownExtras.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {shownExtras.map((k) => (
            <div key={k}>
              <Label htmlFor={`${idPrefix}-${k}`}>{t.dynamic(`forms.builtin.${k}`)}{requiredMark(config, k)}</Label>
              <Input id={`${idPrefix}-${k}`} value={extras[k] ?? ""} onChange={(e) => onExtras(k, e.target.value)} aria-invalid={!!errors[k]} />
              {errors[k] && <p className="mt-1 text-xs text-danger">{errors[k]}</p>}
            </div>
          ))}
        </div>
      )}
      {config.questions.filter((q) => visible.has(q.id)).map((q) => (
        <FieldInput key={q.id} field={q} value={answers[q.id]} onChange={(v) => onAnswers(q.id, v)} error={errors[`q.${q.id}`]} idPrefix={idPrefix} />
      ))}
    </div>
  );
}
