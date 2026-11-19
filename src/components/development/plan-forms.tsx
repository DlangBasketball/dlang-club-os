"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, Upload, Video } from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import {
  assignTrainingPlan, attachExerciseVideo, createExerciseVideoUpload, deleteExercise, deleteTrainingPlan, getExerciseVideoUrl,
  runPlanAutoAssign, saveExercise, saveTrainingPlan, setAssignmentStatus,
} from "@/lib/actions/development";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/client";
import { EXERCISE_CATEGORIES, LEVELS, VIDEO_MAX_BYTES, VIDEO_TYPES } from "@/lib/development/validation";
import { videoEmbedUrl } from "@/lib/development/plan";
import type { Exercise, PlanDetail } from "@/lib/development/data";
import { useAction } from "./use-action";

const VIDEO_BUCKET = "exercise-videos";

/** Create or edit an exercise (+ private video upload once it exists). */
export function ExerciseForm({ exercise, onDone }: { exercise: Exercise | null; onDone?: () => void }) {
  const t = useT();
  const router = useRouter();
  const { err, busy, run, setErr } = useAction();
  const [name, setName] = React.useState(exercise?.name ?? "");
  const [description, setDescription] = React.useState(exercise?.description ?? "");
  const [sport, setSport] = React.useState(exercise?.sport ?? "");
  const [category, setCategory] = React.useState(exercise?.category ?? "skills");
  const [videoUrl, setVideoUrl] = React.useState(exercise?.videoUrl ?? "");
  const [equipment, setEquipment] = React.useState((exercise?.equipment ?? []).join(", "));
  const [difficulty, setDifficulty] = React.useState(exercise?.difficulty ?? "beginner");
  const [isActive, setIsActive] = React.useState(exercise?.isActive ?? true);
  const [uploading, setUploading] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  async function upload(file: File) {
    if (!exercise) return;
    setMsg(null);
    if (!(file.type in VIDEO_TYPES)) { setErr(t("development.errors.videoType")); return; }
    if (file.size > VIDEO_MAX_BYTES) { setErr(t("development.errors.videoSize")); return; }
    setUploading(true);
    try {
      const prep = await createExerciseVideoUpload({ exerciseId: exercise.id, contentType: file.type, size: file.size });
      if (!prep.ok || !prep.data) { setErr(prep.ok ? t("development.errors.uploadFailed") : prep.error); return; }
      const { error } = await createClient().storage.from(VIDEO_BUCKET).uploadToSignedUrl(prep.data.path, prep.data.token, file, { contentType: file.type });
      if (error) { setErr(t("development.errors.uploadFailed")); return; }
      const path = prep.data.path;
      await run(() => attachExerciseVideo(exercise.id, path), () => setMsg(t("development.exercises.videoUploaded")));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor="ex-name">{t("development.exercises.name")}</Label><Input id="ex-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label htmlFor="ex-sport">{t("development.common.sport")}</Label><Input id="ex-sport" maxLength={60} value={sport} onChange={(e) => setSport(e.target.value)} /></div>
        <div><Label htmlFor="ex-cat">{t("development.exercises.category")}</Label>
          <Select id="ex-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXERCISE_CATEGORIES.map((c) => <option key={c} value={c}>{t.dynamic(`development.categories.${c}`, undefined, c)}</option>)}
          </Select></div>
        <div><Label htmlFor="ex-diff">{t("development.exercises.difficulty")}</Label>
          <Select id="ex-diff" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            {LEVELS.map((l) => <option key={l} value={l}>{t.dynamic(`development.levels.${l}`, undefined, l)}</option>)}
          </Select></div>
        <div><Label htmlFor="ex-eq">{t("development.exercises.equipment")}</Label><Input id="ex-eq" maxLength={300} placeholder={t("development.exercises.equipmentHint")} value={equipment} onChange={(e) => setEquipment(e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor="ex-url">{t("development.exercises.videoUrl")}</Label><Input id="ex-url" type="url" maxLength={500} placeholder="https://" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor="ex-desc">{t("development.common.description")}</Label><Textarea id="ex-desc" maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> {t("development.common.active")}</label>
      </div>
      {exercise && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line p-3 text-sm">
          <Video className="h-4 w-4 text-ink-3" aria-hidden />
          <span className="text-ink-3">{exercise.hasVideo ? t("development.exercises.hasVideo") : t("development.exercises.noVideo")}</span>
          <label className="inline-flex cursor-pointer items-center gap-1 text-maroon hover:underline">
            <Upload className="h-4 w-4" aria-hidden /> {uploading ? t("development.exercises.uploading") : t("development.exercises.uploadVideo")}
            <input type="file" accept={Object.keys(VIDEO_TYPES).join(",")} className="sr-only" disabled={uploading}
              onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) upload(file); }} />
          </label>
          {exercise.hasVideo && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => attachExerciseVideo(exercise.id, null))}>{t("development.exercises.removeVideo")}</Button>}
          <span className="w-full text-xs text-ink-4">{t("development.exercises.videoPrivacy")}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" loading={busy} onClick={() => { setMsg(null); run(() => saveExercise(exercise?.id ?? null, { name, description, sport, category: category as never, videoUrl, equipment, difficulty: difficulty as never, isActive }), () => { setMsg(t("development.common.saved")); if (!exercise) { setName(""); setDescription(""); setVideoUrl(""); setEquipment(""); } onDone?.(); }); }}>
          {t("development.common.save")}
        </Button>
        {exercise && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(t("development.exercises.deleteConfirm"))) run(() => deleteExercise(exercise.id), () => router.refresh()); }}>{t("development.common.delete")}</Button>}
        {msg && <span role="status" className="text-sm text-success">{msg}</span>}
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}

/** Watch an exercise video: embedded YouTube / Vimeo link or a short-lived signed URL of the private upload. */
export function ExerciseVideo({ exerciseId, videoUrl, hasVideo, title }: { exerciseId: string | null; videoUrl: string | null; hasVideo: boolean; title: string }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [src, setSrc] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const embed = videoEmbedUrl(videoUrl);
  if (!embed && !hasVideo && !videoUrl) return null;
  if (!embed && !hasVideo && videoUrl) {
    return <a href={videoUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-maroon hover:underline">{t("development.exercises.watch")}</a>;
  }
  return (
    <div className="w-full">
      <button type="button" className="inline-flex items-center gap-1 text-xs text-maroon hover:underline" aria-expanded={open} onClick={async () => {
        const next = !open;
        setOpen(next);
        if (next && !embed && hasVideo && exerciseId && !src) {
          const res = await getExerciseVideoUrl(exerciseId);
          if (res.ok && res.data) setSrc(res.data.url); else setErr(res.ok ? null : res.error);
        }
      }}><Video className="h-3.5 w-3.5" aria-hidden /> {open ? t("development.exercises.hideVideo") : t("development.exercises.watch")}</button>
      {open && (
        <div className="mt-2 aspect-video w-full max-w-xl overflow-hidden rounded-lg border border-line bg-bg">
          {embed ? (
            <iframe src={embed} title={title} className="h-full w-full" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" sandbox="allow-scripts allow-same-origin allow-presentation" />
          ) : src ? (
            <video src={src} controls preload="metadata" className="h-full w-full" />
          ) : null}
        </div>
      )}
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
    </div>
  );
}

type ItemDraft = {
  key: string; id: string | null; week: string; day: string; exerciseId: string; title: string; sets: string; reps: string;
  durationSec: string; restSec: string; notes: string;
};
let seq = 0;
const newKey = () => `p${++seq}`;
const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/** Plan builder: details + weeks -> days -> exercises (sets / reps / time / notes). */
export function PlanEditor({ base, plan, exercises }: { base: string; plan: PlanDetail | null; exercises: Exercise[] }) {
  const t = useT();
  const router = useRouter();
  const { err, busy, run } = useAction();
  const [name, setName] = React.useState(plan?.name ?? "");
  const [description, setDescription] = React.useState(plan?.description ?? "");
  const [sport, setSport] = React.useState(plan?.sport ?? "");
  const [ageMin, setAgeMin] = React.useState(str(plan?.ageMin));
  const [ageMax, setAgeMax] = React.useState(str(plan?.ageMax));
  const [level, setLevel] = React.useState(plan?.level ?? "");
  const [weeks, setWeeks] = React.useState(str(plan?.weeks ?? 4));
  const [isTemplate, setIsTemplate] = React.useState(plan?.isTemplate ?? true);
  const [autoAssign, setAutoAssign] = React.useState(plan?.autoAssign ?? false);
  const [isActive, setIsActive] = React.useState(plan?.isActive ?? true);
  const [items, setItems] = React.useState<ItemDraft[]>((plan?.items ?? []).map((i) => ({
    key: i.id, id: i.id, week: String(i.week), day: String(i.day), exerciseId: i.exerciseId ?? "", title: i.title, sets: str(i.sets), reps: str(i.reps),
    durationSec: str(i.durationSec), restSec: str(i.restSec), notes: i.notes ?? "",
  })));
  const [msg, setMsg] = React.useState<string | null>(null);
  const [week, setWeek] = React.useState(1);
  const nWeeks = Math.max(1, Math.min(52, Number(weeks) || 1));
  const dayNames = [1, 2, 3, 4, 5, 6, 7].map((d) => t("development.plans.dayN", { day: d }));
  const patch = (key: string, p: Partial<ItemDraft>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const move = (key: string, d: -1 | 1) => setItems((xs) => {
    const i = xs.findIndex((x) => x.key === key);
    const same = xs.map((x, k) => ({ x, k })).filter(({ x }) => x.week === xs[i].week && x.day === xs[i].day).map(({ k }) => k);
    const pos = same.indexOf(i);
    const j = same[pos + d];
    if (j === undefined) return xs;
    const next = xs.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const copyWeek = () => {
    const src = items.filter((i) => Number(i.week) === week);
    const target = week + 1;
    if (target > nWeeks || src.length === 0) return;
    setItems((xs) => [...xs.filter((x) => Number(x.week) !== target), ...src.map((s) => ({ ...s, key: newKey(), id: null, week: String(target) }))]);
    setWeek(target);
  };

  function save() {
    setMsg(null);
    run(() => saveTrainingPlan(plan?.id ?? null, {
      name, description, sport, ageMin, ageMax, level: (level || null) as never, weeks, isTemplate, autoAssign: isTemplate && autoAssign, isActive,
      items: items.map((i) => ({ id: i.id, week: i.week, day: i.day, exerciseId: i.exerciseId || null, title: i.title, sets: i.sets, reps: i.reps, durationSec: i.durationSec, restSec: i.restSec, notes: i.notes })),
    }), (res) => {
      setMsg(res.ok && res.data?.autoAssigned ? t("development.plans.autoAssigned", { count: res.data.autoAssigned }) : t("development.common.saved"));
      if (!plan && res.ok && res.data) router.push(`${base}/plans/${res.data.id}`);
    });
  }

  const activeExercises = exercises.filter((e) => e.isActive || items.some((i) => i.exerciseId === e.id));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3"><Label htmlFor="pl-name">{t("development.plans.name")}</Label><Input id="pl-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label htmlFor="pl-sport">{t("development.common.sport")}</Label><Input id="pl-sport" maxLength={60} value={sport} onChange={(e) => setSport(e.target.value)} /></div>
        <div><Label htmlFor="pl-level">{t("development.common.level")}</Label>
          <Select id="pl-level" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">{t("development.common.anyLevel")}</option>
            {LEVELS.map((l) => <option key={l} value={l}>{t.dynamic(`development.levels.${l}`, undefined, l)}</option>)}
          </Select></div>
        <div><Label htmlFor="pl-weeks">{t("development.plans.weeks")}</Label><Input id="pl-weeks" type="number" min={1} max={52} value={weeks} onChange={(e) => setWeeks(e.target.value)} /></div>
        <div><Label htmlFor="pl-amin">{t("development.common.ageMin")}</Label><Input id="pl-amin" type="number" min={0} max={99} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} /></div>
        <div><Label htmlFor="pl-amax">{t("development.common.ageMax")}</Label><Input id="pl-amax" type="number" min={0} max={99} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} /></div>
        <div className="sm:col-span-2 lg:col-span-3"><Label htmlFor="pl-desc">{t("development.common.description")}</Label><Textarea id="pl-desc" maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={isTemplate} onChange={(e) => setIsTemplate(e.target.checked)} /> {t("development.plans.isTemplate")}</label>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" disabled={!isTemplate} checked={isTemplate && autoAssign} onChange={(e) => setAutoAssign(e.target.checked)} /> {t("development.plans.autoAssign")}</label>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> {t("development.common.active")}</label>
      </div>
      {isTemplate && autoAssign && <p className="text-xs text-ink-3">{t("development.plans.autoAssignHint")}</p>}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={t("development.plans.weeks")}>
          {Array.from({ length: nWeeks }, (_, k) => k + 1).map((w) => (
            <button key={w} type="button" role="tab" aria-selected={w === week} onClick={() => setWeek(w)}
              className={`touch-target rounded border px-3 py-1 text-sm ${w === week ? "border-brand-primary bg-brand-primary-soft text-brand-primary" : "border-border text-text-muted hover:text-text"}`}>
              {t("development.plans.weekN", { week: w })} <span className="text-xs text-ink-4">({items.filter((i) => Number(i.week) === w).length})</span>
            </button>
          ))}
          {week < nWeeks && <Button type="button" size="sm" variant="ghost" onClick={copyWeek}><Copy className="h-4 w-4" /> {t("development.plans.copyWeek")}</Button>}
        </div>
        {[1, 2, 3, 4, 5, 6, 7].map((day) => {
          const dayItems = items.filter((i) => Number(i.week) === week && Number(i.day) === day);
          return (
            <div key={day} className="rounded-lg border border-line p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-medium text-ink">{dayNames[day - 1]}</h4>
                <Button type="button" size="sm" variant="ghost" onClick={() => setItems((xs) => [...xs, { key: newKey(), id: null, week: String(week), day: String(day), exerciseId: activeExercises[0]?.id ?? "", title: "", sets: "", reps: "", durationSec: "", restSec: "", notes: "" }])}>
                  <Plus className="h-4 w-4" /> {t("development.plans.addExercise")}
                </Button>
              </div>
              {dayItems.length === 0 ? <p className="text-xs text-ink-4">{t("development.plans.restDay")}</p> : (
                <ul className="space-y-2">
                  {dayItems.map((it) => (
                    <li key={it.key} className="grid grid-cols-2 gap-2 rounded border border-line-soft p-2 sm:grid-cols-6">
                      <div className="col-span-2"><Label htmlFor={`e-${it.key}`}>{t("development.plans.exercise")}</Label>
                        <Select id={`e-${it.key}`} value={it.exerciseId} onChange={(e) => patch(it.key, { exerciseId: e.target.value })}>
                          <option value="">{t("development.plans.customItem")}</option>
                          {activeExercises.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </Select></div>
                      <div className="col-span-2"><Label htmlFor={`t-${it.key}`}>{t("development.plans.title")}</Label><Input id={`t-${it.key}`} maxLength={120} value={it.title} placeholder={it.exerciseId ? t("development.plans.titleOptional") : ""} onChange={(e) => patch(it.key, { title: e.target.value })} /></div>
                      <div><Label htmlFor={`se-${it.key}`}>{t("development.plans.sets")}</Label><Input id={`se-${it.key}`} type="number" min={0} max={100} value={it.sets} onChange={(e) => patch(it.key, { sets: e.target.value })} /></div>
                      <div><Label htmlFor={`re-${it.key}`}>{t("development.plans.reps")}</Label><Input id={`re-${it.key}`} type="number" min={0} max={1000} value={it.reps} onChange={(e) => patch(it.key, { reps: e.target.value })} /></div>
                      <div><Label htmlFor={`du-${it.key}`}>{t("development.plans.durationSec")}</Label><Input id={`du-${it.key}`} type="number" min={0} max={86400} value={it.durationSec} onChange={(e) => patch(it.key, { durationSec: e.target.value })} /></div>
                      <div><Label htmlFor={`rs-${it.key}`}>{t("development.plans.restSec")}</Label><Input id={`rs-${it.key}`} type="number" min={0} max={3600} value={it.restSec} onChange={(e) => patch(it.key, { restSec: e.target.value })} /></div>
                      <div className="col-span-2 sm:col-span-3"><Label htmlFor={`no-${it.key}`}>{t("development.plans.notes")}</Label><Input id={`no-${it.key}`} maxLength={1000} value={it.notes} onChange={(e) => patch(it.key, { notes: e.target.value })} /></div>
                      <div className="col-span-2 flex items-end justify-end gap-1 sm:col-span-1">
                        <Button type="button" size="icon" variant="ghost" aria-label={t("development.common.moveUp")} onClick={() => move(it.key, -1)}><ArrowUp className="h-4 w-4" /></Button>
                        <Button type="button" size="icon" variant="ghost" aria-label={t("development.common.moveDown")} onClick={() => move(it.key, 1)}><ArrowDown className="h-4 w-4" /></Button>
                        <Button type="button" size="icon" variant="ghost" aria-label={t("development.common.remove")} onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} loading={busy}>{t("development.common.save")}</Button>
        {plan && <Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm(t("development.plans.deleteConfirm"))) run(() => deleteTrainingPlan(plan.id), () => router.push(`${base}/plans`)); }}>{t("development.common.delete")}</Button>}
        {msg && !err && <span role="status" className="text-sm text-success">{msg}</span>}
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}

/** Manual assignment of a plan to athletes (or a whole team) + auto-assign now. */
export function AssignPlanForm({ planId, athletes, teams, today, canAutoAssign }: {
  planId: string; athletes: { id: string; name: string }[]; teams: { id: string; name: string; athleteIds: string[] }[]; today: string; canAutoAssign: boolean;
}) {
  const t = useT();
  const { err, busy, run } = useAction();
  const [picked, setPicked] = React.useState<string[]>([]);
  const [startsOn, setStartsOn] = React.useState(today);
  const [atHome, setAtHome] = React.useState(true);
  const [notes, setNotes] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const names = new Set(athletes.map((a) => a.id));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><Label htmlFor="as-team">{t("development.plans.addTeam")}</Label>
          <Select id="as-team" value="" onChange={(e) => { const tm = teams.find((x) => x.id === e.target.value); if (tm) setPicked((p) => Array.from(new Set([...p, ...tm.athleteIds.filter((id) => names.has(id))]))); }}>
            <option value="">—</option>
            {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select></div>
        <div><Label htmlFor="as-start">{t("development.plans.startsOn")}</Label><Input id="as-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} /></div>
        <label className="flex items-center gap-2 pt-6 text-sm text-ink"><input type="checkbox" checked={atHome} onChange={(e) => setAtHome(e.target.checked)} /> {t("development.plans.atHome")}</label>
      </div>
      <fieldset>
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-4">{t("development.plans.athletes")}</legend>
        <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded border border-line p-2 sm:grid-cols-2">
          {athletes.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={picked.includes(a.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id)))} /> {a.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div><Label htmlFor="as-notes">{t("development.plans.notes")}</Label><Input id="as-notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" loading={busy} disabled={picked.length === 0} onClick={() => { setMsg(null); run(() => assignTrainingPlan({ planId, athleteIds: picked, startsOn, atHome, notes }), (res) => { setMsg(t("development.plans.assigned", { count: res.ok ? res.data?.assigned ?? 0 : 0 })); setPicked([]); }); }}>
          {t("development.plans.assign")}
        </Button>
        {canAutoAssign && <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setMsg(null); run(() => runPlanAutoAssign(planId), (res) => setMsg(t("development.plans.autoAssigned", { count: res.ok ? res.data?.assigned ?? 0 : 0 }))); }}>{t("development.plans.autoAssignNow")}</Button>}
        {msg && <span role="status" className="text-sm text-success">{msg}</span>}
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}

export function AssignmentStatusButton({ id, status }: { id: string; status: string }) {
  const t = useT();
  const { err, busy, run } = useAction();
  return (
    <span className="inline-flex items-center gap-1">
      {status === "active" ? (
        <>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => setAssignmentStatus(id, "completed"))}>{t("development.plans.markCompleted")}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => setAssignmentStatus(id, "cancelled"))}>{t("development.plans.unassign")}</Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => setAssignmentStatus(id, "active"))}>{t("development.plans.reactivate")}</Button>
      )}
      {err && <span role="alert" className="text-xs text-danger">{err}</span>}
    </span>
  );
}
