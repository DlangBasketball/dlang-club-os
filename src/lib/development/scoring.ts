/**
 * Evaluation scoring — pure, shared by the UI (live preview) and unit tests.
 * Mirrors public.evaluation_overall_score() in
 * supabase/migrations/20250420100600_athlete_development.sql: the overall
 * score is the weighted mean of the skill scores normalised to 0-100.
 */

export type ItemKind = "skill" | "measurement" | "text";
export const ITEM_KINDS: readonly ItemKind[] = ["skill", "measurement", "text"] as const;

export const LEVELS = ["beginner", "intermediate", "advanced", "elite"] as const;
export type Level = (typeof LEVELS)[number];

export type ScoredItem = {
  id: string;
  kind: ItemKind;
  scaleMin: number;
  scaleMax: number;
  weight: number;
  higherIsBetter: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One skill score on its scale -> 0..100 (reversed when lower is better). Null when unusable. */
export function normalizeScore(score: number | null | undefined, item: Pick<ScoredItem, "scaleMin" | "scaleMax" | "higherIsBetter">): number | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  const span = item.scaleMax - item.scaleMin;
  if (span <= 0 || score < item.scaleMin || score > item.scaleMax) return null;
  const raw = item.higherIsBetter ? score - item.scaleMin : item.scaleMax - score;
  return (raw / span) * 100;
}

/** Weighted overall score (0..100, 2 decimals) of an evaluation; null when no skill was scored. */
export function overallScore(items: ScoredItem[], scores: Record<string, number | null | undefined>): number | null {
  let sum = 0;
  let weights = 0;
  for (const item of items) {
    if (item.kind !== "skill") continue;
    const n = normalizeScore(scores[item.id], item);
    if (n === null) continue;
    const w = item.weight > 0 ? item.weight : 0;
    sum += w * n;
    weights += w;
  }
  return weights > 0 ? round2(sum / weights) : null;
}

/** Level derived from a 0..100 evaluation score (used when the training profile has no level). */
export function levelFromScore(score: number | null | undefined): Level | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  if (score >= 85) return "elite";
  if (score >= 65) return "advanced";
  if (score >= 40) return "intermediate";
  return "beginner";
}

/** Free-text training-profile level -> a known level (accepts the key or common words in several languages). */
export function parseLevel(text: string | null | undefined): Level | null {
  const s = (text ?? "").trim().toLowerCase();
  if (!s) return null;
  if ((LEVELS as readonly string[]).includes(s)) return s as Level;
  if (/(elite|pro\b|élite)/.test(s)) return "elite";
  if (/(advanc|avanc|fortgeschritten|avanzad|avanzat|expert)/.test(s)) return "advanced";
  if (/(intermedi|interm|mittel|medio)/.test(s)) return "intermediate";
  if (/(begin|débutant|debutant|anfänger|anfaenger|principiante|princip)/.test(s)) return "beginner";
  return null;
}

/** Age in whole years on a given date (ISO yyyy-mm-dd). */
export function ageOn(dob: string | null | undefined, on: string): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(dob) || !/^\d{4}-\d{2}-\d{2}/.test(on)) return null;
  const [by, bm, bd] = dob.slice(0, 10).split("-").map(Number);
  const [y, m, d] = on.slice(0, 10).split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age >= 0 ? age : null;
}

/** Points of a time series grouped by month (yyyy-mm) or year (yyyy): the mean per bucket, oldest first. */
export function bucketSeries(points: { date: string; value: number }[], by: "month" | "year"): { bucket: string; value: number; count: number }[] {
  const map = new Map<string, { sum: number; count: number }>();
  for (const p of points) {
    if (!Number.isFinite(p.value) || !/^\d{4}-\d{2}/.test(p.date)) continue;
    const key = by === "month" ? p.date.slice(0, 7) : p.date.slice(0, 4);
    const cur = map.get(key) ?? { sum: 0, count: 0 };
    cur.sum += p.value;
    cur.count += 1;
    map.set(key, cur);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bucket, { sum, count }]) => ({ bucket, value: round2(sum / count), count }));
}
