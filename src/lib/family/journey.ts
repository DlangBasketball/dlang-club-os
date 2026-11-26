/** Player journey helpers (pure, unit-tested). */

export type ScorePoint = { date: string; score: number };

/**
 * Latest score and its change against the average of the earlier ones in the
 * same season (one decimal). null when there is not enough data.
 */
export function evaluationTrend(points: ScorePoint[]): { latest: number | null; delta: number | null } {
  const sorted = [...points].filter((p) => Number.isFinite(Number(p.score))).sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return { latest: null, delta: null };
  const latest = Number(sorted[sorted.length - 1]!.score);
  if (sorted.length < 2) return { latest, delta: null };
  const earlier = sorted.slice(0, -1);
  const avg = earlier.reduce((s, p) => s + Number(p.score), 0) / earlier.length;
  return { latest, delta: Math.round((latest - avg) * 10) / 10 };
}

/** Pipeline order (declined / withdrawn sit outside the forward path). */
export const PIPELINE = ["interested", "contacted", "trial", "offer", "placed"] as const;

/** 0..1 progress along the placement pipeline; null for closed-without-placement. */
export function pipelineProgress(status: string): number | null {
  const i = (PIPELINE as readonly string[]).indexOf(status);
  if (i < 0) return null;
  return i / (PIPELINE.length - 1);
}
