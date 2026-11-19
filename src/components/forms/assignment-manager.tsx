"use client";

import * as React from "react";
import { Bell, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { deleteAssignment, saveAssignment, sendFormReminders } from "@/lib/actions/forms";
import { ASSIGNMENT_SCOPES, RENEWALS, type AssignmentScope, type Renewal } from "@/lib/forms/schema";
import type { Assignment, Targets } from "@/lib/forms/data";
import { useFormsAction } from "./use-action";

type Draft = { scope: AssignmentScope; targetId: string; renewal: Renewal; renewalMonths: string; dueDate: string; isRequired: boolean };
const blank: Draft = { scope: "all_members", targetId: "", renewal: "yearly", renewalMonths: "", dueDate: "", isRequired: true };

/** Who must complete a form, renewal period and due date. */
export function AssignmentManager({ formId, assignments, targets, published }: { formId: string; assignments: Assignment[]; targets: Targets; published: boolean }) {
  const t = useT();
  const f = useFormat();
  const { err, msg, busy, run } = useFormsAction();
  const [draft, setDraft] = React.useState<Draft>(blank);
  const [editing, setEditing] = React.useState<string | null>(null);
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const options = draft.scope === "program" ? targets.programs : draft.scope === "team" ? targets.teams : draft.scope === "training_service" ? targets.services : [];

  const save = () => run(() => saveAssignment(formId, editing, { ...draft, renewalMonths: draft.renewalMonths === "" ? null : Number(draft.renewalMonths), isActive: true }), () => { setDraft(blank); setEditing(null); });
  const scopeLabel = (a: Assignment) => (a.scope === "all_members" ? t("forms.scopes.all_members") : `${t.dynamic(`forms.scopes.${a.scope}`)} · ${a.targetName ?? "–"}`);
  const renewalLabel = (a: Assignment) => (a.renewal === "months" ? t("forms.assign.everyMonths", { count: a.renewalMonths ?? 0 }) : t.dynamic(`forms.renewals.${a.renewal}`));

  return (
    <div className="space-y-4">
      {!published && <p className="text-xs text-warning">{t("forms.assign.publishFirst")}</p>}
      {assignments.length > 0 && (
        <ul className="divide-y divide-line rounded border border-line text-sm">
          {assignments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                <div className="font-medium text-ink">{scopeLabel(a)}</div>
                <div className="text-xs text-ink-3">
                  {renewalLabel(a)}{a.dueDate ? ` · ${t("forms.assign.dueOn", { date: f.date(a.dueDate) })}` : ""}{a.isRequired ? "" : ` · ${t("forms.assign.optional")}`}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => { setEditing(a.id); setDraft({ scope: a.scope, targetId: a.programId ?? a.teamId ?? a.trainingServiceId ?? "", renewal: a.renewal, renewalMonths: a.renewalMonths?.toString() ?? "", dueDate: a.dueDate ?? "", isRequired: a.isRequired }); }}>{t("common.edit")}</Button>
                <Button size="sm" variant="ghost" aria-label={t("common.delete")} onClick={() => window.confirm(t("forms.assign.deleteConfirm")) && run(() => deleteAssignment(a.id))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 rounded-md border border-line p-3">
        <div className="text-sm font-medium text-ink">{editing ? t("forms.assign.editTitle") : t("forms.assign.addTitle")}</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="as-scope">{t("forms.assign.scope")}</Label>
            <Select id="as-scope" value={draft.scope} onChange={(e) => set({ scope: e.target.value as AssignmentScope, targetId: "" })}>
              {ASSIGNMENT_SCOPES.map((s) => <option key={s} value={s}>{t.dynamic(`forms.scopes.${s}`)}</option>)}
            </Select>
          </div>
          {draft.scope !== "all_members" && (
            <div>
              <Label htmlFor="as-target">{t("forms.assign.target")}</Label>
              <Select id="as-target" value={draft.targetId} onChange={(e) => set({ targetId: e.target.value })}>
                <option value="">{t("common.select")}</option>
                {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="as-renewal">{t("forms.assign.renewal")}</Label>
            <Select id="as-renewal" value={draft.renewal} onChange={(e) => set({ renewal: e.target.value as Renewal })}>
              {RENEWALS.map((r) => <option key={r} value={r}>{t.dynamic(`forms.renewals.${r}`)}</option>)}
            </Select>
          </div>
          {draft.renewal === "months" && (
            <div><Label htmlFor="as-months">{t("forms.assign.months")}</Label><Input id="as-months" type="number" min={1} max={60} value={draft.renewalMonths} onChange={(e) => set({ renewalMonths: e.target.value })} /></div>
          )}
          <div><Label htmlFor="as-due">{t("forms.assign.dueDate")}</Label><Input id="as-due" type="date" value={draft.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></div>
          <label className="flex items-center gap-2 self-end text-sm text-ink-2"><input type="checkbox" className="h-4 w-4" checked={draft.isRequired} onChange={(e) => set({ isRequired: e.target.checked })} /> {t("forms.assign.required")}</label>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={busy}><Plus className="h-3.5 w-3.5" /> {editing ? t("common.save") : t("forms.assign.add")}</Button>
          {editing && <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setDraft(blank); }}>{t("common.cancel")}</Button>}
        </div>
      </div>
      {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      {msg && !err && <p className="text-sm text-success" role="status">{msg}</p>}
    </div>
  );
}

export function ReminderButton({ formId }: { formId: string | null }) {
  const t = useT();
  const { err, msg, busy, run } = useFormsAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => window.confirm(t("forms.reminder.confirm")) && run(() => sendFormReminders(formId))}>
        <Bell className="h-3.5 w-3.5" /> {busy ? t("forms.reminder.sending") : t("forms.reminder.send")}
      </Button>
      {msg && <Badge tone="success">{msg}</Badge>}
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}
