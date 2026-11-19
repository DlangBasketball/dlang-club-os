import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, ClipboardList, Dumbbell, HeartPulse, Plus, Salad, Trophy, Users } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, ErrorState, PageHeader, StatCard, StatGrid } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { termOr } from "@/lib/tenant/terms";
import {
  getAthleteDevelopment, getCoachRankings, getDevSettings, getPlan, getRankings, getRoster, getTemplate, getViewer, getWellnessBoard,
  listExercises, listNutritionPlans, listPlans, listTemplates,
} from "@/lib/development/data";
import { AthleteDevelopmentView, levelName } from "./athlete-view";
import { EvaluationForm, TemplateEditor } from "./assessment-forms";
import { AssignPlanForm, ExerciseForm, ExerciseVideo, PlanEditor } from "./plan-forms";
import { AssignNutritionForm, NutritionEditor, UnassignNutritionButton } from "./nutrition-forms";
import { DevelopmentSettingsForm, TeamWellnessToggle } from "./settings-forms";

/** Today (yyyy-mm-dd) in the club's time zone. */
export function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const TABS = [
  { href: "", key: "overview" },
  { href: "/assessments", key: "assessments" },
  { href: "/evaluate", key: "evaluate" },
  { href: "/rankings", key: "rankings" },
  { href: "/exercises", key: "exercises" },
  { href: "/plans", key: "plans" },
  { href: "/nutrition", key: "nutrition" },
  { href: "/wellness", key: "wellness" },
] as const;

export async function DevNav({ base, active, isAdmin }: { base: string; active: string; isAdmin: boolean }) {
  const { t } = await getI18n();
  const tabs: { href: string; key: string }[] = [...TABS];
  if (isAdmin) tabs.push({ href: "/settings", key: "settings" });
  const hrefOf = (tab: { href: string; key: string }) => (tab.key === "settings" ? "/admin/development/settings" : `${base}${tab.href}`);
  return (
    <nav aria-label={t("development.title")} className="-mx-1 mb-5 flex gap-1 overflow-x-auto pb-1">
      {tabs.map((tab) => (
        <Link key={tab.key} href={hrefOf(tab)} aria-current={active === tab.key ? "page" : undefined}
          className={`touch-target whitespace-nowrap rounded border px-3 py-1.5 text-sm ${active === tab.key ? "border-brand-primary bg-brand-primary-soft text-brand-primary" : "border-transparent text-text-muted hover:bg-surface hover:text-text"}`}>
          {t.dynamic(`development.tabs.${tab.key}`, undefined, tab.key)}
        </Link>
      ))}
    </nav>
  );
}

async function athleteTerm(fallback: string, plural = false) {
  try {
    const { terminology } = await getTenant();
    return termOr(terminology, "athlete", fallback, { plural });
  } catch {
    return fallback;
  }
}

const back = (href: string, label: string) => (
  <Link href={href} className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {label}</Link>
);

// ---------------------------------------------------------------------------
export async function DevHubPage({ base, isAdmin }: { base: string; isAdmin: boolean }) {
  const { t } = await getI18n();
  const [roster, templates, plans, wellness] = await Promise.all([getRoster(), listTemplates({ activeOnly: true }), listPlans(), getWellnessBoard(1)]);
  if (roster.error !== null) return <ErrorState title={t("development.common.loadFailed")} message={roster.error} />;
  const flagged = (wellness.data?.rows ?? []).filter((r) => r.flags.length > 0);
  const athletesLabel = await athleteTerm(t("development.common.athletes"), true);
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("development.title")} description={t("development.description")}
        actions={<Link href={`${base}/evaluate`}><Button size="sm"><Plus className="h-4 w-4" /> {t("development.evaluate.new")}</Button></Link>} />
      <DevNav base={base} active="overview" isAdmin={isAdmin} />
      <StatGrid>
        <StatCard label={athletesLabel} value={String(roster.data.athletes.length)} href={`${base}/rankings`} />
        <StatCard label={t("development.tabs.assessments")} value={String(templates.data?.length ?? 0)} href={`${base}/assessments`} />
        <StatCard label={t("development.tabs.plans")} value={String((plans.data ?? []).filter((p) => p.isActive).length)} href={`${base}/plans`} />
        <StatCard label={t("development.wellness.flaggedToday")} value={String(flagged.length)} tone={flagged.length ? "warning" : "success"} href={`${base}/wellness`} />
      </StatGrid>

      {flagged.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><HeartPulse className="h-4 w-4 text-warning" /> {t("development.wellness.flaggedToday")}</CardTitle></CardHeader>
          <CardBody className="space-y-1">
            {flagged.map((r) => (
              <Link key={r.athleteId} href={`${base}/athletes/${r.athleteId}`} className="flex flex-wrap items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-elevated">
                <span className="text-ink">{r.name}</span>
                <span className="flex flex-wrap gap-1">{r.flags.map((fl) => <Badge key={fl} tone="warning">{t.dynamic(`development.wellness.flags.${fl}`, undefined, fl)}</Badge>)}</span>
              </Link>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-4 w-4 text-maroon" /> {athletesLabel}</CardTitle></CardHeader>
        <CardBody className="p-0">
          {roster.data.athletes.length === 0 ? <div className="p-5"><EmptyState icon={<Users className="h-5 w-5" />} title={t("development.common.noAthletes")} /></div> : (
            <ul>
              {roster.data.athletes.map((a) => (
                <li key={a.id} className="border-b border-line-soft last:border-0">
                  <Link href={`${base}/athletes/${a.id}`} className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-surface-elevated">
                    <span className="text-ink">{a.name}{a.age !== null && <span className="ml-2 text-xs text-ink-4">{t("development.common.ageYears", { age: a.age })}</span>}</span>
                    <ChevronRight className="h-4 w-4 text-ink-4" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
export async function AssessmentsPage({ base, isAdmin }: { base: string; isAdmin: boolean }) {
  const { t } = await getI18n();
  const res = await listTemplates();
  if (res.error !== null) return <ErrorState title={t("development.common.loadFailed")} message={res.error} />;
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("development.assessments.title")} description={t("development.assessments.description")}
        actions={<Link href={`${base}/assessments/new`}><Button size="sm"><Plus className="h-4 w-4" /> {t("development.assessments.new")}</Button></Link>} />
      <DevNav base={base} active="assessments" isAdmin={isAdmin} />
      {res.data.length === 0 ? <EmptyState icon={<ClipboardList className="h-5 w-5" />} title={t("development.assessments.empty")} description={t("development.assessments.emptyHint")} /> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {res.data.map((tpl) => (
            <Link key={tpl.id} href={`${base}/assessments/${tpl.id}`}>
              <Card className="h-full transition hover:border-maroon/40"><CardBody className="space-y-1">
                <div className="flex items-center justify-between gap-2"><span className="font-medium text-ink">{tpl.name}</span>{!tpl.isActive && <Badge>{t("development.common.inactive")}</Badge>}</div>
                <div className="text-xs text-ink-3">{[tpl.sport, tpl.ageGroup, tpl.ageMin !== null || tpl.ageMax !== null ? t("development.common.ageRange", { min: tpl.ageMin ?? "–", max: tpl.ageMax ?? "–" }) : null].filter(Boolean).join(" · ")}</div>
                <div className="text-xs text-ink-4">{t("development.assessments.itemCount", { count: tpl.items.length })}</div>
              </CardBody></Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export async function TemplatePage({ base, id, isAdmin }: { base: string; id: string; isAdmin: boolean }) {
  const { t } = await getI18n();
  let template = null;
  if (id !== "new") {
    const res = await getTemplate(id);
    if (res.error !== null) return <ErrorState title={t("development.common.loadFailed")} message={res.error} />;
    if (!res.data) notFound();
    template = res.data;
  }
  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      {back(`${base}/assessments`, t("development.assessments.title"))}
      <PageHeader title={template ? template.name : t("development.assessments.new")} description={t("development.assessments.builderHint")} />
      <DevNav base={base} active="assessments" isAdmin={isAdmin} />
      <Card><CardBody><TemplateEditor base={base} template={template} /></CardBody></Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
export async function EvaluatePage({ base, isAdmin, athleteId, teamId }: { base: string; isAdmin: boolean; athleteId?: string; teamId?: string }) {
  const { t, f } = await getI18n();
  const [roster, templates] = await Promise.all([getRoster(), listTemplates({ activeOnly: true })]);
  if (roster.error !== null) return <ErrorState title={t("development.common.loadFailed")} message={roster.error} />;
  return (
    <div className="animate-fade-up max-w-5xl space-y-5">
      <PageHeader title={t("development.evaluate.title")} description={t("development.evaluate.description")} />
      <DevNav base={base} active="evaluate" isAdmin={isAdmin} />
      <Card><CardBody>
        <EvaluationForm base={base} templates={templates.data ?? []} athletes={roster.data.athletes.map((a) => ({ id: a.id, name: a.name }))}
          teams={roster.data.teams.filter((x) => x.athleteIds.length > 0)} initialAthleteId={athleteId ?? null} initialTeamId={teamId ?? null} today={todayIn(f.timeZone)} />
      </CardBody></Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
export async function AthletePage({ base, id, view, isAdmin }: { base: string; id: string; view: string | undefined; isAdmin: boolean }) {
  const { t, f } = await getI18n();
  const res = await getAthleteDevelopment(id);
  if (res.error !== null) return <ErrorState title={t("development.common.loadFailed")} message={res.error} />;
  if (!res.data) notFound();
  const v = view === "month" || view === "year" ? view : "all";
  return (
    <div className="animate-fade-up max-w-5xl space-y-5">
      {back(base, t("development.title"))}
      <PageHeader title={res.data.athlete.name}
        description={[res.data.athlete.age !== null ? t("development.common.ageYears", { age: res.data.athlete.age }) : null, res.data.athlete.level].filter(Boolean).join(" · ") || undefined}
        actions={<Link href={`${base}/evaluate?athlete=${id}`}><Button size="sm"><Plus className="h-4 w-4" /> {t("development.evaluate.new")}</Button></Link>} />
      <AthleteDevelopmentView data={res.data} mode="staff" base={base} view={v} today={todayIn(f.timeZone)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
export async function RankingsPage({ base, isAdmin, group }: { base: string; isAdmin: boolean; group?: string }) {
  const { t, f } = await getI18n();
  const [res, coaches] = await Promise.all([getRankings(group ?? null), isAdmin ? getCoachRankings() : Promise.resolve(null)]);
  if (res.error !== null) return <ErrorState title={t("development.common.loadFailed")} message={res.error} />;
  const athleteLabel = await athleteTerm(t("development.common.athlete"));
  const pct = (v: number | null) => (v === null ? "—" : f.percent(v / 100, 0));
  const num = (v: number | null) => (v === null ? "—" : f.number(v, { maximumFractionDigits: 0 }));
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("development.rankings.title")} description={t("development.rankings.description", { attendance: f.number(res.data.weights.attendance), evaluation: f.number(res.data.weights.evaluation), days: res.data.windowDays })} />
      <DevNav base={base} active="rankings" isAdmin={isAdmin} />
      <p className="rounded border border-info/30 bg-info-soft px-3 py-2 text-xs text-info">{t("development.rankings.privacy")}</p>
      {res.data.groups.length === 0 ? <EmptyState icon={<Trophy className="h-5 w-5" />} title={t("development.rankings.noGroups")} /> : (
        <>
          <nav className="flex flex-wrap gap-1" aria-label={t("development.rankings.groups")}>
            {res.data.groups.map((g) => (
              <Link key={g.key} href={`${base}/rankings?group=${encodeURIComponent(g.key)}`} aria-current={g.key === res.data.selected ? "page" : undefined}
                className={`rounded border px-3 py-1 text-sm ${g.key === res.data.selected ? "border-brand-primary bg-brand-primary-soft text-brand-primary" : "border-border text-text-muted hover:text-text"}`}>{g.name}</Link>
            ))}
          </nav>
          <Card>
            <CardBody className="overflow-x-auto p-0">
              <table className="w-full min-w-[560px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-4">
                  <th scope="col" className="px-4 py-2">#</th><th scope="col" className="px-4 py-2">{athleteLabel}</th>
                  <th scope="col" className="px-4 py-2 text-right">{t("development.progress.attendance")}</th>
                  <th scope="col" className="px-4 py-2 text-right">{t("development.progress.latestEvaluation")}</th>
                  <th scope="col" className="px-4 py-2 text-right">{t("development.progress.score")}</th>
                  <th scope="col" className="px-4 py-2">{t("development.rankings.level")}</th>
                </tr></thead>
                <tbody>
                  {res.data.rows.map((r) => (
                    <tr key={r.athleteId} className="border-b border-line-soft last:border-0">
                      <td className="tnum px-4 py-2 text-ink-3">{r.position ?? "—"}</td>
                      <td className="px-4 py-2"><Link href={`${base}/athletes/${r.athleteId}`} className="text-ink hover:text-maroon">{r.name}</Link>
                        {r.band && <Badge className="ml-2" tone={r.band === "top10" || r.band === "top25" ? "accent" : "neutral"}>{t.dynamic(`development.bands.${r.band}`, undefined, r.band)}</Badge>}</td>
                      <td className="tnum px-4 py-2 text-right">{pct(r.attendanceRate)}</td>
                      <td className="tnum px-4 py-2 text-right">{num(r.evaluationScore)}</td>
                      <td className="tnum px-4 py-2 text-right font-medium">{num(r.score)}</td>
                      <td className="px-4 py-2"><span aria-hidden>{r.level.tier.emoji}</span> <span className="text-xs text-ink-3">{levelName(t, r.level.tier, r.level.index)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        </>
      )}

      {coaches && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Trophy className="h-4 w-4 text-gold" /> {t("development.rankings.coachTitle")}</CardTitle></CardHeader>
          <CardBody className="overflow-x-auto p-0">
            {coaches.error !== null ? <p className="p-4 text-sm text-danger">{coaches.error}</p> : coaches.data.length === 0 ? <p className="p-4 text-sm text-ink-3">{t("development.rankings.noCoaches")}</p> : (
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-4">
                  <th scope="col" className="px-4 py-2">#</th><th scope="col" className="px-4 py-2">{t("development.rankings.coach")}</th>
                  <th scope="col" className="px-4 py-2 text-right">{t("development.rankings.sessions")}</th>
                  <th scope="col" className="px-4 py-2 text-right">{t("development.progress.attendance")}</th>
                  <th scope="col" className="px-4 py-2 text-right">{t("development.rankings.feedback")}</th>
                  <th scope="col" className="px-4 py-2 text-right">{t("development.progress.score")}</th>
                </tr></thead>
                <tbody>
                  {coaches.data.map((c) => (
                    <tr key={c.coachId} className="border-b border-line-soft last:border-0">
                      <td className="tnum px-4 py-2 text-ink-3">{c.position}</td>
                      <td className="px-4 py-2 text-ink">{c.name}</td>
                      <td className="tnum px-4 py-2 text-right">{f.number(c.sessionsDelivered)}</td>
                      <td className="tnum px-4 py-2 text-right">{pct(c.attendanceRate)}</td>
                      <td className="tnum px-4 py-2 text-right">{c.feedbackAvg === null ? "—" : f.number(c.feedbackAvg, { maximumFractionDigits: 1 })}</td>
                      <td className="tnum px-4 py-2 text-right font-medium">{num(c.score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export async function ExercisesPage({ base, isAdmin, edit }: { base: string; isAdmin: boolean; edit?: string }) {
  const { t } = await getI18n();
  const [res, viewer] = await Promise.all([listExercises(), getViewer()]);
  if (res.error !== null) return <ErrorState title={t("development.common.loadFailed")} message={res.error} />;
  const editing = edit ? res.data.find((e) => e.id === edit) ?? null : null;
  const canEdit = (createdBy: string | null) => isAdmin || createdBy === viewer?.me.id;
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("development.exercises.title")} description={t("development.exercises.description")} />
      <DevNav base={base} active="exercises" isAdmin={isAdmin} />
      <Card>
        <CardHeader><CardTitle>{editing ? t("development.exercises.edit", { name: editing.name }) : t("development.exercises.new")}</CardTitle></CardHeader>
        <CardBody>
          <ExerciseForm key={editing?.id ?? "new"} exercise={editing} />
          {editing && <Link href={`${base}/exercises`} className="mt-3 inline-block text-xs text-ink-3 hover:text-ink">{t("development.exercises.newInstead")}</Link>}
        </CardBody>
      </Card>
      {res.data.length === 0 ? <EmptyState icon={<Dumbbell className="h-5 w-5" />} title={t("development.exercises.empty")} /> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {res.data.map((e) => (
            <Card key={e.id}><CardBody className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">{e.name}</span>
                <span className="flex flex-wrap gap-1">
                  <Badge>{t.dynamic(`development.categories.${e.category}`, undefined, e.category)}</Badge>
                  <Badge tone="accent">{t.dynamic(`development.levels.${e.difficulty}`, undefined, e.difficulty)}</Badge>
                  {!e.isActive && <Badge>{t("development.common.inactive")}</Badge>}
                </span>
              </div>
              <div className="text-xs text-ink-3">{[e.sport, e.equipment.join(", ")].filter(Boolean).join(" · ")}</div>
              {e.description && <p className="line-clamp-3 text-sm text-ink-2">{e.description}</p>}
              <ExerciseVideo exerciseId={e.id} videoUrl={e.videoUrl} hasVideo={e.hasVideo} title={e.name} />
              {canEdit(e.createdBy) && <Link href={`${base}/exercises?edit=${e.id}`} className="inline-block text-xs text-maroon hover:underline">{t("development.common.edit")}</Link>}
            </CardBody></Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export async function PlansPage({ base, isAdmin }: { base: string; isAdmin: boolean }) {
  const { t } = await getI18n();
  const res = await listPlans();
  if (res.error !== null) return <ErrorState title={t("development.common.loadFailed")} message={res.error} />;
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("development.plans.title")} description={t("development.plans.description")}
        actions={<Link href={`${base}/plans/new`}><Button size="sm"><Plus className="h-4 w-4" /> {t("development.plans.new")}</Button></Link>} />
      <DevNav base={base} active="plans" isAdmin={isAdmin} />
      {res.data.length === 0 ? <EmptyState icon={<Dumbbell className="h-5 w-5" />} title={t("development.plans.empty")} /> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {res.data.map((p) => (
            <Link key={p.id} href={`${base}/plans/${p.id}`}>
              <Card className="h-full transition hover:border-maroon/40"><CardBody className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">{p.name}</span>
                  <span className="flex flex-wrap gap-1">
                    {p.isTemplate ? <Badge tone="info">{t("development.plans.templateBadge")}</Badge> : <Badge>{t("development.plans.clientBadge")}</Badge>}
                    {p.autoAssign && <Badge tone="accent">{t("development.plans.autoBadge")}</Badge>}
                    {!p.isActive && <Badge>{t("development.common.inactive")}</Badge>}
                  </span>
                </div>
                <div className="text-xs text-ink-3">
                  {[p.sport, p.level ? t.dynamic(`development.levels.${p.level}`, undefined, p.level) : null, p.ageMin !== null || p.ageMax !== null ? t("development.common.ageRange", { min: p.ageMin ?? "–", max: p.ageMax ?? "–" }) : null].filter(Boolean).join(" · ")}
                </div>
                <div className="text-xs text-ink-4">{t("development.plans.summary", { weeks: p.weeks, items: p.itemCount, athletes: p.activeAssignments })}</div>
              </CardBody></Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export async function PlanPage({ base, id, isAdmin }: { base: string; id: string; isAdmin: boolean }) {
  const { t, f } = await getI18n();
  const [exercises, roster] = await Promise.all([listExercises(), getRoster()]);
  let plan = null;
  if (id !== "new") {
    const res = await getPlan(id);
    if (res.error !== null) return <ErrorState title={t("development.common.loadFailed")} message={res.error} />;
    if (!res.data) notFound();
    plan = res.data;
  }
  return (
    <div className="animate-fade-up max-w-5xl space-y-5">
      {back(`${base}/plans`, t("development.plans.title"))}
      <PageHeader title={plan ? plan.name : t("development.plans.new")} description={t("development.plans.builderHint")} />
      <DevNav base={base} active="plans" isAdmin={isAdmin} />
      <Card><CardBody><PlanEditor base={base} plan={plan} exercises={exercises.data ?? []} /></CardBody></Card>
      {plan && (
        <>
          <Card>
            <CardHeader><CardTitle>{t("development.plans.assignTitle")}</CardTitle></CardHeader>
            <CardBody>
              <AssignPlanForm planId={plan.id} athletes={(roster.data?.athletes ?? []).map((a) => ({ id: a.id, name: a.name }))} teams={roster.data?.teams ?? []}
                today={todayIn(f.timeZone)} canAutoAssign={plan.isTemplate && plan.autoAssign && plan.isActive} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("development.plans.assignedTo")}</CardTitle></CardHeader>
            <CardBody className="p-0">
              {plan.assignments.length === 0 ? <p className="p-5 text-sm text-ink-3">{t("development.plans.noAssignments")}</p> : (
                <ul>
                  {plan.assignments.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-5 py-2.5 text-sm last:border-0">
                      <Link href={`${base}/athletes/${a.athleteId}`} className="text-ink hover:text-maroon">{a.athleteName}</Link>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                        {t("development.plans.since", { date: f.date(a.startsOn) })}
                        <Badge tone={a.source === "auto" ? "accent" : "neutral"}>{t.dynamic(`development.assignmentSource.${a.source}`, undefined, a.source)}</Badge>
                        <Badge tone={a.status === "active" ? "success" : "neutral"}>{t.dynamic(`development.assignmentStatus.${a.status}`, undefined, a.status)}</Badge>
                        {t("development.plans.itemsDone", { count: a.done })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export async function NutritionPage({ base, isAdmin }: { base: string; isAdmin: boolean }) {
  const { t } = await getI18n();
  const res = await listNutritionPlans();
  if (res.error !== null) return <ErrorState title={t("development.common.loadFailed")} message={res.error} />;
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("development.nutrition.title")} description={t("development.nutrition.description")}
        actions={<Link href={`${base}/nutrition/new`}><Button size="sm"><Plus className="h-4 w-4" /> {t("development.nutrition.new")}</Button></Link>} />
      <DevNav base={base} active="nutrition" isAdmin={isAdmin} />
      <p className="rounded border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">{t("development.nutrition.disclaimer")}</p>
      {res.data.length === 0 ? <EmptyState icon={<Salad className="h-5 w-5" />} title={t("development.nutrition.empty")} /> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {res.data.map((p) => (
            <Link key={p.id} href={`${base}/nutrition/${p.id}`}>
              <Card className="h-full transition hover:border-maroon/40"><CardBody className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">{p.name}</span>
                  <span className="flex gap-1">{p.athleteName ? <Badge>{p.athleteName}</Badge> : <Badge tone="info">{t("development.nutrition.template")}</Badge>}{!p.isActive && <Badge>{t("development.common.inactive")}</Badge>}</span>
                </div>
                <div className="text-xs text-ink-3">{p.ageMin !== null || p.ageMax !== null ? t("development.common.ageRange", { min: p.ageMin ?? "–", max: p.ageMax ?? "–" }) : ""}</div>
                <div className="text-xs text-ink-4">{t("development.nutrition.summary", { meals: p.meals.length, athletes: p.assignments.length })}</div>
              </CardBody></Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export async function NutritionEditPage({ base, id, isAdmin }: { base: string; id: string; isAdmin: boolean }) {
  const { t, f } = await getI18n();
  const [res, roster] = await Promise.all([listNutritionPlans(), getRoster()]);
  if (res.error !== null) return <ErrorState title={t("development.common.loadFailed")} message={res.error} />;
  const plan = id === "new" ? null : res.data.find((p) => p.id === id) ?? null;
  if (id !== "new" && !plan) notFound();
  const athletes = (roster.data?.athletes ?? []).map((a) => ({ id: a.id, name: a.name }));
  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      {back(`${base}/nutrition`, t("development.nutrition.title"))}
      <PageHeader title={plan ? plan.name : t("development.nutrition.new")} description={t("development.nutrition.disclaimer")} />
      <DevNav base={base} active="nutrition" isAdmin={isAdmin} />
      <Card><CardBody><NutritionEditor base={base} plan={plan} athletes={athletes} /></CardBody></Card>
      {plan && (
        <Card>
          <CardHeader><CardTitle>{t("development.plans.assignTitle")}</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <AssignNutritionForm planId={plan.id} athletes={athletes} teams={roster.data?.teams ?? []} today={todayIn(f.timeZone)} />
            {plan.assignments.length > 0 && (
              <ul className="space-y-1">
                {plan.assignments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-1.5 text-sm last:border-0">
                    <Link href={`${base}/athletes/${a.athleteId}`} className="text-ink hover:text-maroon">{a.athleteName}</Link>
                    <span className="flex items-center gap-2 text-xs text-ink-3">{t("development.plans.since", { date: f.date(a.startsOn) })}<UnassignNutritionButton id={a.id} /></span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export async function WellnessPage({ base, isAdmin }: { base: string; isAdmin: boolean }) {
  const { t, f } = await getI18n();
  const res = await getWellnessBoard(7);
  if (res.error !== null) return <ErrorState title={t("development.common.loadFailed")} message={res.error} />;
  const flagged = res.data.rows.filter((r) => r.flags.length > 0);
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("development.wellness.title")} description={t("development.wellness.description")} />
      <DevNav base={base} active="wellness" isAdmin={isAdmin} />
      {res.data.enabledTeams === 0 ? (
        <EmptyState icon={<HeartPulse className="h-5 w-5" />} title={t("development.wellness.noTeams")} description={isAdmin ? t("development.wellness.enableHint") : undefined}
          action={isAdmin ? <Link href="/admin/development/settings"><Button size="sm" variant="secondary">{t("development.tabs.settings")}</Button></Link> : undefined} />
      ) : (
        <>
          <StatGrid>
            <StatCard label={t("development.wellness.flaggedWeek")} value={String(flagged.length)} tone={flagged.length ? "warning" : "success"} />
            <StatCard label={t("development.wellness.checkinsWeek")} value={String(res.data.rows.length)} />
            <StatCard label={t("development.wellness.missingToday")} value={String(res.data.missingToday.length)} />
          </StatGrid>
          <Card>
            <CardHeader><CardTitle>{t("development.wellness.recent")}</CardTitle></CardHeader>
            <CardBody className="overflow-x-auto p-0">
              {res.data.rows.length === 0 ? <p className="p-5 text-sm text-ink-3">{t("development.wellness.none")}</p> : (
                <table className="w-full min-w-[560px] text-sm">
                  <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-4">
                    <th scope="col" className="px-4 py-2">{t("development.common.date")}</th>
                    <th scope="col" className="px-4 py-2">{t("development.common.athlete")}</th>
                    <th scope="col" className="px-4 py-2">{t("development.wellness.answers")}</th>
                    <th scope="col" className="px-4 py-2 text-right">{t("development.wellness.readiness")}</th>
                    <th scope="col" className="px-4 py-2">{t("development.wellness.flagsTitle")}</th>
                  </tr></thead>
                  <tbody>
                    {res.data.rows.map((r) => (
                      <tr key={`${r.athleteId}-${r.date}`} className={`border-b border-line-soft last:border-0 ${r.flags.length ? "bg-warning-soft" : ""}`}>
                        <td className="px-4 py-2 text-ink-3">{f.date(r.date, { weekday: true })}</td>
                        <td className="px-4 py-2"><Link href={`${base}/athletes/${r.athleteId}`} className="text-ink hover:text-maroon">{r.name}</Link>{r.note && <div className="text-xs text-ink-4">{r.note}</div>}</td>
                        <td className="px-4 py-2 text-xs text-ink-3">{t("development.wellness.summary", { sleep: r.sleep, energy: r.energy, soreness: r.soreness, mood: r.mood })}</td>
                        <td className="tnum px-4 py-2 text-right">{f.number(r.readiness)}</td>
                        <td className="px-4 py-2"><span className="flex flex-wrap gap-1">{r.flags.map((fl) => <Badge key={fl} tone="warning">{t.dynamic(`development.wellness.flags.${fl}`, undefined, fl)}</Badge>)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>
          {res.data.missingToday.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{t("development.wellness.missingToday")}</CardTitle></CardHeader>
              <CardBody className="flex flex-wrap gap-2">
                {res.data.missingToday.map((m) => <Link key={m.athleteId} href={`${base}/athletes/${m.athleteId}`}><Badge>{m.name}</Badge></Link>)}
              </CardBody>
            </Card>
          )}
          <p className="text-xs text-ink-4">{t("development.wellness.privacy")}</p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export async function SettingsPage({ base }: { base: string }) {
  const { t } = await getI18n();
  const [settings, roster] = await Promise.all([getDevSettings(), getRoster()]);
  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <PageHeader title={t("development.settings.title")} description={t("development.settings.description")} />
      <DevNav base={base} active="settings" isAdmin />
      <Card>
        <CardHeader><CardTitle>{t("development.settings.rankingTitle")}</CardTitle></CardHeader>
        <CardBody>
          <DevelopmentSettingsForm initial={{ attendance: settings.weights.attendance, evaluation: settings.weights.evaluation, windowDays: settings.windowDays, familyRankVisible: settings.familyRankVisible, levels: settings.levels }} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("development.settings.wellnessTitle")}</CardTitle></CardHeader>
        <CardBody className="p-0">
          <p className="px-5 pt-4 text-xs text-ink-3">{t("development.settings.wellnessHint")}</p>
          {(roster.data?.teams ?? []).length === 0 ? <p className="p-5 text-sm text-ink-3">{t("development.rankings.noGroups")}</p> : (
            <ul className="mt-2">
              {(roster.data?.teams ?? []).map((tm) => (
                <li key={tm.id} className="flex items-center justify-between gap-2 border-t border-line-soft px-5 py-2.5 text-sm">
                  <span className="text-ink">{tm.name}<span className="ml-2 text-xs text-ink-4">{[tm.sport, tm.ageGroup].filter(Boolean).join(" · ")}</span></span>
                  <TeamWellnessToggle teamId={tm.id} enabled={tm.wellnessEnabled} label={t("development.settings.wellnessFor", { team: tm.name })} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
