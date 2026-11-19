"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCheck, EyeOff, Undo2, Upload } from "lucide-react";
import { Button, FieldHint, Label, Select } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { confirmBankEntry, confirmReferenceMatches, ignoreBankEntry, importBankFile, reopenBankEntry } from "@/lib/actions/accounting";
import { askReason, useAct } from "./use-act";

/** Upload a camt.053 / camt.054 file from the club's bank. */
export function BankUploadForm() {
  const t = useT();
  const router = useRouter();
  const { busy, run, status } = useAct();
  const ref = React.useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      className="flex flex-wrap items-end gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        void run(() => importBankFile(fd), (r) => { ref.current?.reset(); if (r.ok && r.id) router.push(`/admin/accounting/bank/${r.id}`); });
      }}
    >
      <div className="min-w-64 flex-1">
        <Label htmlFor="bank-file">{t("accounting.bank.fileLabel")}</Label>
        <input id="bank-file" name="file" type="file" accept=".xml,application/xml,text/xml" required
          className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-md file:border-0 file:bg-surface-elevated file:px-3 file:py-2 file:text-sm file:text-ink" />
        <FieldHint>{t("accounting.bank.fileHint")}</FieldHint>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" name="autoBook" defaultChecked className="h-4 w-4 accent-[var(--red-primary)]" />
        {t("accounting.bank.autoBook")}
      </label>
      <Button type="submit" disabled={busy}><Upload className="h-4 w-4" aria-hidden /> {busy ? t("accounting.bank.importing") : t("accounting.bank.import")}</Button>
      {status}
    </form>
  );
}

export function ConfirmAllButton({ importId, count }: { importId: string; count: number }) {
  const t = useT();
  const { busy, run, status } = useAct();
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" disabled={busy} onClick={() => run(() => confirmReferenceMatches(importId))}>
        <CheckCheck className="h-4 w-4" aria-hidden /> {t("accounting.bank.confirmAll", { count })}
      </Button>
      {status}
    </span>
  );
}

export type InvoiceOption = { id: string; label: string };

/** Row actions for one bank entry: confirm the suggestion, assign by hand, ignore, undo. */
export function EntryActions({ id, status, hasInvoice, options }: { id: string; status: string; hasInvoice: boolean; options: InvoiceOption[] }) {
  const t = useT();
  const { busy, run, status: note } = useAct();
  const [pick, setPick] = React.useState("");
  if (status === "booked" || status === "ignored") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
          const reason = askReason(t("accounting.bank.reopenReasonPrompt"));
          if (reason) void run(() => reopenBankEntry(id, reason));
        }}><Undo2 className="h-3.5 w-3.5" aria-hidden /> {t("accounting.bank.reopen")}</Button>
        {note}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {hasInvoice && (
        <Button size="sm" disabled={busy} onClick={() => run(() => confirmBankEntry(id))}>
          <Check className="h-3.5 w-3.5" aria-hidden /> {t("accounting.bank.confirm")}
        </Button>
      )}
      <Select aria-label={t("accounting.bank.assign")} value={pick} onChange={(e) => setPick(e.target.value)} className="h-8 w-52 text-xs">
        <option value="">{t("accounting.bank.assignPlaceholder")}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </Select>
      <Button size="sm" variant="secondary" disabled={busy || !pick} onClick={() => run(() => confirmBankEntry(id, pick))}>{t("accounting.bank.assign")}</Button>
      <Button size="sm" variant="ghost" disabled={busy} aria-label={t("accounting.bank.ignore")} onClick={() => {
        const reason = askReason(t("accounting.bank.ignoreReasonPrompt"));
        if (reason) void run(() => ignoreBankEntry(id, reason));
      }}><EyeOff className="h-3.5 w-3.5" aria-hidden /></Button>
      {note}
    </div>
  );
}

/** Money cell helper for client tables. */
export function Money({ value, currency }: { value: number; currency: string }) {
  const f = useFormat();
  return <span className="tnum">{f.money(value, currency)}</span>;
}
