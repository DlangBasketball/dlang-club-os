/**
 * Daily wellness — pure. All four answers are 1..5; for sleep, energy and
 * mood 5 is best, for soreness 1 = none and 5 = very sore.
 */

export type WellnessAnswers = { sleep: number; energy: number; soreness: number; mood: number };
export type WellnessFlag = "lowSleep" | "lowEnergy" | "highSoreness" | "lowMood";
export const WELLNESS_FIELDS = ["sleep", "energy", "soreness", "mood"] as const;

export function wellnessFlags(a: WellnessAnswers): WellnessFlag[] {
  const flags: WellnessFlag[] = [];
  if (a.sleep <= 2) flags.push("lowSleep");
  if (a.energy <= 2) flags.push("lowEnergy");
  if (a.soreness >= 4) flags.push("highSoreness");
  if (a.mood <= 2) flags.push("lowMood");
  return flags;
}

/** 0..100 readiness: mean of the four answers with soreness reversed. */
export function readiness(a: WellnessAnswers): number {
  const vals = [a.sleep, a.energy, 6 - a.soreness, a.mood].map((v) => Math.min(5, Math.max(1, v)));
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  return Math.round(((mean - 1) / 4) * 100);
}
