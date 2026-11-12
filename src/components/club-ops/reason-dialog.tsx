"use client";
import * as React from "react";
import { Button, Label } from "@/components/ui";
import { Textarea } from "@/components/teams/fields";
import { useT } from "@/lib/i18n/client";

/**
 * Confirmation dialog that asks for a reason (cancel event/booking, reopen
 * attendance). Optional extra content (e.g. a scope choice) goes in children.
 */
export function ReasonDialog({ open, title, description, confirmLabel, required, pending, error, onConfirm, onClose, children, danger = true }: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  required?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  children?: React.ReactNode;
  danger?: boolean;
}) {
  const t = useT();
  const [reason, setReason] = React.useState("");
  const id = React.useId();
  React.useEffect(() => { if (open) setReason(""); }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !pending) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, onClose]);
  if (!open) return null;
  const blocked = required && !reason.trim();
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={() => !pending && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
        className="w-full max-w-md rounded-t-2xl border border-line bg-surface-card p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 id={`${id}-title`} className="font-semibold text-ink">{title}</h3>
        {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
        <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); if (!blocked) onConfirm(reason.trim()); }}>
          <div>
            <Label htmlFor={`${id}-reason`}>{required ? t("editOps.common.reason") : t("editOps.common.reasonOptional")}</Label>
            <Textarea id={`${id}-reason`} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
          {children}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" variant={danger ? "danger" : "primary"} disabled={pending || blocked}>{pending ? t("common.saving") : confirmLabel}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** "This one / this and following" choice for recurring events. */
export function ScopeChoice({ value, onChange }: { value: "one" | "following"; onChange: (v: "one" | "following") => void }) {
  const t = useT();
  return (
    <fieldset className="space-y-1 text-sm">
      <legend className="mb-1 text-xs text-ink-3">{t("editOps.events.applyTo")}</legend>
      <label className="flex items-center gap-2 text-ink-2"><input type="radio" checked={value === "one"} onChange={() => onChange("one")} className="accent-[var(--red-primary)]" /> {t("editOps.events.scopeOne")}</label>
      <label className="flex items-center gap-2 text-ink-2"><input type="radio" checked={value === "following"} onChange={() => onChange("following")} className="accent-[var(--red-primary)]" /> {t("editOps.events.scopeFollowing")}</label>
    </fieldset>
  );
}
