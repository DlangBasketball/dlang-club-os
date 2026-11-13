"use client";
import * as React from "react";
import { Check, Star } from "lucide-react";
import { Badge, Button, Input, Label, Textarea } from "@/components/ui";
import { setPlanItemDone, submitWellness } from "@/lib/actions/development";
import { useFormat, useT } from "@/lib/i18n/client";
import { completionRate, dateFor, groupPlan } from "@/lib/development/plan";
import { WELLNESS_FIELDS, wellnessFlags } from "@/lib/development/wellness";
import type { AssignmentView } from "@/lib/development/data";
import { ExerciseVideo } from "./plan-forms";
import { useAction } from "./use-action";

/** Weekly view of an assigned plan with check-off and feedback (rating + comment). */
export function PlanWeekView({ assignment, canCheck }: { assignment: AssignmentView; canCheck: boolean }) {
  const t = useT();
  const f = useFormat();
  const grouped = groupPlan(assignment.items);
  const weeks = grouped.map((g) => g.week);
  const [week, setWeek] = React.useState(assignment.currentWeek && weeks.includes(assignment.currentWeek) ? assignment.currentWeek : weeks[0] ?? 1);
  const current = grouped.find((g) => g.week === week);
  const rate = completionRate(assignment.items.map((i) => i.id), Object.keys(assignment.completions));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("development.plans.weeks")}>
          {weeks.map((w) => (
            <button key={w} type="button" role="tab" aria-selected={w === week} onClick={() => setWeek(w)}
              className={`touch-target rounded border px-3 py-1 text-sm ${w === week ? "border-brand-primary bg-brand-primary-soft text-brand-primary" : "border-border text-text-muted hover:text-text"}`}>
              {t("development.plans.weekN", { week: w })}{w === assignment.currentWeek ? " •" : ""}
            </button>
          ))}
        </div>
        <Badge tone={rate >= 80 ? "success" : rate > 0 ? "accent" : "neutral"}>{t("development.plans.doneRate", { rate })}</Badge>
      </div>
      {!current ? <p className="text-sm text-ink-3">{t("development.plans.noItems")}</p> : current.days.map((d) => (
        <section key={d.day} className="rounded-lg border border-line p-3">
          <h4 className="mb-2 text-sm font-medium text-ink">
            {t("development.plans.dayN", { day: d.day })}
            <span className="ml-2 text-xs font-normal text-ink-4">{f.date(dateFor(assignment.startsOn, week, d.day), { weekday: true })}</span>
          </h4>
          <ul className="space-y-2">
            {d.items.map((it) => <PlanItemRow key={it.id} assignmentId={assignment.id} item={it} done={assignment.completions[it.id] ?? null} canCheck={canCheck} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PlanItemRow({ assignmentId, item, done, canCheck }: {
  assignmentId: string; item: AssignmentView["items"][number]; done: AssignmentView["completions"][string] | null; canCheck: boolean;
}) {
  const t = useT();
  const { err, busy, run } = useAction();
  const [open, setOpen] = React.useState(false);
  const [rating, setRating] = React.useState<number | null>(done?.rating ?? null);
  const [comment, setComment] = React.useState(done?.comment ?? "");
  const dose = [
    item.sets !== null && item.reps !== null ? t("development.plans.setsReps", { sets: item.sets, reps: item.reps }) : item.reps !== null ? t("development.plans.repsOnly", { reps: item.reps }) : item.sets !== null ? t("development.plans.setsOnly", { sets: item.sets }) : null,
    item.durationSec !== null ? t("development.plans.durationShort", { seconds: item.durationSec }) : null,
    item.restSec !== null ? t("development.plans.restShort", { seconds: item.restSec }) : null,
  ].filter(Boolean).join(" · ");
  const save = (isDone: boolean) => run(() => setPlanItemDone({ assignmentId, itemId: item.id, done: isDone, rating, comment }), () => setOpen(false));

  return (
    <li className={`rounded border px-3 py-2 text-sm ${done ? "border-success/30 bg-success-soft" : "border-line-soft"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">{item.title}</div>
          {dose && <div className="text-xs text-ink-3">{dose}</div>}
          {item.category && <div className="text-[11px] text-ink-4">{t.dynamic(`development.categories.${item.category}`, undefined, item.category)}{item.equipment.length ? ` · ${item.equipment.join(", ")}` : ""}</div>}
          {item.notes && <p className="mt-1 text-xs text-ink-2">{item.notes}</p>}
          {item.description && <p className="mt-1 text-xs text-ink-3">{item.description}</p>}
          <ExerciseVideo exerciseId={item.exerciseId} videoUrl={item.videoUrl} hasVideo={item.hasVideo} title={item.title} />
          {done && (done.rating || done.comment) && (
            <p className="mt-1 text-xs text-ink-3">{done.rating ? "★".repeat(done.rating) : ""} {done.comment}</p>
          )}
        </div>
        {canCheck && (
          <div className="flex items-center gap-1">
            {done ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => save(false)}><Check className="h-4 w-4 text-success" /> {t("development.plans.done")}</Button>
            ) : (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{t("development.plans.markDone")}</Button>
            )}
          </div>
        )}
      </div>
      {open && !done && (
        <div className="mt-2 space-y-2 border-t border-line-soft pt-2">
          <div role="radiogroup" aria-label={t("development.plans.howWasIt")} className="flex items-center gap-1">
            <span className="mr-1 text-xs text-ink-3">{t("development.plans.howWasIt")}</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={t("development.plans.ratingN", { rating: n })} onClick={() => setRating(rating === n ? null : n)}
                className="touch-target p-1"><Star className={`h-5 w-5 ${rating !== null && n <= rating ? "fill-brand-accent stroke-brand-accent" : "stroke-text-subtle"}`} /></button>
            ))}
          </div>
          <div><Label htmlFor={`fc-${item.id}`}>{t("development.plans.feedback")}</Label><Input id={`fc-${item.id}`} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          <Button size="sm" loading={busy} onClick={() => save(true)}>{t("development.plans.saveDone")}</Button>
        </div>
      )}
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
    </li>
  );
}

/** Daily wellness questionnaire (1-5 + note). */
export function WellnessForm({ athleteId, today, existing }: {
  athleteId: string; today: string; existing: { sleep: number; energy: number; soreness: number; mood: number; note: string | null } | null;
}) {
  const t = useT();
  const { err, busy, run } = useAction();
  const [vals, setVals] = React.useState<Record<(typeof WELLNESS_FIELDS)[number], number>>({
    sleep: existing?.sleep ?? 3, energy: existing?.energy ?? 3, soreness: existing?.soreness ?? 1, mood: existing?.mood ?? 3,
  });
  const [note, setNote] = React.useState(existing?.note ?? "");
  const [msg, setMsg] = React.useState<string | null>(null);
  const flags = wellnessFlags(vals);
  return (
    <div className="space-y-3">
      {WELLNESS_FIELDS.map((k) => (
        <div key={k}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span id={`wl-${k}`} className="text-sm font-medium text-ink">{t.dynamic(`development.wellness.fields.${k}`, undefined, k)}</span>
            <span className="text-xs text-ink-4">{t.dynamic(`development.wellness.hints.${k}`, undefined, "")}</span>
          </div>
          <div role="radiogroup" aria-labelledby={`wl-${k}`} className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={vals[k] === n} onClick={() => setVals((v) => ({ ...v, [k]: n }))}
                className={`touch-target h-10 flex-1 rounded border text-sm ${vals[k] === n ? "border-brand-primary bg-brand-primary text-on-brand" : "border-border bg-surface text-text hover:border-brand-primary"}`}>{n}</button>
            ))}
          </div>
        </div>
      ))}
      <div><Label htmlFor={`wn-${athleteId}`}>{t("development.wellness.note")}</Label><Textarea id={`wn-${athleteId}`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      {flags.length > 0 && <p className="text-xs text-warning">{t("development.wellness.flaggedHint")}</p>}
      <div className="flex items-center gap-2">
        <Button loading={busy} onClick={() => { setMsg(null); run(() => submitWellness({ athleteId, date: today, ...vals, note }), () => setMsg(t("development.wellness.thanks"))); }}>
          {existing ? t("development.wellness.update") : t("development.wellness.submit")}
        </Button>
        {msg && <span role="status" className="text-sm text-success">{msg}</span>}
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}
