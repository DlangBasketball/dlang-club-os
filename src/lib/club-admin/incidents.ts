/**
 * Injury & incident log — constants and the anonymous statistics used for
 * the safety review (counts only, never names).
 */
export const BODY_PARTS = [
  "head", "face", "neck", "shoulder", "arm", "elbow", "wrist_hand", "chest", "back", "hip",
  "thigh", "knee", "lower_leg", "ankle", "foot", "multiple", "other",
] as const;
export const SEVERITIES = ["minor", "moderate", "serious", "critical"] as const;
export const INFORMED_HOW = ["phone", "in_person", "email", "message", "other"] as const;
export const REFERRALS = ["none", "doctor", "hospital", "ambulance"] as const;
export const RETURN_STATUSES = ["not_applicable", "out", "modified", "cleared"] as const;
export const INCIDENT_STATUSES = ["open", "closed"] as const;

export type BodyPart = (typeof BODY_PARTS)[number];
export type Severity = (typeof SEVERITIES)[number];

export type IncidentStatRow = {
  occurred_at: string;
  body_part: string;
  severity: string;
  referral: string;
  return_status: string;
  status: string;
  program_id?: string | null;
};

export type IncidentStats = {
  total: number;
  open: number;
  bySeverity: Record<string, number>;
  byBodyPart: { key: string; count: number }[];
  byReferral: Record<string, number>;
  byMonth: { month: string; count: number }[];
  outOfPlay: number;
};

/** Aggregates without any personal data (no athlete ids or names in the output). */
export function incidentStats(rows: IncidentStatRow[]): IncidentStats {
  const bySeverity: Record<string, number> = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  const byReferral: Record<string, number> = Object.fromEntries(REFERRALS.map((s) => [s, 0]));
  const parts = new Map<string, number>();
  const months = new Map<string, number>();
  let open = 0, outOfPlay = 0;
  for (const r of rows) {
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    byReferral[r.referral] = (byReferral[r.referral] ?? 0) + 1;
    parts.set(r.body_part, (parts.get(r.body_part) ?? 0) + 1);
    const m = r.occurred_at.slice(0, 7);
    months.set(m, (months.get(m) ?? 0) + 1);
    if (r.status === "open") open++;
    if (r.return_status === "out" || r.return_status === "modified") outOfPlay++;
  }
  return {
    total: rows.length,
    open,
    bySeverity,
    byReferral,
    byBodyPart: [...parts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    byMonth: [...months.entries()].map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    outOfPlay,
  };
}

export function severityTone(s: string): "neutral" | "info" | "warning" | "danger" {
  return s === "critical" || s === "serious" ? "danger" : s === "moderate" ? "warning" : "info";
}
