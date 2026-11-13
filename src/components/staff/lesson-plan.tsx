"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Trash2, Upload, X } from "lucide-react";
import { Badge, Button, FieldHint, Input, Label, Textarea } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { deleteLessonPlan, removeLessonPlanAttachment, saveLessonPlan, uploadLessonPlanAttachment } from "@/lib/actions/lesson-plans";
import type { Drill, LessonPlanView } from "@/lib/staff/data";

type DrillDraft = { name: string; minutes: string; description: string };

/** Lesson plan editor for a programme session / team event (coach or admin). */
export function LessonPlanForm({
  kind, itemId, plan, attachmentUrl, afterDeleteHref,
}: { kind: "session" | "event"; itemId: string; plan: LessonPlanView | null; attachmentUrl: string | null; afterDeleteHref: string }) {
  const t = useT();
  const router = useRouter();
  const [title, setTitle] = React.useState(plan?.title ?? "");
  const [objectives, setObjectives] = React.useState(plan?.objectives ?? "");
  const [notes, setNotes] = React.useState(plan?.notes ?? "");
  const [shared, setShared] = React.useState(plan?.sharedWithParents ?? false);
  const [drills, setDrills] = React.useState<DrillDraft[]>(
    (plan?.drills ?? []).map((d) => ({ name: d.name, minutes: d.minutes === null ? "" : String(d.minutes), description: d.description ?? "" })),
  );
  const [busy, setBusy] = React.useState<null | "save" | "delete" | "upload" | "remove">(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const setDrill = (i: number, k: keyof DrillDraft, v: string) => setDrills((ds) => ds.map((d, j) => (j === i ? { ...d, [k]: v } : d)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setMsg(null);
    const res = await saveLessonPlan({
      kind, itemId, title, objectives, notes, sharedWithParents: shared,
      drills: drills.filter((d) => d.name.trim()).map((d) => ({ name: d.name, minutes: d.minutes === "" ? null : Number(d.minutes), description: d.description })),
    });
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  async function remove() {
    if (!plan || !window.confirm(t("staff.lessonPlans.confirmDelete"))) return;
    setBusy("delete");
    const res = await deleteLessonPlan(plan.id);
    setBusy(null);
    if (res.ok) {
      router.push(afterDeleteHref);
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }
  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !plan) return;
    const fd = new FormData();
    fd.set("planId", plan.id);
    fd.set("file", file);
    setBusy("upload");
    const res = await uploadLessonPlanAttachment(fd);
    setBusy(null);
    if (fileRef.current) fileRef.current.value = "";
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  async function removeFile() {
    if (!plan) return;
    setBusy("remove");
    const res = await removeLessonPlanAttachment(plan.id);
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div>
        <Label htmlFor="lp-title">{t("staff.lessonPlans.titleField")}</Label>
        <Input id="lp-title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="lp-obj">{t("staff.lessonPlans.objectives")}</Label>
        <Textarea id="lp-obj" maxLength={4000} value={objectives} onChange={(e) => setObjectives(e.target.value)} />
      </div>
      <div className="space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("staff.lessonPlans.drills")}</div>
        {drills.map((d, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-border-soft p-3 sm:grid-cols-[1fr_6rem_auto]">
            <div>
              <Label htmlFor={`lp-d-${i}`}>{t("staff.lessonPlans.drillName")}</Label>
              <Input id={`lp-d-${i}`} maxLength={160} value={d.name} onChange={(e) => setDrill(i, "name", e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`lp-m-${i}`}>{t("staff.lessonPlans.drillMinutes")}</Label>
              <Input id={`lp-m-${i}`} type="number" min={0} max={600} value={d.minutes} onChange={(e) => setDrill(i, "minutes", e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button type="button" size="icon" variant="ghost" aria-label={t("staff.lessonPlans.removeDrill")} onClick={() => setDrills(drills.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="sm:col-span-3">
              <Label htmlFor={`lp-dd-${i}`}>{t("staff.lessonPlans.drillDescription")}</Label>
              <Textarea id={`lp-dd-${i}`} className="min-h-[60px]" maxLength={1000} value={d.description} onChange={(e) => setDrill(i, "description", e.target.value)} />
            </div>
          </div>
        ))}
        {drills.length < 50 && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setDrills([...drills, { name: "", minutes: "", description: "" }])}>
            <Plus className="h-4 w-4" /> {t("staff.lessonPlans.addDrill")}
          </Button>
        )}
      </div>
      <div>
        <Label htmlFor="lp-notes">{t("staff.lessonPlans.notes")}</Label>
        <Textarea id="lp-notes" maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <label className="flex items-start gap-2 text-sm text-text">
        <input type="checkbox" className="mt-1" checked={shared} onChange={(e) => setShared(e.target.checked)} />
        <span>
          {t("staff.lessonPlans.share")}
          <span className="block text-xs text-text-muted">{t("staff.lessonPlans.shareHint")}</span>
        </span>
      </label>

      <div className="space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("staff.lessonPlans.attachment")}</div>
        {plan ? (
          <div className="flex flex-wrap items-center gap-2">
            {plan.attachmentPath && attachmentUrl && (
              <a href={attachmentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-primary hover:underline">
                <FileText className="h-4 w-4" /> {plan.attachmentName ?? t("staff.lessonPlans.download")}
              </a>
            )}
            <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" id="lp-file" onChange={upload} />
            <Button type="button" size="sm" variant="secondary" loading={busy === "upload"} disabled={!!busy} onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" /> {t("staff.lessonPlans.upload")}
            </Button>
            {plan.attachmentPath && (
              <Button type="button" size="sm" variant="ghost" loading={busy === "remove"} disabled={!!busy} onClick={removeFile}>
                {t("staff.lessonPlans.removeAttachment")}
              </Button>
            )}
          </div>
        ) : null}
        <FieldHint>{plan ? t("staff.lessonPlans.attachmentHint") : t("staff.lessonPlans.attachmentAfterSave")}</FieldHint>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy === "save"} disabled={!!busy}>{t("staff.lessonPlans.save")}</Button>
        {plan && (
          <Button type="button" variant="danger" loading={busy === "delete"} disabled={!!busy} onClick={remove}>
            <Trash2 className="h-4 w-4" /> {t("staff.lessonPlans.delete")}
          </Button>
        )}
      </div>
      {msg && msg.text && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </form>
  );
}

/** Read-only plan (parents, other readers). */
export function LessonPlanReadOnly({ plan, attachmentUrl }: { plan: Pick<LessonPlanView, "title" | "objectives" | "notes" | "attachmentName" | "sharedWithParents"> & { drills: Drill[] }; attachmentUrl: string | null }) {
  const t = useT();
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-text">{plan.title || t("staff.lessonPlans.sharedPlan")}</span>
        {plan.sharedWithParents && <Badge tone="info">{t("staff.lessonPlans.shared")}</Badge>}
      </div>
      {plan.objectives && (
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t("staff.lessonPlans.objectives")}</div>
          <p className="whitespace-pre-wrap text-text">{plan.objectives}</p>
        </div>
      )}
      {plan.drills.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t("staff.lessonPlans.drills")}</div>
          <ol className="list-decimal space-y-1 pl-5 text-text">
            {plan.drills.map((d, i) => (
              <li key={i}>
                <span className="font-medium">{d.name}</span>
                {d.minutes !== null && <span className="text-text-muted"> · {t("staff.lessonPlans.minutes", { count: d.minutes })}</span>}
                {d.description && <div className="whitespace-pre-wrap text-text-muted">{d.description}</div>}
              </li>
            ))}
          </ol>
        </div>
      )}
      {plan.notes && (
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t("staff.lessonPlans.notes")}</div>
          <p className="whitespace-pre-wrap text-text">{plan.notes}</p>
        </div>
      )}
      {attachmentUrl && (
        <a href={attachmentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-primary hover:underline">
          <FileText className="h-4 w-4" /> {plan.attachmentName ?? t("staff.lessonPlans.download")}
        </a>
      )}
    </div>
  );
}
