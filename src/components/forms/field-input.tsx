"use client";

import * as React from "react";
import { Paperclip } from "lucide-react";
import { Input, Label, Select, Textarea } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import type { FieldDef } from "@/lib/forms/schema";
import { SignaturePad } from "./signature-pad";

/**
 * One form-builder field as an input. Labels / help / options are the club's
 * own content. Signature fields keep the typed name in `value.name` and the
 * drawn PNG in `signature` (uploaded by the server on submit); file fields
 * call `onUpload` and keep the returned storage key.
 */
export type FieldValue = unknown;

export function FieldInput({
  field, value, onChange, error, idPrefix, signature, onSignature, onUpload,
}: {
  field: FieldDef;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
  error?: string;
  idPrefix: string;
  signature?: string | null;
  onSignature?: (dataUrl: string | null) => void;
  onUpload?: (file: File) => Promise<{ path: string; name: string; mime: string } | { error: string }>;
}) {
  const t = useT();
  const id = `${idPrefix}-${field.id}`;
  const [uploading, setUploading] = React.useState(false);
  const [uploadErr, setUploadErr] = React.useState<string | null>(null);
  const req = field.required ? <span className="text-danger"> *</span> : null;
  const help = field.help ? <p className="mt-1 whitespace-pre-wrap text-xs text-ink-3">{field.help}</p> : null;
  const err = error || uploadErr ? <p className="mt-1 text-xs text-danger">{error || uploadErr}</p> : null;
  const str = typeof value === "string" || typeof value === "number" ? String(value) : "";

  if (field.type === "info") {
    return (
      <div className="rounded-md border border-line bg-surface-elevated/40 px-4 py-3">
        <div className="text-sm font-medium text-ink">{field.label}</div>
        {field.help && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{field.help}</p>}
      </div>
    );
  }

  if (field.type === "consent") {
    return (
      <div>
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-surface-elevated/40 px-4 py-3">
          <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--brand-primary)]" />
          <span className="text-sm text-ink">{field.label}{req}{help}</span>
        </label>
        {err}
      </div>
    );
  }

  let control: React.ReactNode;
  switch (field.type) {
    case "long_text":
      control = <Textarea id={id} value={str} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} />;
      break;
    case "number":
      control = <Input id={id} type="number" inputMode="decimal" value={str} min={field.min ?? undefined} max={field.max ?? undefined} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} />;
      break;
    case "date":
      control = <Input id={id} type="date" value={str} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} />;
      break;
    case "single_choice":
      control = (
        <Select id={id} value={str} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error}>
          <option value="">{t("common.select")}</option>
          {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      );
      break;
    case "multi_choice": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      control = (
        <div className="space-y-1.5">
          {field.options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" className="h-4 w-4 accent-[var(--brand-primary)]" checked={arr.includes(o.value)}
                onChange={(e) => onChange(e.target.checked ? [...arr, o.value] : arr.filter((x) => x !== o.value))} />
              {o.label}
            </label>
          ))}
        </div>
      );
      break;
    }
    case "yes_no":
      control = (
        <div className="flex gap-4" role="radiogroup" aria-labelledby={`${id}-label`}>
          {(["yes", "no"] as const).map((v) => (
            <label key={v} className="flex items-center gap-2 text-sm text-ink">
              <input type="radio" name={id} value={v} checked={value === v} onChange={() => onChange(v)} className="h-4 w-4 accent-[var(--brand-primary)]" />
              {t(v === "yes" ? "common.yes" : "common.no")}
            </label>
          ))}
        </div>
      );
      break;
    case "signature": {
      const v = (value ?? {}) as { name?: string };
      control = (
        <div className="space-y-2">
          <Input id={id} placeholder={t("forms.fill.typedName")} value={v.name ?? ""} onChange={(e) => onChange({ ...v, name: e.target.value })} aria-invalid={!!error} autoComplete="name" />
          <SignaturePad value={signature ?? null} onChange={(d) => onSignature?.(d)} label={field.label} />
        </div>
      );
      break;
    }
    case "file": {
      const v = value as { name?: string } | null;
      control = (
        <div className="space-y-1">
          <input id={id} type="file" accept="application/pdf,image/png,image/jpeg,image/webp,image/heic" disabled={uploading || !onUpload}
            className="block w-full text-sm text-ink-2 file:mr-3 file:rounded file:border file:border-line file:bg-surface-elevated file:px-3 file:py-2 file:text-ink"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file || !onUpload) return;
              setUploading(true);
              setUploadErr(null);
              const r = await onUpload(file);
              setUploading(false);
              if ("error" in r) setUploadErr(r.error);
              else onChange(r);
            }} />
          {uploading && <p className="text-xs text-ink-3">{t("forms.fill.uploading")}</p>}
          {v?.name && <p className="flex items-center gap-1 text-xs text-ink-2"><Paperclip className="h-3 w-3" /> {v.name}</p>}
        </div>
      );
      break;
    }
    default:
      control = <Input id={id} value={str} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} />;
  }

  return (
    <div>
      <Label htmlFor={id} id={`${id}-label`} className="normal-case tracking-normal text-sm text-ink">{field.label}{req}</Label>
      {control}
      {help}
      {err}
    </div>
  );
}
