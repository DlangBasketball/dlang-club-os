import type { ComplianceRegion } from "./regions";

/**
 * Retention defaults by data category. MUST mirror
 * public.default_retention_months() in
 * supabase/migrations/20250420091900_compliance_regions.sql.
 * Engineering defaults only — each club confirms with counsel.
 */
export const DATA_CATEGORIES = [
  "athlete_profile", "guardian_contact", "medical", "attendance", "registrations",
  "financial", "consent_records", "parental_consents", "communications", "media",
  "documents", "audit_logs", "ai_queries", "dsar_records", "breach_records",
  "education_records", "marketing",
] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

export const DATA_CATEGORY_LABELS: Record<DataCategory, string> = {
  athlete_profile: "Athlete / participant profile",
  guardian_contact: "Parent & guardian contact details",
  medical: "Medical & health information",
  attendance: "Attendance records",
  registrations: "Registrations & enrolments",
  financial: "Invoices, payments & bookkeeping",
  consent_records: "Consent & waiver records",
  parental_consents: "Verifiable parental consent (COPPA)",
  communications: "Messages & notifications",
  media: "Photos & video",
  documents: "Uploaded documents",
  audit_logs: "Security audit logs",
  ai_queries: "Assistant questions",
  dsar_records: "Data-subject request records",
  breach_records: "Breach incident records",
  education_records: "Education records (FERPA)",
  marketing: "Marketing preferences",
};

export function defaultRetentionMonths(region: ComplianceRegion, category: DataCategory): number {
  switch (category) {
    case "financial": return region === "US" ? 84 : 120;
    case "medical": return 12;
    case "athlete_profile":
    case "guardian_contact":
    case "attendance":
    case "communications":
    case "marketing": return 24;
    case "registrations": return 36;
    case "consent_records": return region === "US" ? 72 : 120;
    case "parental_consents":
    case "media":
    case "documents":
    case "dsar_records": return 36;
    case "audit_logs":
    case "breach_records":
    case "education_records": return 60;
    case "ai_queries": return 6;
  }
}

export function defaultRetentionSchedule(region: ComplianceRegion): Record<DataCategory, number> {
  return Object.fromEntries(DATA_CATEGORIES.map((c) => [c, defaultRetentionMonths(region, c)])) as Record<DataCategory, number>;
}

export function formatMonths(m: number): string {
  if (m % 12 === 0) return `${m / 12} year${m === 12 ? "" : "s"}`;
  return `${m} month${m === 1 ? "" : "s"}`;
}
