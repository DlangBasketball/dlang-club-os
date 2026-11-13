"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Input, Label, Select, Textarea } from "@/components/ui";
import { deleteAssessmentTemplate, deleteEvaluation, saveAssessmentTemplate, saveEvaluations, setEvaluationShared } from "@/lib/actions/development";
import { useFormat, useT } from "@/lib/i18n/client";
import { overallScore, type ItemKind } from "@/lib/development/scoring";
import type { AssessmentTemplate } from "@/lib/development/data";
import { useAction } from "./use-action";

type ItemDraft = {
  key: string; id: string | null; kind: ItemKind; label: string; description: string; category: string;
  scaleMin: string; scaleMax: string; unit: string; higherIsBetter: boolean; weight: string;
};
let seq = 0;
const newKey = () => `n${++seq}`;
const blankItem = (kind: ItemKind = "skill"): ItemDraft => ({
  key: newKey(), id: null, kind, label: "", description: "", category: "", scaleMin: "1", scaleMax: "5", unit: kind === "measurement" ? "cm" : "", higherIsBetter: true, weight: "1",
});

/** Assessment builder: template details + skill / measurement / text items. */
export function TemplateEditor({ base, template }: { base: string; template: AssessmentTemplate | null }) {
  const t = useT();
  const router = useRouter();
  const { err, busy, run } = useAction();
  const [name, setName] = React.useState(template?.name ?? "");
  const [description, setDescription] = React.useState(template?.description ?? "");
  const [sport, setSport] = React.useState(template?.sport ?? "");
  const [ageGroup, setAgeGroup] = React.useState(template?.ageGroup ?? "");
  const [ageMin, setAgeMin] = React.useState(template?.ageMin?.toString() ?? "");
  const [ageMax, setAgeMax] = React.useState(template?.ageMax?.toString() ?? "");
  const [isActive, setIsActive] = React.useState(template?.isActive ?? true);
  const [items, setItems] = React.useState<ItemDraft[]>(
    template?.items.length
      ? template.items.map((i) => ({
          key: i.id, id: i.id, kind: i.kind, label: i.label, description: i.description ?? "", category: i.category ?? "",
          scaleMin: String(i.scaleMin), scaleMax: String(i.scaleMax), unit: i.unit ?? "", higherIsBetter: i.higherIsBetter, weight: String(i.weight),
        }))
      : [blankItem("skill")],
  );
  const [saved, setSaved] = React.useState(false);
  const patch = (key: string, p: Partial<ItemDraft>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const move = (i: number, d: -1 | 1) => setItems((xs) => {
    const j = i + d;
    if (j < 0 || j >= xs.length) return xs;
    const next = xs.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  function save() {
    setSaved(false);
    run(() => saveAssessmentTemplate(template?.id ?? null, {
      name, description, sport, ageGroup, ageMin, ageMax, isActive,
      items: items.map((i) => ({
        id: i.id, kind: i.kind, label: i.label, description: i.description, category: i.category, scaleMin: i.scaleMin, scaleMax: i.scaleMax,
        unit: i.unit, higherIsBetter: i.higherIsBetter, weight: i.weight,
      })),
    }), (res) => {
      setSaved(true);
      if (!template && res.ok && res.data) router.push(`${base}/assessments/${res.data.id}`);
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor="tp-name">{t("development.assessments.name")}</Label><Input id="tp-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label htmlFor="tp-sport">{t("development.common.sport")}</Label><Input id="tp-sport" maxLength={60} value={sport} onChange={(e) => setSport(e.target.value)} /></div>
        <div><Label htmlFor="tp-group">{t("development.common.ageGroup")}</Label><Input id="tp-group" maxLength={40} value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)} /></div>
        <div><Label htmlFor="tp-amin">{t("development.common.ageMin")}</Label><Input id="tp-amin" type="number" min={0} max={99} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} /></div>
        <div><Label htmlFor="tp-amax">{t("development.common.ageMax")}</Label><Input id="tp-amax" type="number" min={0} max={99} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor="tp-desc">{t("development.common.description")}</Label><Textarea id="tp-desc" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> {t("development.common.active")}</label>
      </div>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-4">{t("development.assessments.items")}</h3>
        {items.map((it, i) => (
          <div key={it.key} className="space-y-3 rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-40"><Label htmlFor={`k-${it.key}`}>{t("development.assessments.kind")}</Label>
                <Select id={`k-${it.key}`} value={it.kind} onChange={(e) => patch(it.key, { kind: e.target.value as ItemKind })}>
                  <option value="skill">{t("development.itemKinds.skill")}</option>
                  <option value="measurement">{t("development.itemKinds.measurement")}</option>
                  <option value="text">{t("development.itemKinds.text")}</option>
                </Select></div>
              <div className="min-w-[12rem] flex-1"><Label htmlFor={`l-${it.key}`}>{t("development.assessments.label")}</Label><Input id={`l-${it.key}`} maxLength={120} value={it.label} onChange={(e) => patch(it.key, { label: e.target.value })} /></div>
              <div className="w-40"><Label htmlFor={`c-${it.key}`}>{t("development.assessments.category")}</Label><Input id={`c-${it.key}`} maxLength={60} value={it.category} onChange={(e) => patch(it.key, { category: e.target.value })} /></div>
              <div className="flex gap-1">
                <Button type="button" size="icon" variant="ghost" aria-label={t("development.common.moveUp")} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                <Button type="button" size="icon" variant="ghost" aria-label={t("development.common.moveDown")} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                <Button type="button" size="icon" variant="ghost" aria-label={t("development.common.remove")} onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            {it.kind === "skill" && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-24"><Label htmlFor={`mn-${it.key}`}>{t("development.assessments.scaleMin")}</Label><Input id={`mn-${it.key}`} type="number" min={0} max={100} value={it.scaleMin} onChange={(e) => patch(it.key, { scaleMin: e.target.value })} /></div>
                <div className="w-24"><Label htmlFor={`mx-${it.key}`}>{t("development.assessments.scaleMax")}</Label><Input id={`mx-${it.key}`} type="number" min={1} max={100} value={it.scaleMax} onChange={(e) => patch(it.key, { scaleMax: e.target.value })} /></div>
                <div className="w-24"><Label htmlFor={`w-${it.key}`}>{t("development.assessments.weight")}</Label><Input id={`w-${it.key}`} type="number" min={0.1} max={100} step={0.1} value={it.weight} onChange={(e) => patch(it.key, { weight: e.target.value })} /></div>
                <label className="flex items-center gap-2 pb-2 text-sm text-ink"><input type="checkbox" checked={!it.higherIsBetter} onChange={(e) => patch(it.key, { higherIsBetter: !e.target.checked })} /> {t("development.assessments.lowerIsBetter")}</label>
              </div>
            )}
            {it.kind === "measurement" && (
              <div className="w-32"><Label htmlFor={`u-${it.key}`}>{t("development.assessments.unit")}</Label><Input id={`u-${it.key}`} maxLength={20} value={it.unit} onChange={(e) => patch(it.key, { unit: e.target.value })} /></div>
            )}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => setItems((xs) => [...xs, blankItem("skill")])}><Plus className="h-4 w-4" /> {t("development.assessments.addSkill")}</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setItems((xs) => [...xs, blankItem("measurement")])}><Plus className="h-4 w-4" /> {t("development.assessments.addMeasurement")}</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setItems((xs) => [...xs, blankItem("text")])}><Plus className="h-4 w-4" /> {t("development.assessments.addText")}</Button>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} loading={busy}>{t("development.common.save")}</Button>
        {template && (
          <Button variant="ghost" disabled={busy} onClick={() => {
            if (window.confirm(t("development.assessments.deleteConfirm"))) run(() => deleteAssessmentTemplate(template.id), () => router.push(`${base}/assessments`));
          }}>{t("development.common.delete")}</Button>
        )}
        {saved && !err && <span role="status" className="text-sm text-success">{t("development.common.saved")}</span>}
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}

type Draft = { comments: string; scores: Record<string, string> };

/** Run an evaluation for one athlete or a whole team (batch). */
export function EvaluationForm({ base, templates, athletes, teams, initialAthleteId, initialTeamId, today }: {
  base: string;
  templates: AssessmentTemplate[];
  athletes: { id: string; name: string }[];
  teams: { id: string; name: string; athleteIds: string[] }[];
  initialAthleteId?: string | null;
  initialTeamId?: string | null;
  today: string;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const { err, busy, run } = useAction();
  const [templateId, setTemplateId] = React.useState(templates[0]?.id ?? "");
  const [mode, setMode] = React.useState<"athlete" | "team">(initialTeamId ? "team" : "athlete");
  const [athleteId, setAthleteId] = React.useState(initialAthleteId ?? "");
  const [teamId, setTeamId] = React.useState(initialTeamId ?? teams[0]?.id ?? "");
  const [date, setDate] = React.useState(today);
  const [share, setShare] = React.useState(false);
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const tpl = templates.find((x) => x.id === templateId) ?? null;
  const names = new Map(athletes.map((a) => [a.id, a.name]));
  const selected = mode === "athlete" ? (athleteId ? [athleteId] : []) : (teams.find((x) => x.id === teamId)?.athleteIds ?? []).filter((id) => names.has(id));
  const draft = (id: string): Draft => drafts[id] ?? { comments: "", scores: {} };
  const setScore = (aid: string, itemId: string, v: string) => setDrafts((d) => ({ ...d, [aid]: { ...draft(aid), scores: { ...draft(aid).scores, [itemId]: v } } }));

  function submit() {
    if (!tpl) return;
    run(() => saveEvaluations({
      templateId: tpl.id, teamId: mode === "team" ? teamId : null, evaluatedOn: date, share,
      entries: selected.map((aid) => ({
        athleteId: aid, comments: draft(aid).comments,
        scores: tpl.items.map((it) => {
          const raw = draft(aid).scores[it.id] ?? "";
          return { itemId: it.id, score: it.kind === "skill" ? raw : "", value: it.kind === "measurement" ? raw : "", textValue: it.kind === "text" ? raw : "" };
        }),
      })),
    }), () => {
      setDrafts({});
      if (mode === "athlete" && athleteId) router.push(`${base}/athletes/${athleteId}`);
    });
  }

  if (templates.length === 0) return <p className="text-sm text-ink-3">{t("development.evaluate.noTemplates")}</p>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><Label htmlFor="ev-tpl">{t("development.evaluate.template")}</Label>
          <Select id="ev-tpl" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setDrafts({}); }}>
            {templates.map((x) => <option key={x.id} value={x.id}>{x.name}{x.sport ? ` · ${x.sport}` : ""}{x.ageGroup ? ` · ${x.ageGroup}` : ""}</option>)}
          </Select></div>
        <div><Label htmlFor="ev-mode">{t("development.evaluate.who")}</Label>
          <Select id="ev-mode" value={mode} onChange={(e) => setMode(e.target.value as "athlete" | "team")}>
            <option value="athlete">{t("development.evaluate.oneAthlete")}</option>
            <option value="team" disabled={teams.length === 0}>{t("development.evaluate.wholeTeam")}</option>
          </Select></div>
        {mode === "athlete" ? (
          <div><Label htmlFor="ev-ath">{t("development.common.athlete")}</Label>
            <Select id="ev-ath" value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
              <option value="">—</option>
              {athletes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select></div>
        ) : (
          <div><Label htmlFor="ev-team">{t("development.common.team")}</Label>
            <Select id="ev-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select></div>
        )}
        <div><Label htmlFor="ev-date">{t("development.common.date")}</Label><Input id="ev-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>

      {tpl && selected.map((aid) => {
        const d = draft(aid);
        const preview = overallScore(tpl.items, Object.fromEntries(tpl.items.map((it) => [it.id, d.scores[it.id] === undefined || d.scores[it.id] === "" ? null : Number(d.scores[it.id])])));
        return (
          <div key={aid} className="space-y-3 rounded-lg border border-line p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium text-ink">{names.get(aid)}</h3>
              <Badge tone={preview === null ? "neutral" : "brand"}>{preview === null ? t("development.evaluate.noScoreYet") : t("development.evaluate.overall", { score: f.number(preview, { maximumFractionDigits: 0 }) })}</Badge>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {tpl.items.map((it) => {
                const id = `s-${aid}-${it.id}`;
                const val = d.scores[it.id] ?? "";
                return (
                  <div key={it.id}>
                    <Label htmlFor={id}>{it.label}{it.kind === "skill" ? ` (${it.scaleMin}–${it.scaleMax})` : it.unit ? ` (${it.unit})` : ""}</Label>
                    {it.kind === "skill" && it.scaleMax - it.scaleMin <= 10 ? (
                      <div id={id} role="radiogroup" aria-label={it.label} className="flex flex-wrap gap-1">
                        {Array.from({ length: it.scaleMax - it.scaleMin + 1 }, (_, k) => it.scaleMin + k).map((n) => (
                          <button key={n} type="button" role="radio" aria-checked={val === String(n)} onClick={() => setScore(aid, it.id, val === String(n) ? "" : String(n))}
                            className={`touch-target h-9 min-w-9 rounded border px-2 text-sm ${val === String(n) ? "border-brand-primary bg-brand-primary text-on-brand" : "border-border bg-surface text-text hover:border-brand-primary"}`}>{n}</button>
                        ))}
                      </div>
                    ) : it.kind === "text" ? (
                      <Textarea id={id} maxLength={2000} value={val} onChange={(e) => setScore(aid, it.id, e.target.value)} />
                    ) : (
                      <Input id={id} type="number" step="any" min={it.kind === "skill" ? it.scaleMin : undefined} max={it.kind === "skill" ? it.scaleMax : undefined}
                        value={val} onChange={(e) => setScore(aid, it.id, e.target.value)} />
                    )}
                  </div>
                );
              })}
            </div>
            <div><Label htmlFor={`cm-${aid}`}>{t("development.evaluate.comments")}</Label>
              <Textarea id={`cm-${aid}`} maxLength={4000} value={d.comments} onChange={(e) => setDrafts((x) => ({ ...x, [aid]: { ...draft(aid), comments: e.target.value } }))} /></div>
          </div>
        );
      })}
      {selected.length === 0 && <p className="text-sm text-ink-3">{t("development.evaluate.pickSomeone")}</p>}

      <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> {t("development.evaluate.shareNow")}</label>
      <div className="flex items-center gap-2">
        <Button onClick={submit} loading={busy} disabled={!tpl || selected.length === 0}>{t("development.evaluate.submit")}</Button>
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}

/** Share with the family / unshare / delete an evaluation (staff). */
export function EvaluationActions({ id, shared }: { id: string; shared: boolean }) {
  const t = useT();
  const { err, busy, run } = useAction();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Button size="sm" variant={shared ? "ghost" : "secondary"} disabled={busy} onClick={() => run(() => setEvaluationShared(id, !shared))}>
        {shared ? t("development.evaluations.unshare") : t("development.evaluations.share")}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(t("development.evaluations.deleteConfirm"))) run(() => deleteEvaluation(id)); }}>
        {t("development.common.delete")}
      </Button>
      {err && <span role="alert" className="w-full text-xs text-danger">{err}</span>}
    </span>
  );
}
