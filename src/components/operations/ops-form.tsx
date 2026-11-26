"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, FieldHint, Input, Label, Select, Textarea } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Generic form for the operations server actions. Field labels arrive
 * already translated from the server page; the action validates with zod,
 * takes the org from the session and returns a translated message. Court
 * conflicts come back as a list the admin can review and override.
 */
export type OpsField = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "time" | "datetime-local" | "email" | "url" | "textarea" | "select" | "checkbox" | "hidden";
  options?: { value: string; label: string }[];
  defaultValue?: string | number | boolean | null;
  required?: boolean;
  hint?: string;
  step?: string;
  min?: string | number;
  max?: string | number;
  placeholder?: string;
  wide?: boolean;
  rows?: number;
};

export type OpsConflict = { kind: string; id: string; label: string; start: string | null; end: string | null };
export type OpsActionResult = { ok: true; message?: string; data?: unknown } | { ok: false; error: string; conflicts?: OpsConflict[] };

export function OpsForm({
  fields,
  action,
  submitLabel,
  redirectTo,
  reset = false,
  columns = 2,
  className,
}: {
  fields: OpsField[];
  action: (values: Record<string, unknown>, force?: boolean) => Promise<OpsActionResult>;
  submitLabel: string;
  /** Path to open after success; "{id}" is replaced with data.id. */
  redirectTo?: string;
  reset?: boolean;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [pending, start] = React.useTransition();
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [conflicts, setConflicts] = React.useState<OpsConflict[] | null>(null);
  const [lastValues, setLastValues] = React.useState<Record<string, unknown> | null>(null);

  function collect(form: HTMLFormElement): Record<string, unknown> {
    const fd = new FormData(form);
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      out[field.name] = field.type === "checkbox" ? fd.get(field.name) === "on" : fd.get(field.name) ?? "";
    }
    return out;
  }

  function run(values: Record<string, unknown>, force: boolean) {
    setMsg(null);
    start(async () => {
      const res = await action(values, force);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error });
        setConflicts(res.conflicts?.length ? res.conflicts : null);
        setLastValues(values);
        return;
      }
      setConflicts(null);
      setMsg({ ok: true, text: res.message ?? t("common.saved") });
      if (reset) formRef.current?.reset();
      const id = (res.data as { id?: string } | undefined)?.id;
      if (redirectTo) router.push(redirectTo.replace("{id}", id ?? ""));
      else router.refresh();
    });
  }

  const grid = columns === 1 ? "sm:grid-cols-1" : columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <form
      ref={formRef}
      className={cn("space-y-4", className)}
      onSubmit={(e) => {
        e.preventDefault();
        run(collect(e.currentTarget), false);
      }}
    >
      <div className={cn("grid grid-cols-1 gap-3", grid)}>
        {fields.map((field) => {
          const id = `ops-${field.name}`;
          const dv = field.defaultValue;
          if (field.type === "hidden") return <input key={field.name} type="hidden" name={field.name} defaultValue={dv == null ? "" : String(dv)} />;
          if (field.type === "checkbox") {
            return (
              <label key={field.name} className={cn("flex items-center gap-2 text-sm text-text", field.wide && "sm:col-span-full")}>
                <input type="checkbox" name={field.name} defaultChecked={Boolean(dv)} className="h-4 w-4 accent-brand-primary" />
                {field.label}
              </label>
            );
          }
          return (
            <div key={field.name} className={cn(field.wide || field.type === "textarea" ? "sm:col-span-full" : undefined)}>
              <Label htmlFor={id}>{field.label}</Label>
              {field.type === "select" ? (
                <Select id={id} name={field.name} defaultValue={dv == null ? "" : String(dv)} required={field.required}>
                  {(field.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              ) : field.type === "textarea" ? (
                <Textarea id={id} name={field.name} defaultValue={dv == null ? "" : String(dv)} required={field.required} rows={field.rows ?? 4} placeholder={field.placeholder} />
              ) : (
                <Input
                  id={id}
                  name={field.name}
                  type={field.type ?? "text"}
                  defaultValue={dv == null ? "" : String(dv)}
                  required={field.required}
                  step={field.step}
                  min={field.min}
                  max={field.max}
                  placeholder={field.placeholder}
                />
              )}
              {field.hint && <FieldHint>{field.hint}</FieldHint>}
            </div>
          );
        })}
      </div>
      {conflicts && (
        <div role="alert" className="rounded border border-warning/40 bg-warning-soft p-3 text-sm">
          <p className="font-medium text-warning">{t("operations.conflicts.title")}</p>
          <ul className="mt-2 space-y-1 text-text-secondary">
            {conflicts.map((c) => (
              <li key={`${c.kind}:${c.id}:${c.start ?? ""}`}>
                {t.dynamic(`operations.conflicts.kinds.${c.kind}`, undefined, c.kind)} · {c.label}
                {c.start && c.end ? ` · ${f.dateRange(c.start, c.end, "short")}` : ""}
              </li>
            ))}
          </ul>
          <Button type="button" variant="secondary" size="sm" className="mt-3" disabled={pending} onClick={() => lastValues && run(lastValues, true)}>
            {t("operations.conflicts.saveAnyway")}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? t("common.saving") : submitLabel}</Button>
        {msg && (
          <p role={msg.ok ? "status" : "alert"} className={cn("text-sm", msg.ok ? "text-success" : "text-danger")}>{msg.text}</p>
        )}
      </div>
    </form>
  );
}

/** One-click action (status change, invoice, delete …) with optional confirm. */
export function OpsButton({
  action,
  label,
  variant = "secondary",
  confirm,
  redirectTo,
}: {
  action: () => Promise<OpsActionResult>;
  label: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  confirm?: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant={variant}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setErr(null);
          start(async () => {
            const res = await action();
            if (!res.ok) setErr(res.error);
            else if (redirectTo) router.push(redirectTo.replace("{id}", (res.data as { id?: string; invoiceId?: string } | undefined)?.id ?? ""));
            else router.refresh();
          });
        }}
      >
        {label}
      </Button>
      {err && <span role="alert" className="text-xs text-danger">{err}</span>}
    </span>
  );
}
