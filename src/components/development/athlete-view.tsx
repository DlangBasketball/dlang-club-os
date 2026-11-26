import Link from "next/link";
import { Activity, ClipboardCheck, Dumbbell, HeartPulse, Salad, TrendingUp } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, StatCard, StatGrid } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { bucketSeries } from "@/lib/development/scoring";
import type { AthleteDevelopment } from "@/lib/development/data";
import type { LevelTier } from "@/lib/development/ranking";
import type { Translator } from "@/lib/i18n/translator";
import { LineChart, ScoreBar } from "./charts";
import { EvaluationActions } from "./assessment-forms";
import { AssignmentStatusButton } from "./plan-forms";
import { PlanWeekView, WellnessForm } from "./family-widgets";

/** "Mar 26" for a yyyy-mm bucket, in the viewer's locale. */
function monthLabel(locale: string, bucket: string) {
  return new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${bucket}-01T00:00:00Z`));
}

export function levelName(t: Translator, tier: LevelTier, index: number) {
  return tier.label || t("development.settings.levelN", { level: index + 1 });
}

/** Big emoji badge: the child's progress level (improves with participation and evaluations). */
export function LevelBadge({ data, t }: { data: Pick<AthleteDevelopment, "level" | "progressScore">; t: Translator }) {
  const { tier, index, next } = data.level;
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-full border border-brand-accent/40 bg-brand-accent-soft text-3xl">{tier.emoji}</span>
      <div>
        <div className="font-display text-lg text-ink">{levelName(t, tier, index)}</div>
        <div className="text-xs text-ink-3">
          {next ? t("development.progress.nextLevel", { emoji: next.emoji, points: Math.max(0, Math.ceil(next.min - (data.progressScore ?? 0))) }) : t("development.progress.topLevel")}
        </div>
      </div>
    </div>
  );
}

export async function AthleteDevelopmentView({ data, mode, base, view, today }: {
  data: AthleteDevelopment; mode: "staff" | "family"; base: string; view: "all" | "month" | "year"; today: string;
}) {
  const { t, f } = await getI18n();
  const staff = mode === "staff";
  const scored = data.evaluations.filter((e) => e.overallScore !== null).slice().reverse();
  const series = view === "all"
    ? scored.map((e) => ({ label: f.date(e.evaluatedOn, { style: "short" }), value: e.overallScore as number, display: f.number(e.overallScore, { maximumFractionDigits: 0 }) }))
    : bucketSeries(scored.map((e) => ({ date: e.evaluatedOn, value: e.overallScore as number })), view).map((b) => ({
        label: view === "month" ? monthLabel(f.locale, b.bucket) : b.bucket,
        value: b.value, display: f.number(b.value, { maximumFractionDigits: 0 }),
      }));
  const latest = data.evaluations.find((e) => e.overallScore !== null)?.overallScore ?? null;
  const todayWellness = data.wellness.find((w) => w.date === today) ?? null;
  const viewHref = (v: string) => `?view=${v}`;

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <LevelBadge data={data} t={t} />
          <div className="flex flex-wrap gap-2">
            {data.ranks.map((r, i) => (
              <Badge key={i} tone={r.band === "top10" || r.band === "top25" ? "accent" : "neutral"}>
                {r.groupName}: {r.band ? t.dynamic(`development.bands.${r.band}`, undefined, r.band) : t("development.bands.none")}
                {staff && r.position ? ` · ${t("development.rankings.positionOf", { position: r.position, size: r.size })}` : ""}
              </Badge>
            ))}
          </div>
        </CardBody>
      </Card>

      <StatGrid>
        <StatCard label={t("development.progress.score")} value={data.progressScore === null ? "—" : f.number(data.progressScore, { maximumFractionDigits: 0 })} tone="accent" />
        <StatCard label={t("development.progress.attendance")} value={data.attendanceRate === null ? "—" : f.percent(data.attendanceRate / 100, 0)} tone="success" />
        <StatCard label={t("development.progress.latestEvaluation")} value={latest === null ? "—" : f.number(latest, { maximumFractionDigits: 0 })} tone="brand" />
        <StatCard label={t("development.progress.evaluations")} value={String(data.evaluations.length)} />
      </StatGrid>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-maroon" /> {t("development.progress.chartTitle")}</CardTitle>
          <nav className="flex gap-1 text-xs" aria-label={t("development.progress.chartTitle")}>
            {(["all", "month", "year"] as const).map((v) => (
              <Link key={v} href={viewHref(v)} aria-current={view === v ? "page" : undefined}
                className={`rounded border px-2 py-1 ${view === v ? "border-brand-primary text-brand-primary" : "border-border text-text-muted hover:text-text"}`}>
                {t.dynamic(`development.progress.views.${v}`, undefined, v)}
              </Link>
            ))}
          </nav>
        </CardHeader>
        <CardBody>
          {series.length === 0 ? <p className="text-sm text-ink-3">{t("development.progress.noScores")}</p>
            : <LineChart points={series} min={0} max={100} title={t("development.progress.chartTitle")} />}
        </CardBody>
      </Card>

      {data.measurements.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4 text-maroon" /> {t("development.measurements.title")}</CardTitle></CardHeader>
          <CardBody className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {data.measurements.map((m) => {
              const last = m.points[m.points.length - 1];
              const first = m.points[0];
              const delta = m.points.length > 1 ? last.value - first.value : null;
              const pts = (view === "all" ? m.points : bucketSeries(m.points, view).map((b) => ({ date: view === "month" ? `${b.bucket}-01` : `${b.bucket}-01-01`, value: b.value })))
                .map((p) => ({ label: view === "year" ? p.date.slice(0, 4) : f.date(p.date, { style: "short" }), value: p.value, display: `${f.number(p.value)}${m.unit ? ` ${m.unit}` : ""}` }));
              return (
                <div key={m.itemId}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-ink">{m.label}</span>
                    <span className="tnum text-sm text-ink-2">
                      {f.number(last.value)}{m.unit ? ` ${m.unit}` : ""}
                      {delta !== null && <span className="ml-2 text-xs text-ink-4">{t("development.measurements.change", { change: `${delta > 0 ? "+" : ""}${f.number(delta)}` })}</span>}
                    </span>
                  </div>
                  {pts.length > 1 ? <LineChart points={pts} title={m.label} height={140} /> : <p className="text-xs text-ink-4">{t("development.measurements.onePoint", { date: f.date(last.date) })}</p>}
                </div>
              );
            })}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-maroon" /> {t("development.evaluations.history")}</CardTitle>
          {staff && <Link href={`${base}/evaluate?athlete=${data.athlete.id}`} className="text-sm text-maroon hover:underline">{t("development.evaluate.new")}</Link>}
        </CardHeader>
        <CardBody className="space-y-3">
          {data.evaluations.length === 0 ? (
            <p className="text-sm text-ink-3">{staff ? t("development.evaluations.none") : t("development.evaluations.noneShared")}</p>
          ) : data.evaluations.map((e) => (
            <details key={e.id} className="rounded-lg border border-line px-3 py-2">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium text-ink">{f.date(e.evaluatedOn)} · {e.templateName}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {e.coachName && <span className="text-xs text-ink-3">{e.coachName}</span>}
                  {staff && <Badge tone={e.shared ? "success" : "neutral"}>{e.shared ? t("development.evaluations.shared") : t("development.evaluations.private")}</Badge>}
                  {e.overallScore !== null && <Badge tone="brand">{f.number(e.overallScore, { maximumFractionDigits: 0 })}</Badge>}
                </span>
              </summary>
              <div className="mt-3 space-y-2">
                {e.scores.map((s) => (
                  <div key={s.itemId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm">
                    <span className="text-ink-2">{s.label}</span>
                    {s.kind === "skill" && s.score !== null ? (
                      <span className="flex w-40 items-center gap-2"><ScoreBar value={((s.score - s.scaleMin) / Math.max(1, s.scaleMax - s.scaleMin)) * 100} label={s.label} /><span className="tnum text-xs text-ink-3">{f.number(s.score)}/{s.scaleMax}</span></span>
                    ) : s.kind === "measurement" && s.value !== null ? (
                      <span className="tnum text-ink">{f.number(s.value)}{s.unit ? ` ${s.unit}` : ""}</span>
                    ) : <span className="text-ink-3">{s.textValue}</span>}
                  </div>
                ))}
                {e.comments && <p className="whitespace-pre-line border-t border-line-soft pt-2 text-sm text-ink-2">{e.comments}</p>}
                {staff && e.canEdit && <EvaluationActions id={e.id} shared={e.shared} />}
              </div>
            </details>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><Dumbbell className="h-4 w-4 text-maroon" /> {staff ? t("development.plans.assignedPlans") : t("development.plans.myPlan")}</CardTitle>
          {staff && <Link href={`${base}/plans`} className="text-sm text-maroon hover:underline">{t("development.plans.assignAPlan")}</Link>}
        </CardHeader>
        <CardBody className="space-y-5">
          {data.assignments.length === 0 ? <EmptyState icon={<Dumbbell className="h-5 w-5" />} title={t("development.plans.noneAssigned")} /> : data.assignments.map((a) => (
            <section key={a.id} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-medium text-ink">{a.planName}</h3>
                  <p className="text-xs text-ink-3">
                    {t("development.plans.since", { date: f.date(a.startsOn) })}
                    {a.atHome ? ` · ${t("development.plans.atHomeShort")}` : ""}
                    {a.currentWeek ? ` · ${t("development.plans.currentWeek", { week: a.currentWeek, weeks: a.weeks })}` : ""}
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  {a.status !== "active" && <Badge>{t.dynamic(`development.assignmentStatus.${a.status}`, undefined, a.status)}</Badge>}
                  {staff && <AssignmentStatusButton id={a.id} status={a.status} />}
                </span>
              </div>
              {a.planDescription && <p className="text-sm text-ink-2">{a.planDescription}</p>}
              {a.notes && <p className="text-sm text-ink-3">{a.notes}</p>}
              <PlanWeekView assignment={a} canCheck={a.status === "active"} />
            </section>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Salad className="h-4 w-4 text-maroon" /> {t("development.nutrition.title")}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <p className="rounded border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">{t("development.nutrition.disclaimer")}</p>
          {data.nutrition.length === 0 ? <p className="text-sm text-ink-3">{t("development.nutrition.noneAssigned")}</p> : data.nutrition.map((n) => (
            <section key={n.id} className="space-y-2">
              <h3 className="font-medium text-ink">{n.name}</h3>
              {n.description && <p className="text-sm text-ink-2">{n.description}</p>}
              {n.hydrationMl !== null && <p className="text-sm text-ink-2">{t("development.nutrition.hydrationTarget", { amount: f.number(n.hydrationMl / 1000, { maximumFractionDigits: 2 }) })}</p>}
              {n.meals.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {n.meals.map((m, i) => (
                    <li key={i} className="flex flex-wrap gap-2">
                      <span className="w-40 shrink-0 text-xs text-ink-4">{m.day === 0 ? t("development.nutrition.everyDay") : t("development.plans.dayN", { day: m.day })} · {t.dynamic(`development.meals.${m.meal}`, undefined, m.meal)}</span>
                      <span className="text-ink-2">{m.description}</span>
                    </li>
                  ))}
                </ul>
              )}
              {n.guidelines && <p className="whitespace-pre-line text-sm text-ink-3">{n.guidelines}</p>}
            </section>
          ))}
        </CardBody>
      </Card>

      {(data.wellnessEnabled || data.wellness.length > 0) && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><HeartPulse className="h-4 w-4 text-maroon" /> {t("development.wellness.title")}</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            {data.wellnessEnabled && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-4">{t("development.wellness.today")}</h3>
                <WellnessForm athleteId={data.athlete.id} today={today} existing={todayWellness} />
              </div>
            )}
            {data.wellness.length > 0 && (
              <ul className="space-y-1 text-sm">
                {data.wellness.slice(0, 14).map((w) => (
                  <li key={w.date} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-1.5 last:border-0">
                    <span className="text-ink-2">{f.date(w.date, { weekday: true })}</span>
                    <span className="flex flex-wrap items-center gap-1 text-xs text-ink-3">
                      {t("development.wellness.summary", { sleep: w.sleep, energy: w.energy, soreness: w.soreness, mood: w.mood })}
                      {w.flags.map((fl) => <Badge key={fl} tone="warning">{t.dynamic(`development.wellness.flags.${fl}`, undefined, fl)}</Badge>)}
                    </span>
                    {w.note && <span className="w-full text-xs text-ink-4">{w.note}</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-ink-4">{t("development.wellness.privacy")}</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
