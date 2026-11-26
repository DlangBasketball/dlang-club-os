"use client";

import * as React from "react";
import { Button, Input, Label, Select, Textarea, FieldHint } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { enrolAthletes, enrolTeam, runRecurringNow, saveRecurringTemplate } from "@/lib/actions/plans";
import { usePlanAction } from "./plan-widgets";

type Opt = { id: string; name: string };
export type TemplateFormValue = {
  id: string | null; name: string; description: string; amount: string; currency: string;
  frequency: "monthly" | "quarterly" | "yearly"; billingDay: string; startDate: string; endDate: string;
  programId: string; teamId: string; proration: "none" | "daily" | "half_month"; dueDays: string;
  applyDiscounts: boolean; isActive: boolean;
};

export function TemplateForm({ initial, teams, programs }: { initial: TemplateFormValue; teams: Opt[]; programs: Opt[] }) {
  const t = useT();
  const { busy, run, note } = usePlanAction();
  const [v, setV] = React.useState(initial);
  const [apply, setApply] = React.useState(false);
  const set = <K extends keyof TemplateFormValue>(k: K, val: TemplateFormValue[K]) => setV((x) => ({ ...x, [k]: val }));
  const p = v.id ?? "new";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2"><Label htmlFor={`tf-name-${p}`}>{t("plans.recurring.name")}</Label>
          <Input id={`tf-name-${p}`} maxLength={120} value={v.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div><Label htmlFor={`tf-amt-${p}`}>{t("plans.common.amount")}</Label>
          <Input id={`tf-amt-${p}`} inputMode="decimal" value={v.amount} onChange={(e) => set("amount", e.target.value)} /></div>
        <div><Label htmlFor={`tf-cur-${p}`}>{t("plans.recurring.currency")}</Label>
          <Input id={`tf-cur-${p}`} maxLength={3} className="uppercase" value={v.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></div>
        <div><Label htmlFor={`tf-freq-${p}`}>{t("plans.recurring.frequency")}</Label>
          <Select id={`tf-freq-${p}`} value={v.frequency} onChange={(e) => set("frequency", e.target.value as TemplateFormValue["frequency"])}>
            <option value="monthly">{t("plans.recurring.frequencies.monthly")}</option>
            <option value="quarterly">{t("plans.recurring.frequencies.quarterly")}</option>
            <option value="yearly">{t("plans.recurring.frequencies.yearly")}</option>
          </Select></div>
        <div><Label htmlFor={`tf-day-${p}`}>{t("plans.recurring.billingDay")}</Label>
          <Input id={`tf-day-${p}`} type="number" min={1} max={31} value={v.billingDay} onChange={(e) => set("billingDay", e.target.value)} /></div>
        <div><Label htmlFor={`tf-start-${p}`}>{t("plans.recurring.startDate")}</Label>
          <Input id={`tf-start-${p}`} type="date" value={v.startDate} onChange={(e) => set("startDate", e.target.value)} /></div>
        <div><Label htmlFor={`tf-end-${p}`}>{t("plans.recurring.endDate")}</Label>
          <Input id={`tf-end-${p}`} type="date" value={v.endDate} onChange={(e) => set("endDate", e.target.value)} /></div>
        <div><Label htmlFor={`tf-team-${p}`}>{t("plans.recurring.team")}</Label>
          <Select id={`tf-team-${p}`} value={v.teamId} onChange={(e) => set("teamId", e.target.value)}>
            <option value="">—</option>{teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select></div>
        <div><Label htmlFor={`tf-prog-${p}`}>{t("plans.recurring.programme")}</Label>
          <Select id={`tf-prog-${p}`} value={v.programId} onChange={(e) => set("programId", e.target.value)}>
            <option value="">—</option>{programs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select></div>
        <div><Label htmlFor={`tf-pro-${p}`}>{t("plans.recurring.proration")}</Label>
          <Select id={`tf-pro-${p}`} value={v.proration} onChange={(e) => set("proration", e.target.value as TemplateFormValue["proration"])}>
            <option value="none">{t("plans.recurring.prorations.none")}</option>
            <option value="daily">{t("plans.recurring.prorations.daily")}</option>
            <option value="half_month">{t("plans.recurring.prorations.half_month")}</option>
          </Select></div>
        <div><Label htmlFor={`tf-due-${p}`}>{t("plans.recurring.dueDays")}</Label>
          <Input id={`tf-due-${p}`} type="number" min={0} max={120} value={v.dueDays} onChange={(e) => set("dueDays", e.target.value)} /></div>
      </div>
      <div><Label htmlFor={`tf-desc-${p}`}>{t("plans.recurring.description")}</Label>
        <Textarea id={`tf-desc-${p}`} maxLength={1000} rows={2} value={v.description} onChange={(e) => set("description", e.target.value)} /></div>
      <div className="flex flex-wrap gap-4 text-sm text-ink-2">
        <label htmlFor={`tf-disc-${p}`} className="flex items-center gap-2"><input id={`tf-disc-${p}`} type="checkbox" checked={v.applyDiscounts} onChange={(e) => set("applyDiscounts", e.target.checked)} /> {t("plans.recurring.applyDiscounts")}</label>
        <label htmlFor={`tf-act-${p}`} className="flex items-center gap-2"><input id={`tf-act-${p}`} type="checkbox" checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} /> {t("plans.recurring.active")}</label>
        {v.id && <label htmlFor={`tf-apply-${p}`} className="flex items-center gap-2"><input id={`tf-apply-${p}`} type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} /> {t("plans.recurring.applyToEnrolments")}</label>}
      </div>
      <FieldHint>{t("plans.recurring.prorationHint")}</FieldHint>
      <div className="flex items-center gap-3">
        <Button size="sm" loading={busy} onClick={() => run(() => saveRecurringTemplate(v.id, {
          name: v.name, description: v.description, amount: Number(v.amount), currency: v.currency, frequency: v.frequency,
          billingDay: Number(v.billingDay), startDate: v.startDate, endDate: v.endDate, programId: v.programId || null, teamId: v.teamId || null,
          proration: v.proration, dueDays: Number(v.dueDays), applyDiscounts: v.applyDiscounts, isActive: v.isActive, applyToEnrolments: apply,
        }), () => { if (!v.id) setV(initial); })}>{t("common.save")}</Button>
        {note}
      </div>
    </div>
  );
}

export function EnrolForm({ templateId, defaultTeamId, teams, athletes, today }: { templateId: string; defaultTeamId: string | null; teams: Opt[]; athletes: Opt[]; today: string }) {
  const t = useT();
  const { busy, run, note } = usePlanAction();
  const [teamId, setTeamId] = React.useState(defaultTeamId ?? "");
  const [athleteId, setAthleteId] = React.useState("");
  const [start, setStart] = React.useState(today);
  const p = templateId.slice(0, 8);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div><Label htmlFor={`ef-start-${p}`}>{t("plans.recurring.joinDate")}</Label><Input id={`ef-start-${p}`} type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div><Label htmlFor={`ef-team-${p}`}>{t("plans.recurring.team")}</Label>
          <Select id={`ef-team-${p}`} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">—</option>{teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select></div>
        <Button size="sm" variant="secondary" disabled={busy || !teamId || !start} onClick={() => run(() => enrolTeam(templateId, teamId, start))}>{t("plans.recurring.enrolTeam")}</Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div><Label htmlFor={`ef-ath-${p}`}>{t("plans.recurring.athlete")}</Label>
          <Select id={`ef-ath-${p}`} value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
            <option value="">—</option>{athletes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select></div>
        <Button size="sm" variant="secondary" disabled={busy || !athleteId || !start} onClick={() => run(() => enrolAthletes(templateId, [athleteId], start), () => setAthleteId(""))}>{t("plans.recurring.enrolOne")}</Button>
      </div>
      {note}
    </div>
  );
}

export function RunNowForm({ today }: { today: string }) {
  const t = useT();
  const { busy, run, note } = usePlanAction();
  const [asOf, setAsOf] = React.useState(today);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div><Label htmlFor="rn-asof">{t("plans.recurring.runUntil")}</Label><Input id="rn-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
        <Button size="sm" loading={busy} onClick={() => { if (window.confirm(t("plans.recurring.runConfirm"))) void run(() => runRecurringNow(asOf)); }}>{t("plans.recurring.runNow")}</Button>
      </div>
      <FieldHint>{t("plans.recurring.runHint")}</FieldHint>
      {note}
    </div>
  );
}
