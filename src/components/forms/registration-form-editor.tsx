"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import { Button, Card, CardBody } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { resetRegistrationFormConfig, saveRegistrationFormConfig } from "@/lib/actions/registration-form";
import { BUILTIN_FIELDS, QUESTION_TYPES, type BuiltinConfig, type RegistrationConfig } from "@/lib/registration-form/config";
import type { FieldDef } from "@/lib/forms/schema";
import { FieldListEditor } from "./field-editor";
import { useFormsAction } from "./use-action";

/** Per programme / camp: which built-in fields show (and are required) + custom questions. */
export function RegistrationFormEditor({ programId, initial, isDefault }: { programId: string; initial: RegistrationConfig; isDefault: boolean }) {
  const t = useT();
  const { err, msg, busy, run } = useFormsAction();
  const [builtin, setBuiltin] = React.useState<BuiltinConfig>(initial.builtin);
  const [questions, setQuestions] = React.useState<FieldDef[]>(initial.questions);
  const set = (k: keyof BuiltinConfig, p: Partial<BuiltinConfig[keyof BuiltinConfig]>) =>
    setBuiltin((b) => {
      const next = { ...b[k], ...p };
      if (!next.shown) next.required = false;
      return { ...b, [k]: next };
    });

  return (
    <div className="space-y-5">
      <Card><CardBody className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">{t("forms.regForm.builtinTitle")}</h2>
        <p className="text-xs text-ink-3">{t("forms.regForm.builtinHint")}</p>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-ink-3"><th className="py-2">{t("forms.regForm.field")}</th><th className="py-2">{t("forms.regForm.shown")}</th><th className="py-2">{t("forms.regForm.required")}</th></tr></thead>
          <tbody>
            {BUILTIN_FIELDS.map((k) => (
              <tr key={k} className="border-b border-line/60">
                <td className="py-2 text-ink">{t.dynamic(`forms.builtin.${k}`)}</td>
                <td className="py-2"><input type="checkbox" aria-label={t("forms.regForm.shown")} className="h-4 w-4" checked={builtin[k].shown} onChange={(e) => set(k, { shown: e.target.checked })} /></td>
                <td className="py-2"><input type="checkbox" aria-label={t("forms.regForm.required")} className="h-4 w-4" disabled={!builtin[k].shown} checked={builtin[k].required} onChange={(e) => set(k, { required: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody></Card>

      <Card><CardBody className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">{t("forms.regForm.questionsTitle")}</h2>
        <p className="text-xs text-ink-3">{t("forms.regForm.questionsHint")}</p>
        <FieldListEditor fields={questions} onChange={setQuestions} types={QUESTION_TYPES} allowSafety={false} allIds={questions.map((q) => q.id)} idPrefix="rq" />
      </CardBody></Card>

      {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      {msg && !err && <p className="text-sm text-success" role="status">{msg}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => run(() => saveRegistrationFormConfig(programId, { builtin, questions }))}>{busy ? t("common.saving") : t("common.save")}</Button>
        {!isDefault && (
          <Button variant="ghost" disabled={busy} onClick={() => window.confirm(t("forms.regForm.resetConfirm")) && run(() => resetRegistrationFormConfig(programId))}>
            <RotateCcw className="h-4 w-4" /> {t("forms.regForm.reset")}
          </Button>
        )}
      </div>
    </div>
  );
}
