import { describe, expect, it } from "vitest";
import { ageOn, bucketSeries, levelFromScore, normalizeScore, overallScore, parseLevel, type ScoredItem } from "@/lib/development/scoring";
import {
  DEFAULT_LEVELS, attendanceRate, combinedScore, levelFor, normalizeLevels, normalizeWeights, rankBand, rankCoaches, rankGroup,
} from "@/lib/development/ranking";
import { athleteLevel, autoAssignments, planMatchesAthlete, type AthleteFacts, type PlanCriteria } from "@/lib/development/matching";
import { readiness, wellnessFlags } from "@/lib/development/wellness";
import { completionRate, currentWeek, dateFor, groupPlan, videoEmbedUrl } from "@/lib/development/plan";
import {
  developmentErrorKey, evaluationBatchSchema, exerciseSchema, isVideoPathFor, planSchema, settingsSchema, templateSchema, wellnessSchema, zodKey,
} from "@/lib/development/validation";

const skill = (id: string, min: number, max: number, weight = 1, higherIsBetter = true): ScoredItem => ({ id, kind: "skill", scaleMin: min, scaleMax: max, weight, higherIsBetter });

describe("evaluation scoring", () => {
  it("normalises a score onto 0..100 and reverses lower-is-better items", () => {
    expect(normalizeScore(4, { scaleMin: 1, scaleMax: 5, higherIsBetter: true })).toBe(75);
    expect(normalizeScore(1, { scaleMin: 1, scaleMax: 5, higherIsBetter: true })).toBe(0);
    expect(normalizeScore(2, { scaleMin: 1, scaleMax: 5, higherIsBetter: false })).toBe(75);
    expect(normalizeScore(6, { scaleMin: 1, scaleMax: 5, higherIsBetter: true })).toBeNull();
    expect(normalizeScore(null, { scaleMin: 1, scaleMax: 5, higherIsBetter: true })).toBeNull();
  });

  it("matches the database roll-up: weighted mean of the skills (2 x 75 + 66.67) / 3 = 72.22", () => {
    const items: ScoredItem[] = [skill("a", 1, 5, 2), skill("b", 1, 10, 1), { id: "m", kind: "measurement", scaleMin: 1, scaleMax: 5, weight: 1, higherIsBetter: true }];
    expect(overallScore(items, { a: 4, b: 7, m: 152 })).toBe(72.22);
  });

  it("ignores missing, out-of-range and non-skill scores; null when nothing scored", () => {
    const items = [skill("a", 1, 5), skill("b", 1, 5)];
    expect(overallScore(items, { a: 5 })).toBe(100);
    expect(overallScore(items, { a: 9, b: null })).toBeNull();
    expect(overallScore([], {})).toBeNull();
  });

  it("derives levels from a score and from free-text profile levels", () => {
    expect(levelFromScore(10)).toBe("beginner");
    expect(levelFromScore(40)).toBe("intermediate");
    expect(levelFromScore(65)).toBe("advanced");
    expect(levelFromScore(85)).toBe("elite");
    expect(levelFromScore(null)).toBeNull();
    expect(parseLevel("Intermediate")).toBe("intermediate");
    expect(parseLevel("Débutant")).toBe("beginner");
    expect(parseLevel("Fortgeschritten")).toBe("advanced");
    expect(parseLevel("something else")).toBeNull();
  });

  it("computes age on a date and buckets series by month and year", () => {
    expect(ageOn("2014-09-02", "2026-09-01")).toBe(11);
    expect(ageOn("2014-09-02", "2026-09-02")).toBe(12);
    expect(ageOn(null, "2026-01-01")).toBeNull();
    const pts = [{ date: "2026-01-05", value: 50 }, { date: "2026-01-20", value: 70 }, { date: "2026-03-01", value: 80 }, { date: "2025-12-01", value: 40 }];
    expect(bucketSeries(pts, "month")).toEqual([
      { bucket: "2025-12", value: 40, count: 1 }, { bucket: "2026-01", value: 60, count: 2 }, { bucket: "2026-03", value: 80, count: 1 },
    ]);
    expect(bucketSeries(pts, "year").map((b) => b.bucket)).toEqual(["2025", "2026"]);
  });
});

describe("ranking weights", () => {
  it("attendance rate: present + late attended, excused left out", () => {
    expect(attendanceRate([{ status: "present" }, { status: "late" }, { status: "absent" }, { status: "excused" }])).toBe(66.7);
    expect(attendanceRate([{ status: "excused" }])).toBeNull();
  });

  it("normalises weights and falls back to equal weights when both are 0", () => {
    expect(normalizeWeights({ attendance: 30, evaluation: 70 })).toEqual({ attendance: 0.3, evaluation: 0.7 });
    expect(normalizeWeights({ attendance: 0, evaluation: 0 })).toEqual({ attendance: 0.5, evaluation: 0.5 });
    expect(normalizeWeights({ attendance: -5, evaluation: 10 })).toEqual({ attendance: 0, evaluation: 1 });
  });

  it("combines attendance and evaluation; a missing part leaves the other with the full weight", () => {
    expect(combinedScore({ attendanceRate: 80, evaluationScore: 60 }, { attendance: 50, evaluation: 50 })).toBe(70);
    expect(combinedScore({ attendanceRate: 80, evaluationScore: 60 }, { attendance: 25, evaluation: 75 })).toBe(65);
    expect(combinedScore({ attendanceRate: 80, evaluationScore: null }, { attendance: 25, evaluation: 75 })).toBe(80);
    expect(combinedScore({ attendanceRate: null, evaluationScore: null }, { attendance: 50, evaluation: 50 })).toBeNull();
  });

  it("changing the weights changes the order", () => {
    const entries = [
      { athleteId: "a", attendanceRate: 100, evaluationScore: 40 },
      { athleteId: "b", attendanceRate: 50, evaluationScore: 90 },
    ];
    expect(rankGroup(entries, { attendance: 80, evaluation: 20 })[0].athleteId).toBe("a");
    expect(rankGroup(entries, { attendance: 20, evaluation: 80 })[0].athleteId).toBe("b");
  });

  it("ties share a position; athletes without data get no position", () => {
    const rows = rankGroup([
      { athleteId: "a", attendanceRate: 90, evaluationScore: null },
      { athleteId: "b", attendanceRate: 90, evaluationScore: null },
      { athleteId: "c", attendanceRate: 50, evaluationScore: null },
      { athleteId: "d", attendanceRate: null, evaluationScore: null },
    ], { attendance: 50, evaluation: 50 });
    expect(rows.map((r) => [r.athleteId, r.position])).toEqual([["a", 1], ["b", 1], ["c", 3], ["d", null]]);
    expect(rows.find((r) => r.athleteId === "d")?.band).toBeNull();
  });

  it("bands never say 'bottom'", () => {
    expect(rankBand(1, 20)).toBe("top10");
    expect(rankBand(2, 20)).toBe("top10");
    expect(rankBand(3, 20)).toBe("top25");
    expect(rankBand(5, 20)).toBe("top25");
    expect(rankBand(6, 20)).toBe("top50");
    expect(rankBand(10, 20)).toBe("top50");
    expect(rankBand(11, 20)).toBe("rising");
    expect(rankBand(20, 20)).toBe("rising");
    expect(rankBand(1, 1)).toBe("top10");
    expect(rankBand(0, 0)).toBe("rising");
  });

  it("ranks coaches by sessions, attendance and feedback (admin view)", () => {
    const rows = rankCoaches([
      { coachId: "x", sessionsDelivered: 10, attendanceRate: 90, feedbackAvg: 5 },
      { coachId: "y", sessionsDelivered: 5, attendanceRate: 70, feedbackAvg: null },
      { coachId: "z", sessionsDelivered: 0, attendanceRate: null, feedbackAvg: null },
    ]);
    expect(rows.map((r) => r.coachId)).toEqual(["x", "y", "z"]);
    expect(rows[0].score).toBe(96.7);
    expect(rows[1].score).toBe(60);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3]);
  });
});

describe("emoji levels", () => {
  it("picks the highest tier reached; lowest tier without a score", () => {
    expect(levelFor(null, DEFAULT_LEVELS).index).toBe(0);
    expect(levelFor(39.9, DEFAULT_LEVELS).tier.emoji).toBe("🌱");
    expect(levelFor(40, DEFAULT_LEVELS).tier.emoji).toBe("⭐");
    expect(levelFor(74, DEFAULT_LEVELS).index).toBe(2);
    expect(levelFor(100, DEFAULT_LEVELS).next).toBeNull();
    expect(levelFor(61, DEFAULT_LEVELS).next?.min).toBe(75);
  });

  it("normalises edited tiers: sorted, deduplicated, first at 0, invalid rows dropped", () => {
    const tiers = normalizeLevels([{ min: 50, emoji: "🚀" }, { min: 10, emoji: "🐣", label: " Chick " }, { min: 50, emoji: "x" }, { min: "a", emoji: "?" }, { min: 20, emoji: "" }]);
    expect(tiers).toEqual([{ min: 0, emoji: "🐣", label: "Chick" }, { min: 50, emoji: "🚀", label: null }]);
    expect(normalizeLevels("nope")).toBe(DEFAULT_LEVELS);
    expect(normalizeLevels([])).toBe(DEFAULT_LEVELS);
  });
});

describe("plan auto-assign matching", () => {
  const today = "2026-11-13";
  const kid = (over: Partial<AthleteFacts> = {}): AthleteFacts => ({ id: "k1", dob: "2015-03-01", sports: ["Basketball"], profileLevel: null, latestScore: null, ...over });
  const plan = (over: Partial<PlanCriteria> = {}): PlanCriteria => ({ id: "p1", sport: "basketball", ageMin: 10, ageMax: 12, level: null, autoAssign: true, isActive: true, isTemplate: true, ...over });

  it("matches sport (case-insensitive), age from date of birth and level", () => {
    expect(planMatchesAthlete(plan(), kid(), today)).toBe(true);
    expect(planMatchesAthlete(plan({ sport: "football" }), kid(), today)).toBe(false);
    expect(planMatchesAthlete(plan({ ageMin: 12 }), kid(), today)).toBe(false);
    expect(planMatchesAthlete(plan(), kid({ dob: null }), today)).toBe(false);
    expect(planMatchesAthlete(plan({ sport: null, ageMin: null, ageMax: null }), kid({ dob: null, sports: [] }), today)).toBe(true);
  });

  it("level comes from the training profile first, else from the latest evaluation", () => {
    expect(athleteLevel({ profileLevel: "Advanced", latestScore: 10 })).toBe("advanced");
    expect(athleteLevel({ profileLevel: null, latestScore: 50 })).toBe("intermediate");
    expect(planMatchesAthlete(plan({ level: "intermediate" }), kid({ latestScore: 50 }), today)).toBe(true);
    expect(planMatchesAthlete(plan({ level: "elite" }), kid({ latestScore: 50 }), today)).toBe(false);
    expect(planMatchesAthlete(plan({ level: "beginner" }), kid(), today)).toBe(false);
  });

  it("creates only new pairs for active auto-assign templates", () => {
    const plans = [plan(), plan({ id: "p2", autoAssign: false }), plan({ id: "p3", isActive: false }), plan({ id: "p4", isTemplate: false })];
    const kids = [kid(), kid({ id: "k2" }), kid({ id: "k3", dob: "2010-01-01" })];
    expect(autoAssignments(plans, kids, [{ planId: "p1", athleteId: "k2" }], today)).toEqual([{ planId: "p1", athleteId: "k1" }]);
  });
});

describe("wellness", () => {
  it("flags poor sleep, low energy / mood and high soreness", () => {
    expect(wellnessFlags({ sleep: 2, energy: 3, soreness: 4, mood: 1 })).toEqual(["lowSleep", "highSoreness", "lowMood"]);
    expect(wellnessFlags({ sleep: 4, energy: 4, soreness: 2, mood: 4 })).toEqual([]);
  });
  it("readiness reverses soreness", () => {
    expect(readiness({ sleep: 5, energy: 5, soreness: 1, mood: 5 })).toBe(100);
    expect(readiness({ sleep: 1, energy: 1, soreness: 5, mood: 1 })).toBe(0);
  });
});

describe("plan helpers", () => {
  it("current week, dates, grouping and completion", () => {
    expect(currentWeek("2026-11-02", "2026-11-13", 4)).toBe(2);
    expect(currentWeek("2026-11-20", "2026-11-13", 4)).toBeNull();
    expect(currentWeek("2026-01-01", "2026-11-13", 4)).toBeNull();
    expect(dateFor("2026-11-02", 2, 3)).toBe("2026-11-11");
    const g = groupPlan([
      { id: "c", week: 2, day: 1, sortOrder: 1 }, { id: "b", week: 1, day: 3, sortOrder: 2 }, { id: "a", week: 1, day: 3, sortOrder: 1 },
    ]);
    expect(g.map((w) => w.week)).toEqual([1, 2]);
    expect(g[0].days[0].items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(completionRate(["a", "b", "c", "d"], ["a", "x"])).toBe(25);
    expect(completionRate([], [])).toBe(0);
  });

  it("embeds only https YouTube / Vimeo links (privacy-enhanced)", () => {
    expect(videoEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(videoEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(videoEmbedUrl("https://vimeo.com/123456789")).toBe("https://player.vimeo.com/video/123456789?dnt=1");
    expect(videoEmbedUrl("http://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(videoEmbedUrl("https://evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(videoEmbedUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("validation", () => {
  it("template: scale must increase, age range ordered, at least one item", () => {
    const base = { name: "U12", items: [{ kind: "skill", label: "Dribble", scaleMin: 1, scaleMax: 5 }] };
    expect(templateSchema.safeParse(base).success).toBe(true);
    const bad = templateSchema.safeParse({ ...base, items: [{ kind: "skill", label: "x", scaleMin: 5, scaleMax: 5 }] });
    expect(bad.success ? null : zodKey(bad.error)).toBe("development.errors.scale");
    const ages = templateSchema.safeParse({ ...base, ageMin: "14", ageMax: "10" });
    expect(ages.success ? null : zodKey(ages.error)).toBe("development.errors.ageRange");
    const empty = templateSchema.safeParse({ name: "x", items: [] });
    expect(empty.success ? null : zodKey(empty.error)).toBe("development.errors.itemsRequired");
  });

  it("evaluation batch coerces form strings", () => {
    const p = evaluationBatchSchema.safeParse({
      templateId: "a0000000-0000-0000-0000-00000000d001", evaluatedOn: "2026-11-13",
      entries: [{ athleteId: "00000000-0000-0000-0000-000000000072", scores: [{ itemId: "a0000000-0000-0000-0000-00000000d101", score: "4", value: "", textValue: "" }] }],
    });
    expect(p.success && p.data.entries[0].scores[0].score).toBe(4);
    expect(p.success && p.data.entries[0].scores[0].value).toBeNull();
  });

  it("settings: weights not both zero, unique thresholds", () => {
    const levels = [{ min: 0, emoji: "🌱" }, { min: 50, emoji: "🔥" }];
    expect(settingsSchema.safeParse({ attendanceWeight: 40, evaluationWeight: 60, windowDays: 90, levels }).success).toBe(true);
    const zero = settingsSchema.safeParse({ attendanceWeight: 0, evaluationWeight: 0, windowDays: 90, levels });
    expect(zero.success ? null : zodKey(zero.error)).toBe("development.errors.weightsZero");
    const dup = settingsSchema.safeParse({ attendanceWeight: 1, evaluationWeight: 1, windowDays: 90, levels: [{ min: 0, emoji: "a" }, { min: 0, emoji: "b" }] });
    expect(dup.success ? null : zodKey(dup.error)).toBe("development.errors.thresholdDuplicate");
  });

  it("exercise: https video links only; equipment split and deduplicated", () => {
    const ok = exerciseSchema.safeParse({ name: "Wall sit", category: "mobility", difficulty: "beginner", equipment: "wall, mat, wall", videoUrl: "https://vimeo.com/123456" });
    expect(ok.success && ok.data.equipment).toEqual(["wall", "mat"]);
    expect(exerciseSchema.safeParse({ name: "x", category: "mobility", difficulty: "beginner", videoUrl: "http://example.com/v" }).success).toBe(false);
  });

  it("plan: items must fit in the plan's weeks and name an exercise or a title; templates only auto-assign", () => {
    const item = { week: 1, day: 1, title: "Free shooting" };
    expect(planSchema.safeParse({ name: "P", weeks: 2, items: [item] }).success).toBe(true);
    const late = planSchema.safeParse({ name: "P", weeks: 1, items: [{ ...item, week: 2 }] });
    expect(late.success ? null : zodKey(late.error)).toBe("development.errors.weekBeyondPlan");
    const what = planSchema.safeParse({ name: "P", weeks: 1, items: [{ week: 1, day: 1 }] });
    expect(what.success ? null : zodKey(what.error)).toBe("development.errors.itemWhat");
    const client = planSchema.safeParse({ name: "P", weeks: 1, isTemplate: false, autoAssign: true, items: [] });
    expect(client.success && client.data.autoAssign).toBe(false);
  });

  it("wellness answers are 1..5", () => {
    const base = { athleteId: "00000000-0000-0000-0000-000000000072", date: "2026-11-13", sleep: 3, energy: 3, soreness: 3, mood: 3 };
    expect(wellnessSchema.safeParse(base).success).toBe(true);
    expect(wellnessSchema.safeParse({ ...base, mood: 6 }).success).toBe(false);
  });

  it("video paths are scoped to org and exercise", () => {
    const org = "00000000-0000-0000-0000-000000000001";
    const ex = "a0000000-0000-0000-0000-00000000f001";
    expect(isVideoPathFor(`${org}/${ex}/0f8fad5b-d9cb-469f-a165-70867728950e.mp4`, org, ex)).toBe(true);
    expect(isVideoPathFor(`${org}/${ex}/../x.mp4`, org, ex)).toBe(false);
    expect(isVideoPathFor(`10000000-0000-0000-0000-000000000002/${ex}/abcdefgh.mp4`, org, ex)).toBe(false);
  });

  it("maps database errors to translated keys", () => {
    expect(developmentErrorKey("WELLNESS_DISABLED")).toBe("development.errors.wellnessDisabled");
    expect(developmentErrorKey('duplicate key value violates unique constraint "tpa_one_active_per_plan"')).toBe("development.errors.alreadyAssigned");
    expect(developmentErrorKey("new row violates row-level security policy")).toBe("development.errors.notPermitted");
    expect(developmentErrorKey("weird")).toBe("development.errors.generic");
  });
});
