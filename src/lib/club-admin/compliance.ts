/**
 * Staff compliance — pure rules for certificate states, the dashboard and
 * expiry reminders (60 / 30 / 7 days by default, club-configurable).
 * Mirrors public.coach_compliance_missing() (migration 20250420101500).
 */
import { daysBetween } from "./membership";

export const CERT_KINDS = [
  "coaching_licence",
  "first_aid",
  "criminal_record",
  "criminal_record_youth",
  "child_protection",
  "other",
] as const;
export type CertKind = (typeof CERT_KINDS)[number];
export const DEFAULT_MANDATORY: CertKind[] = ["criminal_record_youth", "child_protection", "first_aid"];
export const DEFAULT_REMINDER_DAYS = [60, 30, 7];
/** Shown as "expiring" this many days before the end of validity. */
export const EXPIRING_WINDOW_DAYS = 60;

export type Cert = {
  id: string;
  kind: CertKind | string;
  status: "pending" | "verified" | "rejected";
  valid_until: string | null;
};

export type CertState = "ok" | "expiring" | "expired" | "pending" | "rejected" | "missing";

export function certState(c: Cert | null | undefined, today: string, windowDays = EXPIRING_WINDOW_DAYS): CertState {
  if (!c) return "missing";
  if (c.status === "rejected") return "rejected";
  if (c.valid_until && c.valid_until < today) return "expired";
  if (c.status === "pending") return "pending";
  if (c.valid_until && daysBetween(today, c.valid_until) <= windowDays) return "expiring";
  return "ok";
}

const RANK: Record<CertState, number> = { ok: 6, expiring: 5, pending: 4, expired: 3, rejected: 2, missing: 1 };

/** The best certificate of a kind (verified and valid longest wins). */
export function bestCert<T extends Cert>(certs: T[], kind: CertKind, today: string): T | null {
  let best: T | null = null;
  for (const c of certs) {
    if (c.kind !== kind) continue;
    if (!best) { best = c; continue; }
    const a = RANK[certState(c, today)], b = RANK[certState(best, today)];
    if (a > b || (a === b && (c.valid_until ?? "9999-12-31") > (best.valid_until ?? "9999-12-31"))) best = c;
  }
  return best;
}

/** Mandatory kinds without a verified certificate valid on the day (as the DB block checks). */
export function missingKinds(certs: Cert[], mandatory: readonly string[], day: string): string[] {
  return mandatory.filter(
    (k) => !certs.some((c) => c.kind === k && c.status === "verified" && (c.valid_until == null || c.valid_until >= day)),
  );
}

/** Per-coach compliance row for the dashboard. */
export function coachRow<T extends Cert>(certs: T[], mandatory: readonly CertKind[], today: string) {
  const kinds = mandatory.map((k) => {
    const c = bestCert(certs, k, today);
    return { kind: k, state: certState(c, today), cert: c };
  });
  const blocked = missingKinds(certs, mandatory, today).length > 0;
  const attention = kinds.some((k) => k.state !== "ok");
  return { kinds, blocked, attention };
}

/**
 * Reminder thresholds due today for a certificate: every threshold T with
 * 0 <= days-left <= T that was not sent yet for this validity date. Only the
 * tightest due threshold is returned so a late first run sends one email.
 */
export function dueReminder(
  validUntil: string | null,
  today: string,
  thresholds: number[] = DEFAULT_REMINDER_DAYS,
  alreadySent: number[] = [],
): number | null {
  if (!validUntil) return null;
  const left = daysBetween(today, validUntil);
  if (left < 0) return null;
  const due = thresholds.filter((t) => left <= t && !alreadySent.includes(t)).sort((a, b) => a - b);
  if (!due.length) return null;
  // Skip a threshold already covered by a tighter one that was sent.
  const tightestSent = alreadySent.filter((t) => thresholds.includes(t)).sort((a, b) => a - b)[0];
  if (tightestSent != null && due[0] > tightestSent) return null;
  return due[0];
}

/** All thresholds the reminder marks as sent (the chosen one and every looser one). */
export function thresholdsCovered(chosen: number, thresholds: number[] = DEFAULT_REMINDER_DAYS): number[] {
  return thresholds.filter((t) => t >= chosen);
}

export function certTone(s: CertState): "success" | "warning" | "danger" | "info" | "neutral" {
  switch (s) {
    case "ok": return "success";
    case "expiring": return "warning";
    case "pending": return "info";
    case "missing": return "neutral";
    default: return "danger";
  }
}
