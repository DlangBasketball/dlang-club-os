"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { assignNutritionPlan, deleteNutritionPlan, saveNutritionPlan, unassignNutritionPlan } from "@/lib/actions/development";
import { useT } from "@/lib/i18n/client";
import { MEALS } from "@/lib/development/validation";
import type { NutritionPlan } from "@/lib/development/data";
import { useAction } from "./use-action";

type MealDraft = { key: string; day: string; meal: string; description: string };
let seq = 0;
const newKey = () => `m${++seq}`;

/** Nutrition plan template (age group) or client-specific plan: meals per day + hydration + guidelines. */
export function NutritionEditor({ base, plan, athletes }: { base: string; plan: NutritionPlan | null; athletes: { id: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const { err, busy, run } = useAction();
  const [name, setName] = React.useState(plan?.name ?? "");
  const [description, setDescription] = React.useState(plan?.description ?? "");
  const [ageMin, setAgeMin] = React.useState(plan?.ageMin?.toString() ?? "");
  const [ageMax, setAgeMax] = React.useState(plan?.ageMax?.toString() ?? "");
  const [athleteId, setAthleteId] = React.useState(plan?.athleteId ?? "");
  const [hydrationMl, setHydrationMl] = React.useState(plan?.hydrationMl?.toString() ?? "");
  const [guidelines, setGuidelines] = React.useState(plan?.guidelines ?? "");
  const [isActive, setIsActive] = React.useState(plan?.isActive ?? true);
  const [meals, setMeals] = React.useState<MealDraft[]>((plan?.meals ?? []).map((m) => ({ key: newKey(), day: String(m.day), meal: m.meal, description: m.description })));
  const [msg, setMsg] = React.useState<string | null>(null);
  const patch = (key: string, p: Partial<MealDraft>) => setMeals((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const days = [0, 1, 2, 3, 4, 5, 6, 7];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor="nu-name">{t("development.nutrition.name")}</Label><Input id="nu-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label htmlFor="nu-ath">{t("development.nutrition.clientSpecific")}</Label>
          <Select id="nu-ath" value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
            <option value="">{t("development.nutrition.template")}</option>
            {athletes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select></div>
        <div><Label htmlFor="nu-h2o">{t("development.nutrition.hydrationMl")}</Label><Input id="nu-h2o" type="number" min={0} max={10000} step={50} value={hydrationMl} onChange={(e) => setHydrationMl(e.target.value)} /></div>
        <div><Label htmlFor="nu-amin">{t("development.common.ageMin")}</Label><Input id="nu-amin" type="number" min={0} max={99} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} /></div>
        <div><Label htmlFor="nu-amax">{t("development.common.ageMax")}</Label><Input id="nu-amax" type="number" min={0} max={99} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor="nu-desc">{t("development.common.description")}</Label><Textarea id="nu-desc" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor="nu-guide">{t("development.nutrition.guidelines")}</Label><Textarea id="nu-guide" maxLength={4000} value={guidelines} onChange={(e) => setGuidelines(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> {t("development.common.active")}</label>
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-4">{t("development.nutrition.meals")}</h3>
        {meals.map((m) => (
          <div key={m.key} className="grid grid-cols-2 gap-2 rounded border border-line-soft p-2 sm:grid-cols-6">
            <div><Label htmlFor={`d-${m.key}`}>{t("development.nutrition.day")}</Label>
              <Select id={`d-${m.key}`} value={m.day} onChange={(e) => patch(m.key, { day: e.target.value })}>
                {days.map((d) => <option key={d} value={d}>{d === 0 ? t("development.nutrition.everyDay") : t("development.plans.dayN", { day: d })}</option>)}
              </Select></div>
            <div><Label htmlFor={`ml-${m.key}`}>{t("development.nutrition.meal")}</Label>
              <Select id={`ml-${m.key}`} value={m.meal} onChange={(e) => patch(m.key, { meal: e.target.value })}>
                {MEALS.map((x) => <option key={x} value={x}>{t.dynamic(`development.meals.${x}`, undefined, x)}</option>)}
              </Select></div>
            <div className="col-span-2 sm:col-span-3"><Label htmlFor={`md-${m.key}`}>{t("development.common.description")}</Label><Input id={`md-${m.key}`} maxLength={1000} value={m.description} onChange={(e) => patch(m.key, { description: e.target.value })} /></div>
            <div className="flex items-end justify-end"><Button type="button" size="icon" variant="ghost" aria-label={t("development.common.remove")} onClick={() => setMeals((xs) => xs.filter((x) => x.key !== m.key))}><Trash2 className="h-4 w-4" /></Button></div>
          </div>
        ))}
        <Button type="button" size="sm" variant="secondary" onClick={() => setMeals((xs) => [...xs, { key: newKey(), day: "0", meal: "breakfast", description: "" }])}><Plus className="h-4 w-4" /> {t("development.nutrition.addMeal")}</Button>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button loading={busy} onClick={() => { setMsg(null); run(() => saveNutritionPlan(plan?.id ?? null, { name, description, ageMin, ageMax, athleteId: athleteId || null, hydrationMl, guidelines, isActive, meals: meals.map((m) => ({ day: m.day, meal: m.meal as never, description: m.description })) }), (res) => { setMsg(t("development.common.saved")); if (!plan && res.ok && res.data) router.push(`${base}/nutrition/${res.data.id}`); }); }}>
          {t("development.common.save")}
        </Button>
        {plan && <Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm(t("development.nutrition.deleteConfirm"))) run(() => deleteNutritionPlan(plan.id), () => router.push(`${base}/nutrition`)); }}>{t("development.common.delete")}</Button>}
        {msg && !err && <span role="status" className="text-sm text-success">{msg}</span>}
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}

export function AssignNutritionForm({ planId, athletes, teams, today }: { planId: string; athletes: { id: string; name: string }[]; teams: { id: string; name: string; athleteIds: string[] }[]; today: string }) {
  const t = useT();
  const { err, busy, run } = useAction();
  const [picked, setPicked] = React.useState<string[]>([]);
  const [startsOn, setStartsOn] = React.useState(today);
  const [msg, setMsg] = React.useState<string | null>(null);
  const names = new Set(athletes.map((a) => a.id));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><Label htmlFor="na-team">{t("development.plans.addTeam")}</Label>
          <Select id="na-team" value="" onChange={(e) => { const tm = teams.find((x) => x.id === e.target.value); if (tm) setPicked((p) => Array.from(new Set([...p, ...tm.athleteIds.filter((id) => names.has(id))]))); }}>
            <option value="">—</option>
            {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select></div>
        <div><Label htmlFor="na-start">{t("development.plans.startsOn")}</Label><Input id="na-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} /></div>
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
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" loading={busy} disabled={picked.length === 0} onClick={() => { setMsg(null); run(() => assignNutritionPlan({ planId, athleteIds: picked, startsOn }), (res) => { setMsg(t("development.plans.assigned", { count: res.ok ? res.data?.assigned ?? 0 : 0 })); setPicked([]); }); }}>
          {t("development.plans.assign")}
        </Button>
        {msg && <span role="status" className="text-sm text-success">{msg}</span>}
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}

export function UnassignNutritionButton({ id }: { id: string }) {
  const t = useT();
  const { err, busy, run } = useAction();
  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => unassignNutritionPlan(id))}>{t("development.plans.unassign")}</Button>
      {err && <span role="alert" className="text-xs text-danger">{err}</span>}
    </span>
  );
}
