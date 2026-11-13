"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Plus, Send, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, Input, Label, Select, Textarea } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { createForm, deleteDraftForm, publishForm, saveFormDraft, setFormArchived } from "@/lib/actions/forms";
import { FORM_TYPES, allFields, newFieldId, type FormDefinition, type FormType } from "@/lib/forms/schema";
import { FieldListEditor } from "./field-editor";
import { useFormsAction } from "./use-action";
import { FormPreview } from "./form-fill";

/** New form: title, type, description; then the builder opens. */
export function NewFormForm() {
  const t = useT();
  const router = useRouter();
  const { err, busy, run } = useFormsAction();
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [formType, setFormType] = React.useState<FormType>("waiver");
  return (
    <form className="max-w-xl space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => createForm({ title, description, formType }), (r) => r.ok && r.data && router.push(`/admin/forms/${r.data.id}`)); }}>
      <div><Label htmlFor="nf-title">{t("forms.builder.title")}</Label><Input id="nf-title" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
      <div>
        <Label htmlFor="nf-type">{t("forms.builder.formType")}</Label>
        <Select id="nf-type" value={formType} onChange={(e) => setFormType(e.target.value as FormType)}>
          {FORM_TYPES.map((ft) => <option key={ft} value={ft}>{t.dynamic(`forms.types.${ft}`)}</option>)}
        </Select>
      </div>
      <div><Label htmlFor="nf-desc">{t("forms.builder.description")}</Label><Textarea id="nf-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      {err && <p className="text-sm text-danger">{err}</p>}
      <Button type="submit" disabled={busy}>{busy ? t("common.saving") : t("forms.builder.create")}</Button>
    </form>
  );
}

export function FormBuilder({
  form,
}: {
  form: { id: string; title: string; description: string | null; formType: FormType; status: string; draft: FormDefinition; hasVersion: boolean; unpublishedChanges: boolean };
}) {
  const t = useT();
  const router = useRouter();
  const { err, msg, busy, run } = useFormsAction();
  const [title, setTitle] = React.useState(form.title);
  const [description, setDescription] = React.useState(form.description ?? "");
  const [formType, setFormType] = React.useState<FormType>(form.formType);
  const [def, setDef] = React.useState<FormDefinition>(form.draft.sections.length ? form.draft : { sections: [{ id: "s1", title: "", description: "", fields: [] }] });
  const [dirty, setDirty] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const update = (d: FormDefinition) => { setDef(d); setDirty(true); };
  const allIds = allFields(def).map((f) => f.id);

  const save = () => run(() => saveFormDraft(form.id, { title, description, formType }, def), () => setDirty(false));
  const publish = async () => {
    if (dirty && !(await run(() => saveFormDraft(form.id, { title, description, formType }, def), () => setDirty(false)))) return;
    if (!window.confirm(t("forms.builder.publishConfirm"))) return;
    await run(() => publishForm(form.id));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={form.status === "published" ? "success" : form.status === "archived" ? "neutral" : "warning"}>{t.dynamic(`forms.status.${form.status}`)}</Badge>
        {form.unpublishedChanges && form.hasVersion && <Badge tone="warning">{t("forms.builder.unpublished")}</Badge>}
        {dirty && <Badge tone="info">{t("forms.builder.unsaved")}</Badge>}
      </div>

      <Card><CardBody className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><Label htmlFor="fb-title">{t("forms.builder.title")}</Label><Input id="fb-title" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} /></div>
          <div>
            <Label htmlFor="fb-type">{t("forms.builder.formType")}</Label>
            <Select id="fb-type" value={formType} onChange={(e) => { setFormType(e.target.value as FormType); setDirty(true); }}>
              {FORM_TYPES.map((ft) => <option key={ft} value={ft}>{t.dynamic(`forms.types.${ft}`)}</option>)}
            </Select>
          </div>
        </div>
        <div><Label htmlFor="fb-desc">{t("forms.builder.description")}</Label><Textarea id="fb-desc" value={description} onChange={(e) => { setDescription(e.target.value); setDirty(true); }} /></div>
        {formType === "medical" && <p className="rounded bg-warning-soft px-3 py-2 text-xs text-warning">{t("forms.builder.medicalNotice")}</p>}
      </CardBody></Card>

      {def.sections.map((s, si) => {
        const before = def.sections.slice(0, si).flatMap((x) => x.fields);
        return (
          <Card key={s.id}><CardBody className="space-y-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">{t("forms.builder.section", { index: si + 1 })}</h3>
              {def.sections.length > 1 && (
                <Button type="button" size="sm" variant="ghost" onClick={() => {
                  const removed = new Set(s.fields.map((f) => f.id));
                  update({ sections: def.sections.filter((_, j) => j !== si).map((x) => ({ ...x, fields: x.fields.map((f) => (f.showIf && removed.has(f.showIf.field) ? { ...f, showIf: null } : f)) })) });
                }}><Trash2 className="h-3.5 w-3.5" /> {t("forms.builder.removeSection")}</Button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div><Label htmlFor={`s-${s.id}-t`}>{t("forms.builder.sectionTitle")}</Label><Input id={`s-${s.id}-t`} value={s.title} onChange={(e) => update({ sections: def.sections.map((x, j) => (j === si ? { ...x, title: e.target.value } : x)) })} /></div>
              <div><Label htmlFor={`s-${s.id}-d`}>{t("forms.builder.sectionDescription")}</Label><Input id={`s-${s.id}-d`} value={s.description} onChange={(e) => update({ sections: def.sections.map((x, j) => (j === si ? { ...x, description: e.target.value } : x)) })} /></div>
            </div>
            <FieldListEditor fields={s.fields} before={before} allIds={allIds} idPrefix={`s-${s.id}`}
              onChange={(fields) => update({ sections: def.sections.map((x, j) => (j === si ? { ...x, fields } : x)) })} />
          </CardBody></Card>
        );
      })}

      <Button type="button" variant="secondary" onClick={() => update({ sections: [...def.sections, { id: newFieldId(def.sections.map((s) => s.id), "s"), title: "", description: "", fields: [] }] })}>
        <Plus className="h-4 w-4" /> {t("forms.builder.addSection")}
      </Button>

      {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      {msg && !err && <p className="text-sm text-success" role="status">{msg}</p>}

      <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-line bg-bg/95 py-3">
        <Button type="button" onClick={save} disabled={busy}>{busy ? t("common.saving") : t("forms.builder.saveDraft")}</Button>
        <Button type="button" variant="accent" onClick={publish} disabled={busy}><Send className="h-4 w-4" /> {t("forms.builder.publish")}</Button>
        <Button type="button" variant="secondary" onClick={() => setPreview((p) => !p)}>{preview ? t("forms.builder.hidePreview") : t("forms.builder.preview")}</Button>
        {form.status !== "archived" ? (
          form.hasVersion ? (
            <Button type="button" variant="ghost" onClick={() => run(() => setFormArchived(form.id, true))} disabled={busy}><Archive className="h-4 w-4" /> {t("forms.builder.archive")}</Button>
          ) : (
            <Button type="button" variant="ghost" onClick={() => window.confirm(t("forms.builder.deleteConfirm")) && run(() => deleteDraftForm(form.id), (r) => r.ok && router.push("/admin/forms"))} disabled={busy}><Trash2 className="h-4 w-4" /> {t("common.delete")}</Button>
          )
        ) : (
          <Button type="button" variant="ghost" onClick={() => run(() => setFormArchived(form.id, false))} disabled={busy}><ArchiveRestore className="h-4 w-4" /> {t("forms.builder.restore")}</Button>
        )}
      </div>

      {preview && <Card><CardBody><FormPreview definition={def} /></CardBody></Card>}
    </div>
  );
}
