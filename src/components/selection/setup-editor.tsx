"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Select } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { assignCoach, deletePackage, removeCoach, savePackage, saveSelectionSettings } from "@/lib/actions/selection";
import { formatCounts } from "@/lib/selection/rules";
import { Field, Notice, PackageSummary } from "./shared";

export type SetupDivision = {
  id: string; name: string; minBirthYear: number | null; maxBirthYear: number | null; ageUnder: number | null; ageCutoff: string | null;
  teamId: string | null; capacity: number | null; sort: number; isActive: boolean;
};
export type SetupPackage = { id: string; name: string; description: string | null; price: number; allowedCounts: number[]; showMonthly: boolean; sort: number; isActive: boolean };
export type SetupCoach = { id: string; coachId: string; coachName: string; divisionId: string | null; role: "head" | "assistant" };

type Msg = { tone: "ok" | "err"; text: string } | null;

export function useRun() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<Msg>(null);
  const run = async (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) => {
    setBusy(true); setMsg(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) { setMsg({ tone: "err", text: res.error ?? "" }); return false; }
    setMsg({ tone: "ok", text: res.message ?? "" });
    after?.();
    router.refresh();
    return true;
  };
  return { busy, msg, run };
}

// ---------------------------------------------------------------------------
export function SelectionSettings({ programId, selectionEnabled, requiresApproval, allowNonMembers }: {
  programId: string; selectionEnabled: boolean; requiresApproval: boolean; allowNonMembers: boolean;
}) {
  const t = useT();
  const [v, setV] = React.useState({ selectionEnabled, requiresApproval, allowNonMembers });
  const { busy, msg, run } = useRun();
  const box = (k: keyof typeof v, label: string, hint: string) => (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" className="mt-1" checked={v[k]} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.checked }))} />
      <span><span className="text-text">{label}</span><span className="block text-xs text-text-muted">{hint}</span></span>
    </label>
  );
  return (
    <Card>
      <CardHeader><CardTitle>{t("selection.setup.settingsTitle")}</CardTitle></CardHeader>
      <CardBody className="space-y-3">
        {box("selectionEnabled", t("selection.setup.enabled"), t("selection.setup.enabledHint"))}
        {box("requiresApproval", t("selection.setup.requiresApproval"), t("selection.setup.requiresApprovalHint"))}
        {box("allowNonMembers", t("selection.setup.allowNonMembers"), t("selection.setup.allowNonMembersHint"))}
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={busy} onClick={() => run(() => saveSelectionSettings(programId, v))}>{t("common.save")}</Button>
          <Notice msg={msg} />
        </div>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
type PkgForm = { name: string; description: string; price: string; counts: string; showMonthly: boolean; sort: string; isActive: boolean };
const emptyPkg: PkgForm = { name: "", description: "", price: "", counts: "1", showMonthly: true, sort: "0", isActive: true };

export function PackagesEditor({ programId, packages, currency }: { programId: string; packages: SetupPackage[]; currency: string }) {
  const t = useT();
  const f = useFormat();
  const [editing, setEditing] = React.useState<string | "new" | null>(null);
  const [form, setForm] = React.useState<PkgForm>(emptyPkg);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { busy, msg, run } = useRun();
  const set = (k: keyof PkgForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((x) => ({ ...x, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  function open(p?: SetupPackage) {
    setErrors({});
    setEditing(p?.id ?? "new");
    setForm(p ? { name: p.name, description: p.description ?? "", price: String(p.price), counts: formatCounts(p.allowedCounts), showMonthly: p.showMonthly, sort: String(p.sort), isActive: p.isActive }
      : { ...emptyPkg, sort: String(packages.length + 1) });
  }
  async function save() {
    const res = await savePackage(programId, editing === "new" ? null : editing, form);
    if (!res.ok) setErrors(("errors" in res && res.errors) || {});
    await run(async () => res, () => setEditing(null));
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{t("selection.packages.title")}</CardTitle>
        <Button size="sm" variant="secondary" onClick={() => open()}><Plus className="h-4 w-4" /> {t("selection.packages.add")}</Button>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-xs text-text-muted">{t("selection.packages.rulesHint")}</p>
        {packages.length === 0 && <p className="text-sm text-text-muted">{t("selection.packages.empty")}</p>}
        <ul className="divide-y divide-border">
          {packages.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div>
                <span className="font-medium text-text">{p.name}</span> <span className="tnum text-text">{f.money(p.price, currency)}</span>{" "}
                {!p.isActive && <Badge>{t("selection.common.inactive")}</Badge>}
                <PackageSummary pkg={p} currency={currency} />
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" aria-label={t("common.edit")} onClick={() => open(p)}><Pencil className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" aria-label={t("common.delete")} disabled={busy}
                  onClick={() => window.confirm(t("selection.packages.confirmDelete")) && run(() => deletePackage(programId, p.id))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
        {editing && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("selection.packages.name")} htmlFor="pkg-name" error={errors.name}><Input id="pkg-name" value={form.name} onChange={set("name")} /></Field>
              <Field label={t("selection.packages.price", { currency })} htmlFor="pkg-price" error={errors.price}><Input id="pkg-price" inputMode="decimal" value={form.price} onChange={set("price")} /></Field>
              <Field label={t("selection.packages.counts")} htmlFor="pkg-counts" error={errors.counts} hint={t("selection.packages.countsHint")}><Input id="pkg-counts" value={form.counts} onChange={set("counts")} placeholder="1-10" /></Field>
              <div className="sm:col-span-2">
                <Field label={t("selection.packages.description")} htmlFor="pkg-desc" error={errors.description}><Input id="pkg-desc" value={form.description} onChange={set("description")} /></Field>
              </div>
              <Field label={t("selection.common.sort")} htmlFor="pkg-sort"><Input id="pkg-sort" inputMode="numeric" value={form.sort} onChange={set("sort")} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.showMonthly} onChange={set("showMonthly")} /> {t("selection.packages.showMonthly")}</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={set("isActive")} /> {t("selection.common.active")}</label>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={save}>{t("common.save")}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}><X className="h-4 w-4" /> {t("common.cancel")}</Button>
            </div>
          </div>
        )}
        <Notice msg={msg} />
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
export function CoachesEditor({ programId, assigned, coaches, divisions }: {
  programId: string; assigned: SetupCoach[]; coaches: { id: string; name: string }[]; divisions: { id: string; name: string }[];
}) {
  const t = useT();
  const [form, setForm] = React.useState({ coachId: "", divisionId: "", role: "assistant" as "head" | "assistant" });
  const { busy, msg, run } = useRun();
  const divName = new Map(divisions.map((d) => [d.id, d.name]));
  return (
    <Card>
      <CardHeader><CardTitle>{t("selection.coaches.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-3">
        <p className="text-xs text-text-muted">{t("selection.coaches.hint")}</p>
        {assigned.length === 0 && <p className="text-sm text-text-muted">{t("selection.coaches.empty")}</p>}
        <ul className="divide-y divide-border">
          {assigned.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>
                <span className="font-medium text-text">{c.coachName}</span>{" "}
                <Badge tone={c.role === "head" ? "brand" : "neutral"}>{t(`selection.coaches.roles.${c.role}`)}</Badge>{" "}
                <span className="text-xs text-text-muted">{c.divisionId ? divName.get(c.divisionId) ?? "—" : t("selection.coaches.allDivisions")}</span>
              </span>
              <Button size="sm" variant="ghost" aria-label={t("common.delete")} disabled={busy} onClick={() => run(() => removeCoach(programId, c.id))}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-4">
          <Select aria-label={t("selection.coaches.coach")} value={form.coachId} onChange={(e) => setForm((f) => ({ ...f, coachId: e.target.value }))}>
            <option value="">{t("selection.coaches.pick")}</option>
            {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select aria-label={t("selection.coaches.division")} value={form.divisionId} onChange={(e) => setForm((f) => ({ ...f, divisionId: e.target.value }))}>
            <option value="">{t("selection.coaches.allDivisions")}</option>
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select aria-label={t("selection.coaches.role")} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as "head" | "assistant" }))}>
            <option value="head">{t("selection.coaches.roles.head")}</option>
            <option value="assistant">{t("selection.coaches.roles.assistant")}</option>
          </Select>
          <Button size="sm" disabled={busy || !form.coachId} onClick={() => run(() => assignCoach(programId, form), () => setForm((f) => ({ ...f, coachId: "" })))}>
            <Plus className="h-4 w-4" /> {t("selection.coaches.assign")}
          </Button>
        </div>
        <Notice msg={msg} />
      </CardBody>
    </Card>
  );
}
