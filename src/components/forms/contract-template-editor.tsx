"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, Send } from "lucide-react";
import { Badge, Button, Card, CardBody, Input, Label, Select, Textarea } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { archiveContractTemplate, publishContractTemplate, saveContractTemplate } from "@/lib/actions/contracts";
import { ACTIVITY_TYPES, MERGE_FIELDS, renderMerge, unknownMergeFields, type ActivityType, type MergeData } from "@/lib/contracts/merge";
import { useFormsAction } from "./use-action";

/** Template editor with merge-field palette and a live preview on sample data. */
export function ContractTemplateEditor({
  template, programs, sample,
}: {
  template: { id: string; name: string; activityType: ActivityType; programId: string | null; title: string; body: string; autoIssue: boolean; status: string; version: number } | null;
  programs: { id: string; name: string }[];
  sample: MergeData;
}) {
  const t = useT();
  const router = useRouter();
  const { err, msg, busy, run } = useFormsAction();
  const [name, setName] = React.useState(template?.name ?? "");
  const [activityType, setActivityType] = React.useState<ActivityType>(template?.activityType ?? "team_season");
  const [programId, setProgramId] = React.useState(template?.programId ?? "");
  const [title, setTitle] = React.useState(template?.title ?? "");
  const [body, setBody] = React.useState(template?.body ?? "");
  const [autoIssue, setAutoIssue] = React.useState(template?.autoIssue ?? true);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const unknown = [...unknownMergeFields(title), ...unknownMergeFields(body)];
  const preview = renderMerge(body, sample, "text").output;

  const insert = (field: string) => {
    const el = bodyRef.current;
    const token = `{{${field}}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + token.length; });
  };
  const save = () => run(() => saveContractTemplate(template?.id ?? null, { name, activityType, programId, title, body, autoIssue }), (r) => {
    if (!template && r.ok && "data" in r && r.data) router.push(`/admin/contracts/templates/${r.data.id}`);
  });

  return (
    <div className="space-y-5">
      {template && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={template.status === "published" ? "success" : template.status === "archived" ? "neutral" : "warning"}>{t.dynamic(`forms.status.${template.status}`)}</Badge>
          <Badge tone="neutral">{t("forms.contracts.versionLabel", { version: template.version })}</Badge>
        </div>
      )}
      <Card><CardBody className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><Label htmlFor="ct-name">{t("forms.contracts.templateName")}</Label><Input id="ct-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div>
            <Label htmlFor="ct-act">{t("forms.contracts.activityType")}</Label>
            <Select id="ct-act" value={activityType} onChange={(e) => setActivityType(e.target.value as ActivityType)}>
              {ACTIVITY_TYPES.map((a) => <option key={a} value={a}>{t.dynamic(`forms.activities.${a}`)}</option>)}
            </Select>
          </div>
          {activityType !== "training_package" && (
            <div>
              <Label htmlFor="ct-prog">{t("forms.contracts.programme")}</Label>
              <Select id="ct-prog" value={programId} onChange={(e) => setProgramId(e.target.value)}>
                <option value="">{t("forms.contracts.anyProgramme")}</option>
                {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </div>
          )}
          <label className="flex items-center gap-2 self-end text-sm text-ink-2"><input type="checkbox" className="h-4 w-4" checked={autoIssue} onChange={(e) => setAutoIssue(e.target.checked)} /> {t("forms.contracts.autoIssue")}</label>
        </div>
        <div><Label htmlFor="ct-title">{t("forms.contracts.contractTitle")}</Label><Input id="ct-title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div>
          <Label htmlFor="ct-body">{t("forms.contracts.body")}</Label>
          <Textarea id="ct-body" ref={bodyRef} className="min-h-[320px] font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} />
          <p className="mt-1 text-xs text-ink-3">{t("forms.contracts.bodyHint")}</p>
        </div>
        <div>
          <div className="mb-1 text-xs text-ink-3">{t("forms.contracts.mergeFields")}</div>
          <div className="flex flex-wrap gap-1">
            {MERGE_FIELDS.map((m) => <button key={m} type="button" onClick={() => insert(m)} className="rounded border border-line px-2 py-0.5 font-mono text-[11px] text-ink-2 hover:border-maroon hover:text-ink">{`{{${m}}}`}</button>)}
          </div>
        </div>
        {unknown.length > 0 && <p className="text-xs text-danger">{t("forms.contracts.unknownFields", { fields: unknown.join(", ") })}</p>}
      </CardBody></Card>

      <Card><CardBody className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-ink-3">{t("forms.contracts.preview")}</div>
        <div className="text-base font-semibold text-ink">{renderMerge(title, sample, "text").output}</div>
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{preview}</div>
      </CardBody></Card>

      {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      {msg && !err && <p className="text-sm text-success" role="status">{msg}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy}>{busy ? t("common.saving") : t("common.save")}</Button>
        {template && template.status !== "published" && template.status !== "archived" && (
          <Button variant="accent" disabled={busy} onClick={() => window.confirm(t("forms.contracts.publishConfirm")) && run(() => publishContractTemplate(template.id))}><Send className="h-4 w-4" /> {t("forms.builder.publish")}</Button>
        )}
        {template && template.status !== "archived" && (
          <Button variant="ghost" disabled={busy} onClick={() => run(() => archiveContractTemplate(template.id))}><Archive className="h-4 w-4" /> {t("forms.builder.archive")}</Button>
        )}
      </div>
    </div>
  );
}
