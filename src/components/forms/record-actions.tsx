"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Ban, FilePen, RefreshCw } from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { voidSubmission } from "@/lib/actions/forms";
import { issueContract, reissueContract, signContract, voidContract } from "@/lib/actions/contracts";
import { useFormsAction } from "./use-action";

/** Reason prompt + confirm for an irreversible action (void / reissue). */
function ReasonAction({ label, icon, confirm, onRun, variant = "danger" }: {
  label: string; icon: React.ReactNode; confirm: string; onRun: (reason: string) => Promise<{ ok: boolean; error?: string; message?: string }>; variant?: "danger" | "secondary";
}) {
  const t = useT();
  const { err, busy, run } = useFormsAction();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  if (!open) return <Button size="sm" variant={variant} onClick={() => setOpen(true)}>{icon} {label}</Button>;
  return (
    <form className="w-full space-y-2 rounded border border-line p-3" onSubmit={(e) => { e.preventDefault(); if (window.confirm(confirm)) run(() => onRun(reason), () => setOpen(false)); }}>
      <Label htmlFor={`reason-${label}`}>{t("forms.view.reason")}</Label>
      <Input id={`reason-${label}`} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={500} />
      {err && <p className="text-xs text-danger">{err}</p>}
      <div className="flex gap-2">
        <Button size="sm" type="submit" variant={variant} disabled={busy}>{label}</Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}

export function VoidSubmissionButton({ id }: { id: string }) {
  const t = useT();
  return <ReasonAction label={t("forms.view.void")} icon={<Ban className="h-3.5 w-3.5" />} confirm={t("forms.view.voidConfirm")} onRun={(r) => voidSubmission(id, r)} />;
}

export function ContractAdminActions({ id, status }: { id: string; status: string }) {
  const t = useT();
  const router = useRouter();
  if (status === "void") return null;
  return (
    <div className="flex flex-wrap gap-2">
      <ReasonAction label={t("forms.contracts.void")} icon={<Ban className="h-3.5 w-3.5" />} confirm={t("forms.contracts.voidConfirm")} onRun={(r) => voidContract(id, r)} />
      <ReasonAction label={t("forms.contracts.reissue")} variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} confirm={t("forms.contracts.reissueConfirm")}
        onRun={async (r) => {
          const res = await reissueContract(id, r);
          if (res.ok && res.data) router.push(`/admin/contracts/${res.data.id}`);
          return res;
        }} />
    </div>
  );
}

/** Admin: issue a contract for a registration from a published template. */
export function IssueContractForm({ registrationId, templates }: { registrationId: string; templates: { id: string; name: string; version: number }[] }) {
  const t = useT();
  const { err, msg, busy, run } = useFormsAction();
  const [templateId, setTemplateId] = React.useState(templates[0]?.id ?? "");
  if (!templates.length) return <p className="text-sm text-ink-3">{t("forms.contracts.noPublishedTemplates")}</p>;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor="ic-tpl">{t("forms.contracts.template")}</Label>
        <Select id="ic-tpl" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          {templates.map((x) => <option key={x.id} value={x.id}>{t("forms.contracts.templateVersion", { name: x.name, version: x.version })}</option>)}
        </Select>
      </div>
      <Button size="sm" disabled={busy || !templateId} onClick={() => run(() => issueContract({ templateId, registrationId }))}><FilePen className="h-3.5 w-3.5" /> {t("forms.contracts.issue")}</Button>
      {err && <span className="text-xs text-danger">{err}</span>}
      {msg && !err && <span className="text-xs text-success">{msg}</span>}
    </div>
  );
}

/** Parent: review and accept with a typed name. */
export function ContractSignForm({ id, defaultName }: { id: string; defaultName: string }) {
  const t = useT();
  const { err, msg, busy, run } = useFormsAction();
  const [name, setName] = React.useState(defaultName);
  const [accept, setAccept] = React.useState(false);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => signContract({ contractId: id, signerName: name, accept: accept as true })); }}>
      <label className="flex items-start gap-3 text-sm text-ink">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--brand-primary)]" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
        <span>{t("forms.contracts.acceptLabel")}</span>
      </label>
      <div>
        <Label htmlFor="cs-name">{t("forms.contracts.typedName")}</Label>
        <Input id="cs-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} maxLength={160} />
        <p className="mt-1 text-xs text-ink-3">{t("forms.contracts.signHint")}</p>
      </div>
      {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      {msg && !err && <p className="text-sm text-success" role="status">{msg}</p>}
      <Button type="submit" disabled={busy || !accept || name.trim().length < 2}><FilePen className="h-4 w-4" /> {busy ? t("forms.contracts.signing") : t("forms.contracts.sign")}</Button>
    </form>
  );
}
