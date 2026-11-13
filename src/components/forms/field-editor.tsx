"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { CHOICE_TYPES, FIELD_TYPES, newFieldId, type FieldDef, type FieldType } from "@/lib/forms/schema";

/** Editor for one form-builder field (type, label, help, options, required, condition, safety flag). */
export function blankField(type: FieldType, taken: Iterable<string>): FieldDef {
  return {
    id: newFieldId(taken), type, label: "", help: "", required: false, safety: false, showIf: null, min: null, max: null,
    options: CHOICE_TYPES.has(type) ? [{ value: "a", label: "" }, { value: "b", label: "" }] : [],
  };
}

export function FieldEditor({
  field, prior, onChange, onRemove, onMove, types = FIELD_TYPES, allowSafety = true,
}: {
  field: FieldDef;
  prior: FieldDef[];
  onChange: (f: FieldDef) => void;
  onRemove: () => void;
  onMove: (d: -1 | 1) => void;
  types?: readonly FieldType[];
  allowSafety?: boolean;
}) {
  const t = useT();
  const set = (p: Partial<FieldDef>) => onChange({ ...field, ...p });
  const conditionTargets = prior.filter((f) => !["info", "signature", "file"].includes(f.type));
  const target = field.showIf ? prior.find((f) => f.id === field.showIf!.field) : undefined;
  const id = `fe-${field.id}`;

  return (
    <div className="space-y-3 rounded-md border border-line bg-surface-elevated/30 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor={`${id}-type`}>{t("forms.builder.fieldType")}</Label>
          <Select id={`${id}-type`} value={field.type} onChange={(e) => {
            const type = e.target.value as FieldType;
            set({ type, options: CHOICE_TYPES.has(type) ? (field.options.length >= 2 ? field.options : [{ value: "a", label: "" }, { value: "b", label: "" }]) : [] });
          }}>
            {types.map((ty) => <option key={ty} value={ty}>{t.dynamic(`forms.fieldTypes.${ty}`)}</option>)}
          </Select>
        </div>
        <div className="flex gap-1">
          <Button type="button" size="icon" variant="ghost" aria-label={t("forms.builder.moveUp")} onClick={() => onMove(-1)}><ArrowUp className="h-4 w-4" /></Button>
          <Button type="button" size="icon" variant="ghost" aria-label={t("forms.builder.moveDown")} onClick={() => onMove(1)}><ArrowDown className="h-4 w-4" /></Button>
          <Button type="button" size="icon" variant="ghost" aria-label={t("forms.builder.removeField")} onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      <div>
        <Label htmlFor={`${id}-label`}>{field.type === "info" ? t("forms.builder.infoTitle") : t("forms.builder.label")}</Label>
        <Input id={`${id}-label`} value={field.label} onChange={(e) => set({ label: e.target.value })} />
      </div>
      <div>
        <Label htmlFor={`${id}-help`}>{field.type === "info" ? t("forms.builder.infoText") : t("forms.builder.help")}</Label>
        <Textarea id={`${id}-help`} className="min-h-[56px]" value={field.help} onChange={(e) => set({ help: e.target.value })} />
      </div>

      {CHOICE_TYPES.has(field.type) && (
        <div className="space-y-2">
          <Label>{t("forms.builder.options")}</Label>
          {field.options.map((o, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label={t("forms.builder.optionLabel")} placeholder={t("forms.builder.optionLabel")} value={o.label}
                onChange={(e) => set({ options: field.options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <Button type="button" size="icon" variant="ghost" aria-label={t("forms.builder.removeOption")}
                onClick={() => set({ options: field.options.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={() => set({ options: [...field.options, { value: newFieldId(field.options.map((o) => o.value), "o"), label: "" }] })}>
            <Plus className="h-3.5 w-3.5" /> {t("forms.builder.addOption")}
          </Button>
        </div>
      )}

      {field.type === "number" && (
        <div className="grid grid-cols-2 gap-2">
          <div><Label htmlFor={`${id}-min`}>{t("forms.builder.min")}</Label><Input id={`${id}-min`} type="number" value={field.min ?? ""} onChange={(e) => set({ min: e.target.value === "" ? null : Number(e.target.value) })} /></div>
          <div><Label htmlFor={`${id}-max`}>{t("forms.builder.max")}</Label><Input id={`${id}-max`} type="number" value={field.max ?? ""} onChange={(e) => set({ max: e.target.value === "" ? null : Number(e.target.value) })} /></div>
        </div>
      )}

      {field.type !== "info" && (
        <div className="flex flex-wrap gap-4 text-sm text-ink-2">
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={field.required} onChange={(e) => set({ required: e.target.checked })} /> {t("forms.builder.required")}</label>
          {allowSafety && !["signature", "file", "consent"].includes(field.type) && (
            <label className="flex items-center gap-2" title={t("forms.builder.safetyHint")}>
              <input type="checkbox" className="h-4 w-4" checked={field.safety} onChange={(e) => set({ safety: e.target.checked })} /> {t("forms.builder.safety")}
            </label>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-cond`}>{t("forms.builder.showIf")}</Label>
          <Select id={`${id}-cond`} value={field.showIf?.field ?? ""} onChange={(e) => {
            const f = conditionTargets.find((x) => x.id === e.target.value);
            set({ showIf: f ? { field: f.id, equals: f.type === "yes_no" ? "yes" : CHOICE_TYPES.has(f.type) ? f.options[0]?.value ?? "" : "" } : null });
          }}>
            <option value="">{t("forms.builder.always")}</option>
            {conditionTargets.map((f) => <option key={f.id} value={f.id}>{f.label || f.id}</option>)}
          </Select>
        </div>
        {field.showIf && target && (
          <div>
            <Label htmlFor={`${id}-eq`}>{t("forms.builder.equals")}</Label>
            {target.type === "yes_no" ? (
              <Select id={`${id}-eq`} value={field.showIf.equals} onChange={(e) => set({ showIf: { field: target.id, equals: e.target.value } })}>
                <option value="yes">{t("common.yes")}</option><option value="no">{t("common.no")}</option>
              </Select>
            ) : CHOICE_TYPES.has(target.type) ? (
              <Select id={`${id}-eq`} value={field.showIf.equals} onChange={(e) => set({ showIf: { field: target.id, equals: e.target.value } })}>
                {target.options.map((o) => <option key={o.value} value={o.value}>{o.label || o.value}</option>)}
              </Select>
            ) : (
              <Input id={`${id}-eq`} value={field.showIf.equals} onChange={(e) => set({ showIf: { field: target.id, equals: e.target.value } })} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A list of fields with add / move / remove; `before` = fields of earlier sections (condition targets). */
export function FieldListEditor({
  fields, before = [], onChange, types, allowSafety, allIds, idPrefix = "fl",
}: {
  fields: FieldDef[];
  before?: FieldDef[];
  onChange: (fields: FieldDef[]) => void;
  types?: readonly FieldType[];
  allowSafety?: boolean;
  allIds: string[];
  idPrefix?: string;
}) {
  const t = useT();
  const [newType, setNewType] = React.useState<FieldType>((types ?? FIELD_TYPES)[0]);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    const next = fields.slice();
    [next[i], next[j]] = [next[j], next[i]];
    // A condition may only point at an earlier field: drop the ones that no longer do.
    const seen = new Set(before.map((f) => f.id));
    onChange(next.map((f) => {
      const ok = !f.showIf || seen.has(f.showIf.field);
      seen.add(f.id);
      return ok ? f : { ...f, showIf: null };
    }));
  };
  return (
    <div className="space-y-3">
      {fields.map((f, i) => (
        <FieldEditor key={f.id} field={f} prior={[...before, ...fields.slice(0, i)]} types={types} allowSafety={allowSafety}
          onChange={(nf) => onChange(fields.map((x, j) => (j === i ? nf : x)))}
          onRemove={() => onChange(fields.filter((_, j) => j !== i).map((x) => (x.showIf?.field === f.id ? { ...x, showIf: null } : x)))}
          onMove={(d) => move(i, d)} />
      ))}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor={`${idPrefix}-new-type`}>{t("forms.builder.newFieldType")}</Label>
          <Select id={`${idPrefix}-new-type`} value={newType} onChange={(e) => setNewType(e.target.value as FieldType)}>
            {(types ?? FIELD_TYPES).map((ty) => <option key={ty} value={ty}>{t.dynamic(`forms.fieldTypes.${ty}`)}</option>)}
          </Select>
        </div>
        <Button type="button" variant="secondary" onClick={() => onChange([...fields, blankField(newType, allIds)])}>
          <Plus className="h-4 w-4" /> {t("forms.builder.addField")}
        </Button>
      </div>
    </div>
  );
}
