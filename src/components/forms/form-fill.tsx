"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { submitForm, uploadFormFile } from "@/lib/actions/forms";
import { allFields, type FormDefinition } from "@/lib/forms/schema";
import { validateAnswers, visibleFieldIds } from "@/lib/forms/logic";
import { FieldInput } from "./field-input";

/** Renders the sections of a form with conditional visibility. */
function Sections({
  definition, answers, setAnswer, errors, signatures, setSignature, onUpload, idPrefix,
}: {
  definition: FormDefinition;
  answers: Record<string, unknown>;
  setAnswer: (id: string, v: unknown) => void;
  errors: Record<string, string>;
  signatures: Record<string, string | null>;
  setSignature: (id: string, v: string | null) => void;
  onUpload?: (file: File) => Promise<{ path: string; name: string; mime: string } | { error: string }>;
  idPrefix: string;
}) {
  const visible = visibleFieldIds(allFields(definition), answers);
  return (
    <div className="space-y-6">
      {definition.sections.map((s) => {
        const fields = s.fields.filter((f) => visible.has(f.id));
        if (!fields.length && !s.title) return null;
        return (
          <section key={s.id} className="space-y-4">
            {(s.title || s.description) && (
              <div>
                {s.title && <h2 className="text-lg font-semibold text-ink">{s.title}</h2>}
                {s.description && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{s.description}</p>}
              </div>
            )}
            {fields.map((f) => (
              <FieldInput key={f.id} field={f} value={answers[f.id]} onChange={(v) => setAnswer(f.id, v)} error={errors[f.id]} idPrefix={idPrefix}
                signature={signatures[f.id] ?? null} onSignature={(d) => setSignature(f.id, d)} onUpload={onUpload} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Builder preview: interactive, never submits. */
export function FormPreview({ definition }: { definition: FormDefinition }) {
  const [answers, setAnswers] = React.useState<Record<string, unknown>>({});
  const [signatures, setSignatures] = React.useState<Record<string, string | null>>({});
  return (
    <Sections definition={definition} answers={answers} setAnswer={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))} errors={{}}
      signatures={signatures} setSignature={(id, v) => setSignatures((s) => ({ ...s, [id]: v }))} idPrefix="pv" />
  );
}

export function FormFill({
  ctx, doneHref,
}: {
  ctx: { formId: string; versionId: string; definition: FormDefinition; athleteId: string; assignmentId: string | null };
  doneHref: string;
}) {
  const t = useT();
  const router = useRouter();
  const [answers, setAnswers] = React.useState<Record<string, unknown>>({});
  const [signatures, setSignatures] = React.useState<Record<string, string | null>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onUpload(file: File) {
    const fd = new FormData();
    fd.set("athleteId", ctx.athleteId);
    fd.set("file", file);
    const r = await uploadFormFile(fd);
    return r.ok && r.data ? r.data : { error: r.ok ? t("forms.errors.uploadFailed") : r.error };
  }

  async function submit() {
    // Client-side check first (the server validates again against its own copy).
    const raw: Record<string, unknown> = { ...answers };
    for (const f of allFields(ctx.definition)) {
      if (f.type === "signature") raw[f.id] = { name: (answers[f.id] as { name?: string } | undefined)?.name ?? "", path: signatures[f.id] ? "pending" : null };
    }
    const local = validateAnswers(ctx.definition, raw);
    if (!local.ok) {
      setErrors(Object.fromEntries(Object.entries(local.errors).map(([k, key]) => [k, t.dynamic(key)])));
      setFormError(t("forms.errors.fixFields"));
      return;
    }
    setBusy(true);
    setFormError(null);
    setErrors({});
    const sigs = Object.fromEntries(Object.entries(signatures).filter((e): e is [string, string] => !!e[1]));
    const res = await submitForm({ formId: ctx.formId, versionId: ctx.versionId, athleteId: ctx.athleteId, assignmentId: ctx.assignmentId, answers, signatures: sigs });
    setBusy(false);
    if (!res.ok) {
      setFormError(res.error);
      if ("fieldErrors" in res && res.fieldErrors) setErrors(res.fieldErrors);
      return;
    }
    router.push(doneHref);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Sections definition={ctx.definition} answers={answers} setAnswer={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))} errors={errors}
        signatures={signatures} setSignature={(id, v) => setSignatures((s) => ({ ...s, [id]: v }))} onUpload={onUpload} idPrefix="ff" />
      {formError && <div className="rounded-md border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{formError}</div>}
      <p className="flex items-center gap-2 text-xs text-ink-3"><ShieldCheck className="h-4 w-4 shrink-0 text-success" /> {t("forms.fill.privacy")}</p>
      <Button type="button" onClick={submit} disabled={busy}>{busy ? t("forms.fill.submitting") : t("forms.fill.submit")}</Button>
    </div>
  );
}
