import "server-only";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { devAdminDb, devDb, type DevClient, type ItemRow } from "./db";
import { DEFAULT_LEVELS, DEFAULT_WEIGHTS, attendanceRate, combinedScore, levelFor, normalizeLevels, rankCoaches, rankGroup, type CoachRankRow, type LevelTier, type RankBand, type RankRow, type RankingWeights } from "./ranking";
import { ageOn, overallScore, type ItemKind } from "./scoring";
import { athleteLevel, type AthleteFacts, type PlanCriteria } from "./matching";
import { wellnessFlags, readiness, type WellnessFlag } from "./wellness";
import { currentWeek } from "./plan";

/**
 * Server reads for athlete development. RLS decides what each caller sees
 * (admin: club; coach: their athletes; guardian: own children and only
 * shared evaluations); the org is never taken from the client. The service
 * role is used only to compute a child's rank band among their group, after
 * the caller's access to that child was checked with their own session, and
 * only the band leaves the server (never other children's names or scores).
 */

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(d: T): Result<T> => ({ data: d, error: null });
const fail = (e: string): Result<never> => ({ data: null, error: e });
const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => Boolean(x))));
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const fullName = (a: { first_name: string; last_name: string }) => `${a.first_name} ${a.last_name}`.trim();

export type Viewer = { me: SessionUser & { orgId: string }; isAdmin: boolean; isCoach: boolean; isParent: boolean };
export async function getViewer(): Promise<Viewer | null> {
  const me = await getSessionUser();
  if (!me?.orgId) return null;
  return { me: me as Viewer["me"], isAdmin: me.roles.includes("admin"), isCoach: me.roles.includes("coach"), isParent: me.roles.includes("parent") };
}

// ---- Settings ------------------------------------------------------------------
export type DevSettings = { weights: RankingWeights; windowDays: number; levels: LevelTier[]; familyRankVisible: boolean };
export const DEFAULT_DEV_SETTINGS: DevSettings = { weights: DEFAULT_WEIGHTS, windowDays: 90, levels: DEFAULT_LEVELS, familyRankVisible: true };

export async function getDevSettings(db?: DevClient, orgId?: string): Promise<DevSettings> {
  const client = db ?? (await devDb());
  let q = client.from("development_settings").select("attendance_weight,evaluation_weight,window_days,levels,family_rank_visible");
  if (orgId) q = q.eq("org_id", orgId);
  const { data } = await q.maybeSingle();
  if (!data) return DEFAULT_DEV_SETTINGS;
  return {
    weights: { attendance: Number(data.attendance_weight), evaluation: Number(data.evaluation_weight) },
    windowDays: data.window_days,
    levels: normalizeLevels(data.levels),
    familyRankVisible: data.family_rank_visible,
  };
}

// ---- Roster (athletes and teams the caller may work with) ----------------------
export type RosterAthlete = { id: string; name: string; dob: string | null; age: number | null; teamIds: string[] };
export type RosterTeam = { id: string; name: string; sport: string | null; ageGroup: string | null; wellnessEnabled: boolean; athleteIds: string[] };
export type Roster = { athletes: RosterAthlete[]; teams: RosterTeam[]; programs: { id: string; name: string; athleteIds: string[] }[] };

export async function getRoster(): Promise<Result<Roster>> {
  const db = await devDb();
  const [ath, teams, members, regs] = await Promise.all([
    db.from("athletes").select("id,first_name,last_name,dob,status").neq("status", "archived").order("last_name").order("first_name"),
    db.from("teams").select("id,name,sport,age_group,is_active,wellness_enabled").eq("is_active", true).order("name"),
    db.from("team_memberships").select("team_id,athlete_id,status").neq("status", "inactive"),
    db.from("registrations").select("program_id,athlete_id,status,programs(id,name,is_active)").in("status", ["confirmed", "completed"]),
  ]);
  if (ath.error) return fail(ath.error.message);
  const t = today();
  const byTeam = new Map<string, string[]>();
  for (const m of members.data ?? []) byTeam.set(m.team_id, [...(byTeam.get(m.team_id) ?? []), m.athlete_id]);
  const athleteIds = new Set((ath.data ?? []).map((a) => a.id));
  const athletes: RosterAthlete[] = (ath.data ?? []).map((a) => ({
    id: a.id, name: fullName(a), dob: a.dob, age: ageOn(a.dob, t),
    teamIds: (members.data ?? []).filter((m) => m.athlete_id === a.id).map((m) => m.team_id),
  }));
  const programs = new Map<string, { id: string; name: string; athleteIds: string[] }>();
  for (const r of (regs.data ?? []) as unknown as { program_id: string; athlete_id: string; programs: { id: string; name: string; is_active: boolean } | null }[]) {
    if (!r.programs?.is_active || !athleteIds.has(r.athlete_id)) continue;
    const p = programs.get(r.program_id) ?? { id: r.program_id, name: r.programs.name, athleteIds: [] };
    if (!p.athleteIds.includes(r.athlete_id)) p.athleteIds.push(r.athlete_id);
    programs.set(r.program_id, p);
  }
  return ok({
    athletes,
    teams: (teams.data ?? []).map((tm) => ({
      id: tm.id, name: tm.name, sport: tm.sport, ageGroup: tm.age_group, wellnessEnabled: tm.wellness_enabled,
      athleteIds: (byTeam.get(tm.id) ?? []).filter((id) => athleteIds.has(id)),
    })),
    programs: Array.from(programs.values()).sort((a, b) => a.name.localeCompare(b.name)),
  });
}

// ---- Assessment templates ----------------------------------------------------------
export type AssessmentItem = {
  id: string; kind: ItemKind; label: string; description: string | null; category: string | null; scaleMin: number; scaleMax: number;
  unit: string | null; higherIsBetter: boolean; weight: number; sortOrder: number;
};
export type AssessmentTemplate = {
  id: string; name: string; description: string | null; sport: string | null; ageGroup: string | null; ageMin: number | null; ageMax: number | null;
  isActive: boolean; createdBy: string | null; items: AssessmentItem[];
};
const mapItem = (i: ItemRow): AssessmentItem => ({
  id: i.id, kind: i.kind, label: i.label, description: i.description, category: i.category, scaleMin: i.scale_min, scaleMax: i.scale_max,
  unit: i.unit, higherIsBetter: i.higher_is_better, weight: Number(i.weight), sortOrder: i.sort_order,
});

export async function listTemplates(opts: { activeOnly?: boolean } = {}): Promise<Result<AssessmentTemplate[]>> {
  const db = await devDb();
  let q = db.from("assessment_templates").select("id,name,description,sport,age_group,age_min,age_max,is_active,created_by").order("name");
  if (opts.activeOnly) q = q.eq("is_active", true);
  const [tpl, items] = await Promise.all([q, db.from("assessment_items").select("*").order("sort_order")]);
  if (tpl.error) return fail(tpl.error.message);
  return ok((tpl.data ?? []).map((t) => ({
    id: t.id, name: t.name, description: t.description, sport: t.sport, ageGroup: t.age_group, ageMin: t.age_min, ageMax: t.age_max,
    isActive: t.is_active, createdBy: t.created_by,
    items: (items.data ?? []).filter((i) => i.template_id === t.id).map(mapItem),
  })));
}

export async function getTemplate(id: string): Promise<Result<AssessmentTemplate | null>> {
  const res = await listTemplates();
  if (res.error !== null) return res;
  return ok(res.data.find((t) => t.id === id) ?? null);
}

// ---- Athlete development profile ------------------------------------------------------
export type EvaluationView = {
  id: string; templateId: string; templateName: string; evaluatedOn: string; overallScore: number | null; comments: string | null;
  shared: boolean; coachName: string | null; canEdit: boolean;
  scores: { itemId: string; label: string; kind: ItemKind; unit: string | null; scaleMin: number; scaleMax: number; score: number | null; value: number | null; textValue: string | null }[];
};
export type PlanItemView = {
  id: string; week: number; day: number; sortOrder: number; title: string; exerciseId: string | null; description: string | null;
  category: string | null; videoUrl: string | null; hasVideo: boolean; equipment: string[]; sets: number | null; reps: number | null;
  durationSec: number | null; restSec: number | null; notes: string | null;
};
export type AssignmentView = {
  id: string; planId: string; planName: string; planDescription: string | null; weeks: number; startsOn: string; status: string;
  source: string; atHome: boolean; notes: string | null; currentWeek: number | null; items: PlanItemView[];
  completions: Record<string, { rating: number | null; comment: string | null; completedOn: string }>;
};
export type NutritionView = {
  id: string; name: string; description: string | null; hydrationMl: number | null; guidelines: string | null; clientSpecific: boolean;
  meals: { day: number; meal: string; description: string }[];
};
export type WellnessView = { date: string; sleep: number; energy: number; soreness: number; mood: number; note: string | null; flags: WellnessFlag[]; readiness: number };
export type AthleteDevelopment = {
  athlete: { id: string; name: string; dob: string | null; age: number | null; level: string | null };
  evaluations: EvaluationView[];
  measurements: { itemId: string; label: string; unit: string | null; points: { date: string; value: number }[] }[];
  assignments: AssignmentView[];
  nutrition: NutritionView[];
  wellness: WellnessView[];
  wellnessEnabled: boolean;
  attendanceRate: number | null;
  progressScore: number | null;
  level: { index: number; tier: LevelTier; next: LevelTier | null };
  levels: LevelTier[];
  ranks: { groupName: string; band: RankBand | null; position: number | null; size: number }[];
  familyRankVisible: boolean;
};

async function loadPlanItems(db: DevClient, planIds: string[]) {
  if (planIds.length === 0) return { items: [], exercises: new Map<string, { name: string; description: string | null; category: string; video_url: string | null; video_path: string | null; equipment: string[] }>() };
  const { data: items } = await db.from("training_plan_items").select("*").in("plan_id", planIds).order("week").order("day").order("sort_order");
  const exIds = uniq((items ?? []).map((i) => i.exercise_id));
  const { data: ex } = exIds.length ? await db.from("exercises").select("id,name,description,category,video_url,video_path,equipment").in("id", exIds) : { data: [] };
  return { items: items ?? [], exercises: new Map((ex ?? []).map((e) => [e.id, e])) };
}

/**
 * Full development profile. `familyView` limits it to what a guardian may see
 * (RLS already hides unshared evaluations) and returns rank bands only.
 */
export async function getAthleteDevelopment(athleteId: string, opts: { familyView?: boolean } = {}): Promise<Result<AthleteDevelopment | null>> {
  const viewer = await getViewer();
  if (!viewer) return fail("unauthenticated");
  const db = await devDb();
  const { data: a, error } = await db.from("athletes").select("id,org_id,first_name,last_name,dob").eq("id", athleteId).eq("org_id", viewer.me.orgId).maybeSingle();
  if (error) return fail(error.message);
  if (!a) return ok(null);
  const settings = await getDevSettings(db);
  const t = today();

  const [evals, assigns, nAssign, nOwn, well, profile, marks] = await Promise.all([
    db.from("evaluations").select("*").eq("athlete_id", athleteId).order("evaluated_on", { ascending: false }).limit(200),
    db.from("training_plan_assignments").select("*").eq("athlete_id", athleteId).neq("status", "cancelled").order("starts_on", { ascending: false }),
    db.from("nutrition_plan_assignments").select("plan_id,starts_on").eq("athlete_id", athleteId),
    db.from("nutrition_plans").select("id").eq("athlete_id", athleteId).eq("is_active", true),
    db.from("wellness_checkins").select("*").eq("athlete_id", athleteId).gte("checkin_date", daysAgo(60)).order("checkin_date", { ascending: false }),
    db.from("athlete_training_profiles").select("level").eq("athlete_id", athleteId).maybeSingle(),
    db.from("attendance_marks").select("status,attendance_sessions(session_date)").eq("athlete_id", athleteId),
  ]);

  // Evaluations + scores.
  const evalRows = evals.data ?? [];
  const evalIds = evalRows.map((e) => e.id);
  const tplIds = uniq(evalRows.map((e) => e.template_id));
  const [scores, items, tpls, coaches] = await Promise.all([
    evalIds.length ? db.from("evaluation_scores").select("*").in("evaluation_id", evalIds) : Promise.resolve({ data: [] as never[] }),
    tplIds.length ? db.from("assessment_items").select("*").in("template_id", tplIds).order("sort_order") : Promise.resolve({ data: [] as ItemRow[] }),
    tplIds.length ? db.from("assessment_templates").select("id,name").in("id", tplIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    opts.familyView ? Promise.resolve({ data: [] as { id: string; display_name: string; profile_id: string | null }[] })
      : db.from("coaches").select("id,display_name,profile_id"),
  ]);
  const itemById = new Map((items.data ?? []).map((i) => [i.id, i]));
  const tplName = new Map((tpls.data ?? []).map((x) => [x.id, x.name]));
  const coachName = new Map((coaches.data ?? []).map((c) => [c.id, c.display_name]));
  const myCoachId = (coaches.data ?? []).find((c) => c.profile_id === viewer.me.id)?.id ?? null;
  const evaluations: EvaluationView[] = evalRows.map((e) => ({
    id: e.id, templateId: e.template_id, templateName: tplName.get(e.template_id) ?? "", evaluatedOn: e.evaluated_on,
    overallScore: e.overall_score === null ? null : Number(e.overall_score), comments: e.comments, shared: e.shared_with_family,
    coachName: e.coach_id ? coachName.get(e.coach_id) ?? null : null,
    canEdit: !opts.familyView && (viewer.isAdmin || (e.coach_id !== null && e.coach_id === myCoachId) || e.created_by === viewer.me.id),
    scores: (scores.data ?? []).filter((s) => s.evaluation_id === e.id).map((s) => {
      const it = itemById.get(s.item_id);
      return {
        itemId: s.item_id, label: it?.label ?? "", kind: (it?.kind ?? "text") as ItemKind, unit: it?.unit ?? null, scaleMin: it?.scale_min ?? 0,
        scaleMax: it?.scale_max ?? 0, score: s.score === null ? null : Number(s.score), value: s.value === null ? null : Number(s.value), textValue: s.text_value,
      };
    }).sort((x, y) => (itemById.get(x.itemId)?.sort_order ?? 0) - (itemById.get(y.itemId)?.sort_order ?? 0)),
  }));

  // Measurement history per item label + unit (same test across templates).
  const mmap = new Map<string, { itemId: string; label: string; unit: string | null; points: { date: string; value: number }[] }>();
  for (const e of evaluations) for (const s of e.scores) {
    if (s.kind !== "measurement" || s.value === null) continue;
    const key = `${s.label.toLowerCase()}|${s.unit ?? ""}`;
    const cur = mmap.get(key) ?? { itemId: s.itemId, label: s.label, unit: s.unit, points: [] };
    cur.points.push({ date: e.evaluatedOn, value: s.value });
    mmap.set(key, cur);
  }
  const measurements = Array.from(mmap.values()).map((m) => ({ ...m, points: m.points.sort((x, y) => x.date.localeCompare(y.date)) }));

  // Plans.
  const aRows = assigns.data ?? [];
  const planIds = uniq(aRows.map((r) => r.plan_id));
  const [plans, planItems, comps] = await Promise.all([
    planIds.length ? db.from("training_plans").select("id,name,description,weeks").in("id", planIds) : Promise.resolve({ data: [] as { id: string; name: string; description: string | null; weeks: number }[] }),
    loadPlanItems(db, planIds),
    aRows.length ? db.from("training_plan_completions").select("assignment_id,item_id,rating,comment,completed_on").in("assignment_id", aRows.map((r) => r.id)) : Promise.resolve({ data: [] as { assignment_id: string; item_id: string; rating: number | null; comment: string | null; completed_on: string }[] }),
  ]);
  const planById = new Map((plans.data ?? []).map((p) => [p.id, p]));
  const assignments: AssignmentView[] = aRows.filter((r) => planById.has(r.plan_id)).map((r) => {
    const p = planById.get(r.plan_id)!;
    const completions: AssignmentView["completions"] = {};
    for (const c of comps.data ?? []) if (c.assignment_id === r.id) completions[c.item_id] = { rating: c.rating, comment: c.comment, completedOn: c.completed_on };
    return {
      id: r.id, planId: r.plan_id, planName: p.name, planDescription: p.description, weeks: p.weeks, startsOn: r.starts_on, status: r.status,
      source: r.source, atHome: r.at_home, notes: r.notes, currentWeek: currentWeek(r.starts_on, t, p.weeks),
      completions,
      items: planItems.items.filter((i) => i.plan_id === r.plan_id).map((i) => {
        const ex = i.exercise_id ? planItems.exercises.get(i.exercise_id) : undefined;
        return {
          id: i.id, week: i.week, day: i.day, sortOrder: i.sort_order, title: i.title || ex?.name || "", exerciseId: i.exercise_id,
          description: ex?.description ?? null, category: ex?.category ?? null, videoUrl: ex?.video_url ?? null, hasVideo: Boolean(ex?.video_path),
          equipment: ex?.equipment ?? [], sets: i.sets, reps: i.reps, durationSec: i.duration_sec, restSec: i.rest_sec, notes: i.notes,
        };
      }),
    };
  });

  // Nutrition.
  const nIds = uniq([...(nAssign.data ?? []).map((n) => n.plan_id), ...(nOwn.data ?? []).map((n) => n.id)]);
  const [nPlans, meals] = await Promise.all([
    nIds.length ? db.from("nutrition_plans").select("*").in("id", nIds).eq("is_active", true) : Promise.resolve({ data: [] as never[] }),
    nIds.length ? db.from("nutrition_plan_meals").select("plan_id,day,meal,description,sort_order").in("plan_id", nIds).order("day").order("sort_order") : Promise.resolve({ data: [] as { plan_id: string; day: number; meal: string; description: string; sort_order: number }[] }),
  ]);
  const nutrition: NutritionView[] = (nPlans.data ?? []).map((p: { id: string; name: string; description: string | null; hydration_ml: number | null; guidelines: string | null; athlete_id: string | null }) => ({
    id: p.id, name: p.name, description: p.description, hydrationMl: p.hydration_ml, guidelines: p.guidelines, clientSpecific: p.athlete_id !== null,
    meals: (meals.data ?? []).filter((m) => m.plan_id === p.id).map((m) => ({ day: m.day, meal: m.meal, description: m.description })),
  }));

  // Wellness.
  const wellness: WellnessView[] = (well.data ?? []).map((w) => ({
    date: w.checkin_date, sleep: w.sleep, energy: w.energy, soreness: w.soreness, mood: w.mood, note: w.note,
    flags: wellnessFlags(w), readiness: readiness(w),
  }));
  const { data: wEnabled } = await db.from("team_memberships").select("team_id,teams(wellness_enabled,is_active)").eq("athlete_id", athleteId).neq("status", "inactive");
  const wellnessEnabled = ((wEnabled ?? []) as unknown as { teams: { wellness_enabled: boolean; is_active: boolean } | null }[]).some((m) => m.teams?.wellness_enabled && m.teams.is_active);

  // Progress: own attendance + latest evaluation (own data only).
  const since = daysAgo(settings.windowDays);
  const ownMarks = ((marks.data ?? []) as unknown as { status: string; attendance_sessions: { session_date: string } | null }[])
    .filter((m) => (m.attendance_sessions?.session_date ?? "").slice(0, 10) >= since);
  const rate = attendanceRate(ownMarks);
  const latest = evaluations.find((e) => e.overallScore !== null)?.overallScore ?? null;
  const progressScore = combinedScore({ attendanceRate: rate, evaluationScore: latest }, settings.weights);

  const ranks = await rankBandsFor(viewer.me.orgId, athleteId, settings, Boolean(opts.familyView));

  return ok({
    athlete: { id: a.id, name: fullName(a), dob: a.dob, age: ageOn(a.dob, t), level: profile.data?.level ?? null },
    evaluations, measurements, assignments, nutrition, wellness, wellnessEnabled,
    attendanceRate: rate, progressScore, level: levelFor(progressScore, settings.levels), levels: settings.levels,
    ranks: opts.familyView && !settings.familyRankVisible ? [] : ranks.map((r) => (opts.familyView ? { ...r, position: null, size: 0 } : r)),
    familyRankVisible: settings.familyRankVisible,
  });
}

// ---- Rankings ----------------------------------------------------------------------------
type GroupMembers = { key: string; name: string; athleteIds: string[] };

/** Inputs for ranking: attendance rate in the window + latest evaluation per athlete (service role, org-filtered). */
async function rankInputs(orgId: string, athleteIds: string[], windowDays: number) {
  const admin = devAdminDb();
  if (athleteIds.length === 0) return [];
  const since = new Date(Date.now() - windowDays * 864e5).toISOString();
  const [marks, evals] = await Promise.all([
    admin.from("attendance_marks").select("athlete_id,status,attendance_sessions!inner(session_date,org_id)")
      .eq("org_id", orgId).in("athlete_id", athleteIds).gte("attendance_sessions.session_date", since),
    admin.from("evaluations").select("athlete_id,overall_score,evaluated_on").eq("org_id", orgId).in("athlete_id", athleteIds)
      .not("overall_score", "is", null).order("evaluated_on", { ascending: false }),
  ]);
  const latest = new Map<string, number>();
  for (const e of evals.data ?? []) if (!latest.has(e.athlete_id)) latest.set(e.athlete_id, Number(e.overall_score));
  return athleteIds.map((id) => ({
    athleteId: id,
    attendanceRate: attendanceRate(((marks.data ?? []) as { athlete_id: string; status: string }[]).filter((m) => m.athlete_id === id)),
    evaluationScore: latest.get(id) ?? null,
  }));
}

/** The groups (active teams, active programmes) an athlete belongs to, with all members (service role, org-filtered). */
async function groupsOf(orgId: string, athleteId: string): Promise<GroupMembers[]> {
  const admin = devAdminDb();
  const [tm, rg] = await Promise.all([
    admin.from("team_memberships").select("team_id,teams!inner(name,is_active,org_id)").eq("org_id", orgId).eq("athlete_id", athleteId).neq("status", "inactive"),
    admin.from("registrations").select("program_id,programs!inner(name,is_active,org_id)").eq("org_id", orgId).eq("athlete_id", athleteId).in("status", ["confirmed", "completed"]),
  ]);
  const teams = ((tm.data ?? []) as unknown as { team_id: string; teams: { name: string; is_active: boolean } }[]).filter((r) => r.teams.is_active);
  const progs = ((rg.data ?? []) as unknown as { program_id: string; programs: { name: string; is_active: boolean } }[]).filter((r) => r.programs.is_active);
  const [tMembers, pMembers] = await Promise.all([
    teams.length ? admin.from("team_memberships").select("team_id,athlete_id").eq("org_id", orgId).in("team_id", teams.map((x) => x.team_id)).neq("status", "inactive") : Promise.resolve({ data: [] as { team_id: string; athlete_id: string }[] }),
    progs.length ? admin.from("registrations").select("program_id,athlete_id").eq("org_id", orgId).in("program_id", progs.map((x) => x.program_id)).in("status", ["confirmed", "completed"]) : Promise.resolve({ data: [] as { program_id: string; athlete_id: string }[] }),
  ]);
  return [
    ...teams.map((x) => ({ key: `team:${x.team_id}`, name: x.teams.name, athleteIds: uniq((tMembers.data ?? []).filter((m) => m.team_id === x.team_id).map((m) => m.athlete_id)) })),
    ...progs.map((x) => ({ key: `program:${x.program_id}`, name: x.programs.name, athleteIds: uniq((pMembers.data ?? []).filter((m) => m.program_id === x.program_id).map((m) => m.athlete_id)) })),
  ];
}

/**
 * The athlete's band (and, for staff, position) in each of their groups.
 * Called only after the caller's own session could read the athlete.
 */
async function rankBandsFor(orgId: string, athleteId: string, settings: DevSettings, familyView: boolean) {
  try {
    const groups = await groupsOf(orgId, athleteId);
    const out: { groupName: string; band: RankBand | null; position: number | null; size: number }[] = [];
    for (const g of groups) {
      const inputs = await rankInputs(orgId, g.athleteIds, settings.windowDays);
      const rows = rankGroup(inputs, settings.weights);
      const mine = rows.find((r) => r.athleteId === athleteId);
      const size = rows.filter((r) => r.position !== null).length;
      out.push({ groupName: g.name, band: mine?.band ?? null, position: familyView ? null : mine?.position ?? null, size: familyView ? 0 : size });
    }
    return out;
  } catch {
    return [];
  }
}

export type RankingView = {
  groups: { key: string; name: string }[];
  selected: string | null;
  rows: (RankRow & { name: string; level: { index: number; tier: LevelTier } })[];
  weights: RankingWeights;
  windowDays: number;
};

/** Staff ranking of one team / programme: athletes the caller may read (RLS) only. */
export async function getRankings(groupKey: string | null): Promise<Result<RankingView>> {
  const viewer = await getViewer();
  if (!viewer || !(viewer.isAdmin || viewer.isCoach)) return fail("forbidden");
  const roster = await getRoster();
  if (roster.error !== null) return roster;
  const settings = await getDevSettings();
  const groups: GroupMembers[] = [
    ...roster.data.teams.filter((t) => t.athleteIds.length).map((t) => ({ key: `team:${t.id}`, name: t.name, athleteIds: t.athleteIds })),
    ...roster.data.programs.filter((p) => p.athleteIds.length).map((p) => ({ key: `program:${p.id}`, name: p.name, athleteIds: p.athleteIds })),
  ];
  const selected = groups.find((g) => g.key === groupKey) ?? groups[0] ?? null;
  if (!selected) return ok({ groups: [], selected: null, rows: [], weights: settings.weights, windowDays: settings.windowDays });
  // Members the caller cannot read are left out (a coach sees their athletes only).
  const readable = new Set(roster.data.athletes.map((a) => a.id));
  const ids = selected.athleteIds.filter((id) => readable.has(id));
  const inputs = await rankInputs(viewer.me.orgId, ids, settings.windowDays);
  const names = new Map(roster.data.athletes.map((a) => [a.id, a.name]));
  const rows = rankGroup(inputs, settings.weights).map((r) => ({ ...r, name: names.get(r.athleteId) ?? "", level: levelFor(r.score, settings.levels) }));
  return ok({ groups: groups.map((g) => ({ key: g.key, name: g.name })), selected: selected.key, rows, weights: settings.weights, windowDays: settings.windowDays });
}

/** Admin only: coaches ranked by sessions delivered, attendance of their sessions and feedback. */
export async function getCoachRankings(): Promise<Result<(CoachRankRow & { name: string })[]>> {
  const viewer = await getViewer();
  if (!viewer?.isAdmin) return fail("forbidden");
  const db = await devDb();
  const settings = await getDevSettings(db);
  const since = new Date(Date.now() - settings.windowDays * 864e5).toISOString();
  const [coaches, sessions] = await Promise.all([
    db.from("coaches").select("id,display_name,profile_id,is_active").eq("is_active", true).order("display_name"),
    db.from("attendance_sessions").select("id,coach_id,status,session_date").gte("session_date", since).in("status", ["submitted", "locked"]),
  ]);
  if (coaches.error) return fail(coaches.error.message);
  const sessionIds = (sessions.data ?? []).map((s) => s.id);
  const [marks, assigns] = await Promise.all([
    sessionIds.length ? db.from("attendance_marks").select("attendance_session_id,status").in("attendance_session_id", sessionIds) : Promise.resolve({ data: [] as { attendance_session_id: string; status: string }[] }),
    db.from("training_plan_assignments").select("id,assigned_by"),
  ]);
  const assignIds = (assigns.data ?? []).map((a) => a.id);
  const { data: feedback } = assignIds.length
    ? await db.from("training_plan_completions").select("assignment_id,rating").in("assignment_id", assignIds).not("rating", "is", null).gte("completed_on", since.slice(0, 10))
    : { data: [] as { assignment_id: string; rating: number | null }[] };
  const assignedBy = new Map((assigns.data ?? []).map((a) => [a.id, a.assigned_by]));
  const rows = (coaches.data ?? []).map((c) => {
    const mine = (sessions.data ?? []).filter((s) => s.coach_id === c.id).map((s) => s.id);
    const set = new Set(mine);
    const ratings = (feedback ?? []).filter((f) => c.profile_id && assignedBy.get(f.assignment_id) === c.profile_id).map((f) => Number(f.rating));
    return {
      coachId: c.id, name: c.display_name, sessionsDelivered: mine.length,
      attendanceRate: attendanceRate((marks.data ?? []).filter((m) => set.has(m.attendance_session_id))),
      feedbackAvg: ratings.length ? Math.round((ratings.reduce((s, x) => s + x, 0) / ratings.length) * 10) / 10 : null,
    };
  });
  const names = new Map(rows.map((r) => [r.coachId, r.name]));
  return ok(rankCoaches(rows).map((r) => ({ ...r, name: names.get(r.coachId) ?? "" })));
}

// ---- Exercises and plans -------------------------------------------------------------------
export type Exercise = {
  id: string; name: string; description: string | null; sport: string | null; category: string; videoUrl: string | null; hasVideo: boolean;
  equipment: string[]; difficulty: string; isActive: boolean; createdBy: string | null;
};
export async function listExercises(): Promise<Result<Exercise[]>> {
  const db = await devDb();
  const { data, error } = await db.from("exercises").select("*").order("name");
  if (error) return fail(error.message);
  return ok((data ?? []).map((e) => ({
    id: e.id, name: e.name, description: e.description, sport: e.sport, category: e.category, videoUrl: e.video_url, hasVideo: Boolean(e.video_path),
    equipment: e.equipment ?? [], difficulty: e.difficulty, isActive: e.is_active, createdBy: e.created_by,
  })));
}

export type PlanSummary = {
  id: string; name: string; description: string | null; sport: string | null; ageMin: number | null; ageMax: number | null; level: string | null;
  weeks: number; isTemplate: boolean; autoAssign: boolean; isActive: boolean; createdBy: string | null; itemCount: number; activeAssignments: number;
};
export async function listPlans(): Promise<Result<PlanSummary[]>> {
  const db = await devDb();
  const [plans, items, assigns] = await Promise.all([
    db.from("training_plans").select("*").order("name"),
    db.from("training_plan_items").select("plan_id"),
    db.from("training_plan_assignments").select("plan_id").eq("status", "active"),
  ]);
  if (plans.error) return fail(plans.error.message);
  const count = (rows: { plan_id: string }[] | null, id: string) => (rows ?? []).filter((r) => r.plan_id === id).length;
  return ok((plans.data ?? []).map((p) => ({
    id: p.id, name: p.name, description: p.description, sport: p.sport, ageMin: p.age_min, ageMax: p.age_max, level: p.level, weeks: p.weeks,
    isTemplate: p.is_template, autoAssign: p.auto_assign, isActive: p.is_active, createdBy: p.created_by,
    itemCount: count(items.data, p.id), activeAssignments: count(assigns.data, p.id),
  })));
}

export type PlanDetail = PlanSummary & {
  items: { id: string; week: number; day: number; exerciseId: string | null; title: string; sets: number | null; reps: number | null; durationSec: number | null; restSec: number | null; notes: string | null; sortOrder: number }[];
  assignments: { id: string; athleteId: string; athleteName: string; startsOn: string; status: string; source: string; atHome: boolean; done: number }[];
};
export async function getPlan(id: string): Promise<Result<PlanDetail | null>> {
  const list = await listPlans();
  if (list.error !== null) return list;
  const p = list.data.find((x) => x.id === id);
  if (!p) return ok(null);
  const db = await devDb();
  const [items, assigns] = await Promise.all([
    db.from("training_plan_items").select("*").eq("plan_id", id).order("week").order("day").order("sort_order"),
    db.from("training_plan_assignments").select("id,athlete_id,starts_on,status,source,at_home").eq("plan_id", id).neq("status", "cancelled").order("starts_on", { ascending: false }),
  ]);
  const aIds = uniq((assigns.data ?? []).map((a) => a.athlete_id));
  const [ath, comps] = await Promise.all([
    aIds.length ? db.from("athletes").select("id,first_name,last_name").in("id", aIds) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
    (assigns.data ?? []).length ? db.from("training_plan_completions").select("assignment_id").in("assignment_id", (assigns.data ?? []).map((a) => a.id)) : Promise.resolve({ data: [] as { assignment_id: string }[] }),
  ]);
  const names = new Map((ath.data ?? []).map((x) => [x.id, fullName(x)]));
  return ok({
    ...p,
    items: (items.data ?? []).map((i) => ({ id: i.id, week: i.week, day: i.day, exerciseId: i.exercise_id, title: i.title ?? "", sets: i.sets, reps: i.reps, durationSec: i.duration_sec, restSec: i.rest_sec, notes: i.notes, sortOrder: i.sort_order })),
    // Athletes the caller cannot read (RLS) are left out.
    assignments: (assigns.data ?? []).filter((a) => names.has(a.athlete_id)).map((a) => ({
      id: a.id, athleteId: a.athlete_id, athleteName: names.get(a.athlete_id) ?? "", startsOn: a.starts_on, status: a.status, source: a.source, atHome: a.at_home,
      done: (comps.data ?? []).filter((c) => c.assignment_id === a.id).length,
    })),
  });
}

/** Facts used to match plan templates (sport from teams, level from profile / latest evaluation). */
export async function athleteFacts(db: DevClient, athleteIds: string[]): Promise<AthleteFacts[]> {
  if (athleteIds.length === 0) return [];
  const [ath, tm, prof, evals] = await Promise.all([
    db.from("athletes").select("id,dob").in("id", athleteIds),
    db.from("team_memberships").select("athlete_id,teams(sport,is_active)").in("athlete_id", athleteIds).neq("status", "inactive"),
    db.from("athlete_training_profiles").select("athlete_id,level").in("athlete_id", athleteIds),
    db.from("evaluations").select("athlete_id,overall_score,evaluated_on").in("athlete_id", athleteIds).not("overall_score", "is", null).order("evaluated_on", { ascending: false }),
  ]);
  const latest = new Map<string, number>();
  for (const e of evals.data ?? []) if (!latest.has(e.athlete_id)) latest.set(e.athlete_id, Number(e.overall_score));
  const profiles = new Map((prof.data ?? []).map((p) => [p.athlete_id, p.level]));
  const teams = (tm.data ?? []) as unknown as { athlete_id: string; teams: { sport: string | null; is_active: boolean } | null }[];
  return (ath.data ?? []).map((a) => ({
    id: a.id, dob: a.dob,
    sports: uniq(teams.filter((x) => x.athlete_id === a.id && x.teams?.is_active).map((x) => x.teams?.sport)),
    profileLevel: profiles.get(a.id) ?? null,
    latestScore: latest.get(a.id) ?? null,
  }));
}
export { athleteLevel };
export type { PlanCriteria };

// ---- Nutrition ---------------------------------------------------------------------------------
export type NutritionPlan = {
  id: string; name: string; description: string | null; ageMin: number | null; ageMax: number | null; athleteId: string | null; athleteName: string | null;
  hydrationMl: number | null; guidelines: string | null; isActive: boolean; createdBy: string | null;
  meals: { day: number; meal: string; description: string }[];
  assignments: { id: string; athleteId: string; athleteName: string; startsOn: string }[];
};
export async function listNutritionPlans(): Promise<Result<NutritionPlan[]>> {
  const db = await devDb();
  const [plans, meals, assigns] = await Promise.all([
    db.from("nutrition_plans").select("*").order("name"),
    db.from("nutrition_plan_meals").select("plan_id,day,meal,description,sort_order").order("day").order("sort_order"),
    db.from("nutrition_plan_assignments").select("id,plan_id,athlete_id,starts_on"),
  ]);
  if (plans.error) return fail(plans.error.message);
  const aIds = uniq([...(plans.data ?? []).map((p) => p.athlete_id), ...(assigns.data ?? []).map((a) => a.athlete_id)]);
  const { data: ath } = aIds.length ? await db.from("athletes").select("id,first_name,last_name").in("id", aIds) : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const names = new Map((ath ?? []).map((x) => [x.id, fullName(x)]));
  return ok((plans.data ?? []).map((p) => ({
    id: p.id, name: p.name, description: p.description, ageMin: p.age_min, ageMax: p.age_max, athleteId: p.athlete_id,
    athleteName: p.athlete_id ? names.get(p.athlete_id) ?? null : null, hydrationMl: p.hydration_ml, guidelines: p.guidelines, isActive: p.is_active,
    createdBy: p.created_by,
    meals: (meals.data ?? []).filter((m) => m.plan_id === p.id).map((m) => ({ day: m.day, meal: m.meal, description: m.description })),
    assignments: (assigns.data ?? []).filter((a) => a.plan_id === p.id && names.has(a.athlete_id)).map((a) => ({ id: a.id, athleteId: a.athlete_id, athleteName: names.get(a.athlete_id) ?? "", startsOn: a.starts_on })),
  })));
}

// ---- Wellness dashboard (staff) ------------------------------------------------------------------
export type WellnessBoard = {
  rows: { athleteId: string; name: string; date: string; flags: WellnessFlag[]; readiness: number; note: string | null; sleep: number; energy: number; soreness: number; mood: number }[];
  enabledTeams: number;
  missingToday: { athleteId: string; name: string }[];
};
export async function getWellnessBoard(days = 7): Promise<Result<WellnessBoard>> {
  const db = await devDb();
  const roster = await getRoster();
  if (roster.error !== null) return roster;
  const { data, error } = await db.from("wellness_checkins").select("*").gte("checkin_date", daysAgo(days)).order("checkin_date", { ascending: false });
  if (error) return fail(error.message);
  const names = new Map(roster.data.athletes.map((a) => [a.id, a.name]));
  const enabledTeams = roster.data.teams.filter((t) => t.wellnessEnabled);
  const expected = uniq(enabledTeams.flatMap((t) => t.athleteIds));
  const t = today();
  const doneToday = new Set((data ?? []).filter((w) => w.checkin_date === t).map((w) => w.athlete_id));
  return ok({
    rows: (data ?? []).filter((w) => names.has(w.athlete_id)).map((w) => ({
      athleteId: w.athlete_id, name: names.get(w.athlete_id) ?? "", date: w.checkin_date, flags: wellnessFlags(w), readiness: readiness(w), note: w.note,
      sleep: w.sleep, energy: w.energy, soreness: w.soreness, mood: w.mood,
    })),
    enabledTeams: enabledTeams.length,
    missingToday: expected.filter((id) => !doneToday.has(id)).map((id) => ({ athleteId: id, name: names.get(id) ?? "" })).filter((x) => x.name),
  });
}

// ---- Parent: children list -------------------------------------------------------------------------
export async function listMyChildren(): Promise<Result<{ id: string; name: string }[]>> {
  const viewer = await getViewer();
  if (!viewer) return fail("unauthenticated");
  const db = await devDb();
  const { data: fam } = await db.from("family_members").select("family_id").eq("profile_id", viewer.me.id);
  const famIds = (fam ?? []).map((f) => f.family_id);
  if (famIds.length === 0) return ok([]);
  const { data, error } = await db.from("athletes").select("id,first_name,last_name,status").in("family_id", famIds).eq("org_id", viewer.me.orgId).neq("status", "archived").order("first_name");
  if (error) return fail(error.message);
  return ok((data ?? []).map((a) => ({ id: a.id, name: fullName(a) })));
}

/** Overall score preview for a filled form (UI uses the same function as the DB trigger). */
export { overallScore };
