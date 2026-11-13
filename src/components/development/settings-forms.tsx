"use client";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { saveDevelopmentSettings, setTeamWellness } from "@/lib/actions/development";
import { useT } from "@/lib/i18n/client";
import type { LevelTier } from "@/lib/development/ranking";
import { useAction } from "./use-action";

type TierDraft = { key: string; min: string; emoji: string; label: string };
let seq = 0;
const newKey = () => `l${++seq}`;

/** Ranking weights, window, family visibility, progress levels (thresholds + emoji). */
export function DevelopmentSettingsForm({ initial }: { initial: { attendance: number; evaluation: number; windowDays: number; familyRankVisible: boolean; levels: LevelTier[] } }) {
  const t = useT();
  const { err, busy, run } = useAction();
  const [attendance, setAttendance] = React.useState(String(initial.attendance));
  const [evaluation, setEvaluation] = React.useState(String(initial.evaluation));
  const [windowDays, setWindowDays] = React.useState(String(initial.windowDays));
  const [familyRankVisible, setFamilyRankVisible] = React.useState(initial.familyRankVisible);
  const [tiers, setTiers] = React.useState<TierDraft[]>(initial.levels.map((l) => ({ key: newKey(), min: String(l.min), emoji: l.emoji, label: l.label ?? "" })));
  const [msg, setMsg] = React.useState<string | null>(null);
  const patch = (key: string, p: Partial<TierDraft>) => setTiers((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><Label htmlFor="st-att">{t("development.settings.attendanceWeight")}</Label><Input id="st-att" type="number" min={0} max={100} value={attendance} onChange={(e) => setAttendance(e.target.value)} /></div>
        <div><Label htmlFor="st-eval">{t("development.settings.evaluationWeight")}</Label><Input id="st-eval" type="number" min={0} max={100} value={evaluation} onChange={(e) => setEvaluation(e.target.value)} /></div>
        <div><Label htmlFor="st-win">{t("development.settings.windowDays")}</Label><Input id="st-win" type="number" min={7} max={730} value={windowDays} onChange={(e) => setWindowDays(e.target.value)} /></div>
      </div>
      <p className="text-xs text-ink-3">{t("development.settings.weightsHint")}</p>
      <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={familyRankVisible} onChange={(e) => setFamilyRankVisible(e.target.checked)} /> {t("development.settings.familyRankVisible")}</label>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-4">{t("development.settings.levels")}</h3>
        <p className="text-xs text-ink-3">{t("development.settings.levelsHint")}</p>
        {tiers.map((tier, i) => (
          <div key={tier.key} className="flex flex-wrap items-end gap-2">
            <div className="w-28"><Label htmlFor={`tm-${tier.key}`}>{t("development.settings.threshold")}</Label><Input id={`tm-${tier.key}`} type="number" min={0} max={100} disabled={i === 0} value={i === 0 ? "0" : tier.min} onChange={(e) => patch(tier.key, { min: e.target.value })} /></div>
            <div className="w-24"><Label htmlFor={`te-${tier.key}`}>{t("development.settings.emoji")}</Label><Input id={`te-${tier.key}`} maxLength={16} value={tier.emoji} onChange={(e) => patch(tier.key, { emoji: e.target.value })} /></div>
            <div className="min-w-[10rem] flex-1"><Label htmlFor={`tl-${tier.key}`}>{t("development.settings.levelLabel")}</Label><Input id={`tl-${tier.key}`} maxLength={40} placeholder={t("development.settings.levelN", { level: i + 1 })} value={tier.label} onChange={(e) => patch(tier.key, { label: e.target.value })} /></div>
            <Button type="button" size="icon" variant="ghost" aria-label={t("development.common.remove")} disabled={tiers.length <= 1} onClick={() => setTiers((xs) => xs.filter((x) => x.key !== tier.key))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="secondary" disabled={tiers.length >= 10} onClick={() => setTiers((xs) => [...xs, { key: newKey(), min: String(Math.min(100, Number(xs[xs.length - 1]?.min ?? 0) + 10)), emoji: "✨", label: "" }])}>
          <Plus className="h-4 w-4" /> {t("development.settings.addLevel")}
        </Button>
      </section>

      <div className="flex items-center gap-2">
        <Button loading={busy} onClick={() => { setMsg(null); run(() => saveDevelopmentSettings({ attendanceWeight: attendance, evaluationWeight: evaluation, windowDays, familyRankVisible, levels: tiers.map((x, i) => ({ min: i === 0 ? "0" : x.min, emoji: x.emoji, label: x.label })) as never }), () => setMsg(t("development.common.saved"))); }}>
          {t("development.common.save")}
        </Button>
        {msg && <span role="status" className="text-sm text-success">{msg}</span>}
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}

export function TeamWellnessToggle({ teamId, enabled, label }: { teamId: string; enabled: boolean; label: string }) {
  const t = useT();
  const { err, busy, run } = useAction();
  return (
    <span className="inline-flex flex-col items-end">
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" aria-label={label} checked={enabled} disabled={busy} onChange={(e) => run(() => setTeamWellness(teamId, e.target.checked))} />
        {enabled ? t("development.wellness.on") : t("development.wellness.off")}
      </label>
      {err && <span role="alert" className="text-xs text-danger">{err}</span>}
    </span>
  );
}
