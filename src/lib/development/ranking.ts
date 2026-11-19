/**
 * Rankings and progress levels — pure. Staff see ranked lists; families only
 * get their own child's band ("Top 25%") and level emoji, never other names.
 */

export type RankingWeights = { attendance: number; evaluation: number };
export const DEFAULT_WEIGHTS: RankingWeights = { attendance: 50, evaluation: 50 };

export type LevelTier = { min: number; emoji: string; label?: string | null };
export const DEFAULT_LEVELS: LevelTier[] = [
  { min: 0, emoji: "🌱" },
  { min: 40, emoji: "⭐" },
  { min: 60, emoji: "🔥" },
  { min: 75, emoji: "🏅" },
  { min: 90, emoji: "🏆" },
];

export type RankBand = "top10" | "top25" | "top50" | "rising";
export const RANK_BANDS: readonly RankBand[] = ["top10", "top25", "top50", "rising"] as const;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Attendance rate (0..100) from marks: present and late count as attended; excused marks are left out. */
export function attendanceRate(marks: { status: string }[]): number | null {
  let attended = 0;
  let counted = 0;
  for (const m of marks) {
    if (m.status === "excused") continue;
    counted += 1;
    if (m.status === "present" || m.status === "late") attended += 1;
  }
  return counted > 0 ? round1((attended / counted) * 100) : null;
}

/** Weights normalised to sum 1; negative values count as 0; all-zero falls back to the defaults. */
export function normalizeWeights(w: RankingWeights): { attendance: number; evaluation: number } {
  const a = Math.max(0, Number(w.attendance) || 0);
  const e = Math.max(0, Number(w.evaluation) || 0);
  const sum = a + e;
  if (sum <= 0) return normalizeWeights(DEFAULT_WEIGHTS);
  return { attendance: a / sum, evaluation: e / sum };
}

/**
 * Combined progress score (0..100). A missing component is left out and the
 * other one carries the full weight (a new athlete with no evaluation is
 * ranked on attendance only). Null when both are missing.
 */
export function combinedScore(parts: { attendanceRate: number | null; evaluationScore: number | null }, weights: RankingWeights): number | null {
  const w = normalizeWeights(weights);
  const items: [number, number][] = [];
  if (parts.attendanceRate !== null && Number.isFinite(parts.attendanceRate)) items.push([parts.attendanceRate, w.attendance]);
  if (parts.evaluationScore !== null && Number.isFinite(parts.evaluationScore)) items.push([parts.evaluationScore, w.evaluation]);
  const total = items.reduce((s, [, x]) => s + x, 0);
  if (items.length === 0) return null;
  if (total <= 0) return round1(items.reduce((s, [v]) => s + v, 0) / items.length);
  return round1(items.reduce((s, [v, x]) => s + v * x, 0) / total);
}

export type RankInput = { athleteId: string; attendanceRate: number | null; evaluationScore: number | null };
export type RankRow = RankInput & { score: number | null; position: number | null; band: RankBand | null };

/**
 * Ranks a group (team / programme / class). Ties share a position
 * (competition ranking 1, 2, 2, 4). Athletes with no data get no position.
 */
export function rankGroup(entries: RankInput[], weights: RankingWeights): RankRow[] {
  const scored = entries.map((e) => ({ ...e, score: combinedScore(e, weights) }));
  const ranked = scored.filter((e) => e.score !== null).sort((a, b) => (b.score as number) - (a.score as number) || a.athleteId.localeCompare(b.athleteId));
  const total = ranked.length;
  const pos = new Map<string, number>();
  ranked.forEach((e, i) => {
    const prev = ranked[i - 1];
    pos.set(e.athleteId, prev && prev.score === e.score ? (pos.get(prev.athleteId) as number) : i + 1);
  });
  const out: RankRow[] = scored.map((e) => {
    const p = pos.get(e.athleteId) ?? null;
    return { ...e, position: p, band: p === null ? null : rankBand(p, total) };
  });
  return out.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.athleteId.localeCompare(b.athleteId));
}

/** Band of a 1-based position among `total`: top 10% / 25% / 50%, otherwise "rising" (never "bottom"). */
export function rankBand(position: number, total: number): RankBand {
  if (total <= 0 || position < 1) return "rising";
  // Share of the group ranked strictly ahead (1st of 20 -> 0; 2nd -> 5%).
  const share = (Math.min(position, total) - 1) / total;
  if (share < 0.1) return "top10";
  if (share < 0.25) return "top25";
  if (share < 0.5) return "top50";
  return "rising";
}

/** Tiers sorted by threshold, deduplicated, clamped to 0..100, always starting at 0. */
export function normalizeLevels(raw: unknown): LevelTier[] {
  if (!Array.isArray(raw)) return DEFAULT_LEVELS;
  const tiers: LevelTier[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const min = Number(o.min);
    const emoji = typeof o.emoji === "string" ? o.emoji.trim().slice(0, 16) : "";
    if (!Number.isFinite(min) || !emoji) continue;
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, 40) : null;
    tiers.push({ min: Math.min(100, Math.max(0, Math.round(min))), emoji, label });
  }
  if (tiers.length === 0) return DEFAULT_LEVELS;
  tiers.sort((a, b) => a.min - b.min);
  const dedup = tiers.filter((t, i) => i === 0 || t.min !== tiers[i - 1].min);
  if (dedup[0].min !== 0) dedup[0] = { ...dedup[0], min: 0 };
  return dedup.slice(0, 10);
}

/** Level (0-based index + tier) for a progress score; the lowest tier when there is no score yet. */
export function levelFor(score: number | null, tiers: LevelTier[]): { index: number; tier: LevelTier; next: LevelTier | null } {
  const list = tiers.length ? tiers : DEFAULT_LEVELS;
  let index = 0;
  if (score !== null && Number.isFinite(score)) {
    for (let i = 0; i < list.length; i++) if (score >= list[i].min) index = i;
  }
  return { index, tier: list[index], next: list[index + 1] ?? null };
}

// ---- Coach ranking (admin only) ---------------------------------------------
export type CoachInput = {
  coachId: string;
  sessionsDelivered: number;
  attendanceRate: number | null;
  feedbackAvg: number | null; // 1..5
};
export type CoachRankRow = CoachInput & { score: number; position: number };

/**
 * Coach score: sessions delivered (relative to the busiest coach), average
 * attendance rate of their sessions and parent / athlete feedback (1-5 ->
 * 0-100) when present; missing parts are left out of the mean.
 */
export function rankCoaches(rows: CoachInput[]): CoachRankRow[] {
  const maxSessions = Math.max(0, ...rows.map((r) => r.sessionsDelivered));
  const scored = rows.map((r) => {
    const parts: number[] = [];
    parts.push(maxSessions > 0 ? (r.sessionsDelivered / maxSessions) * 100 : 0);
    if (r.attendanceRate !== null) parts.push(r.attendanceRate);
    if (r.feedbackAvg !== null) parts.push(((Math.min(5, Math.max(1, r.feedbackAvg)) - 1) / 4) * 100);
    return { ...r, score: round1(parts.reduce((s, x) => s + x, 0) / parts.length) };
  });
  scored.sort((a, b) => b.score - a.score || a.coachId.localeCompare(b.coachId));
  const out: CoachRankRow[] = [];
  scored.forEach((r, i) => {
    const prev = out[i - 1];
    out.push({ ...r, position: prev && prev.score === r.score ? prev.position : i + 1 }); // competition ranking for ties
  });
  return out;
}
