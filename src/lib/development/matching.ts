import { ageOn, levelFromScore, parseLevel, type Level } from "./scoring";

/**
 * Plan template auto-assignment — pure. A template matches an athlete when
 * every criterion it sets holds: sport (one of the athlete's team sports),
 * age range (age from date of birth on the reference date) and level (the
 * training profile's level, else derived from the latest evaluation score).
 */

export type PlanCriteria = {
  id: string;
  sport: string | null;
  ageMin: number | null;
  ageMax: number | null;
  level: Level | null;
  autoAssign: boolean;
  isActive: boolean;
  isTemplate: boolean;
};

export type AthleteFacts = {
  id: string;
  dob: string | null;
  sports: string[];
  profileLevel: string | null;
  latestScore: number | null;
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** The athlete's effective level: training profile first, then the latest evaluation. */
export function athleteLevel(a: Pick<AthleteFacts, "profileLevel" | "latestScore">): Level | null {
  return parseLevel(a.profileLevel) ?? levelFromScore(a.latestScore);
}

export function planMatchesAthlete(plan: Omit<PlanCriteria, "id" | "autoAssign" | "isActive" | "isTemplate">, athlete: AthleteFacts, today: string): boolean {
  if (plan.sport && !athlete.sports.some((s) => norm(s) === norm(plan.sport))) return false;
  if (plan.ageMin !== null || plan.ageMax !== null) {
    const age = ageOn(athlete.dob, today);
    if (age === null) return false;
    if (plan.ageMin !== null && age < plan.ageMin) return false;
    if (plan.ageMax !== null && age > plan.ageMax) return false;
  }
  if (plan.level) {
    const level = athleteLevel(athlete);
    if (level !== plan.level) return false;
  }
  return true;
}

/**
 * New (plan, athlete) pairs to create: active auto-assign templates x
 * matching athletes, minus pairs that already have a live assignment.
 */
export function autoAssignments(
  plans: PlanCriteria[],
  athletes: AthleteFacts[],
  existing: { planId: string; athleteId: string }[],
  today: string,
): { planId: string; athleteId: string }[] {
  const have = new Set(existing.map((e) => `${e.planId}:${e.athleteId}`));
  const out: { planId: string; athleteId: string }[] = [];
  for (const p of plans) {
    if (!p.autoAssign || !p.isActive || !p.isTemplate) continue;
    for (const a of athletes) {
      const key = `${p.id}:${a.id}`;
      if (have.has(key) || !planMatchesAthlete(p, a, today)) continue;
      have.add(key);
      out.push({ planId: p.id, athleteId: a.id });
    }
  }
  return out;
}
