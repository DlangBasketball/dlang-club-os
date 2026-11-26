import type { ComplianceRegion } from "./regions";

/** Mirrors the request_type check constraint on public.dsar_requests. */
export const DSAR_TYPES = [
  "access", "rectification", "erasure", "restriction", "portability", "objection",
  "withdraw_consent", "opt_out_sale_share", "limit_sensitive", "ferpa_inspect", "ferpa_amend",
  "coppa_review", "coppa_delete",
] as const;
export type DsarType = (typeof DSAR_TYPES)[number];

export const DSAR_STATUSES = ["received", "verifying", "in_progress", "extended", "completed", "rejected", "withdrawn"] as const;
export type DsarStatus = (typeof DSAR_STATUSES)[number];

/**
 * Statutory response window in calendar days. MUST mirror public.dsar_due_days().
 *  - GDPR Art. 12(3): one month, extendable by two further months -> 30 days used.
 *  - nFADP Art. 25(7) + FADO Art. 18: 30 days.
 *  - CCPA §1798.130(a)(2): 45 days, extendable once by 45; opt-out of sale/share: 15 business days (regs §7026) -> 15.
 *  - FERPA 34 CFR 99.10(b): no more than 45 days.
 *  - COPPA: "reasonable" -> 30 days applied.
 */
export function dsarDueDays(jurisdiction: ComplianceRegion, type: DsarType): number {
  if (type === "ferpa_inspect" || type === "ferpa_amend") return 45;
  if (jurisdiction === "US") return type === "opt_out_sale_share" ? 15 : 45;
  return 30;
}

/** Maximum permitted extension (calendar days) beyond the base window. */
export function dsarMaxExtensionDays(jurisdiction: ComplianceRegion): number {
  if (jurisdiction === "EU" || jurisdiction === "UK") return 60; // + two months, with reasons
  if (jurisdiction === "US") return 45;
  // nFADP: a deferral is possible only if the requester is told the new
  // deadline (FADO Art. 18); no fixed cap, so 0 here makes the UI flag it.
  return 0;
}

export function dsarDueDate(receivedAt: Date, jurisdiction: ComplianceRegion, type: DsarType): Date {
  const d = new Date(receivedAt.getTime());
  d.setUTCDate(d.getUTCDate() + dsarDueDays(jurisdiction, type));
  return d;
}

export function daysUntil(due: Date, now: Date = new Date()): number {
  return Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
}
