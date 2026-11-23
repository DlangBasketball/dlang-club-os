/**
 * Data review flags (table data_review_flags): which codes belong to the
 * attendance / roster module, and where each flag's record lives in the admin
 * app. Pure (client + server safe). Labels are translated by the caller
 * (adminAttendance.review.codes.<CODE>, with the raw code as fallback).
 */

/** Codes written by attendance_review_flags() (migration 20250420104000). */
export const ATTENDANCE_FLAG_CODES = [
  "ATHLETE_WITHOUT_GUARDIAN",
  "TEAM_WITHOUT_COACH",
  "TRAINING_WITHOUT_TEAM",
  "MEMBERSHIP_INACTIVE_NO_END",
  "MEMBERSHIP_DATE_UNCERTAIN",
  "LEGACY_ATTENDANCE_SESSION",
  "ATTENDANCE_UNFINISHED",
] as const;

/** Billing codes (migration 20250420103500): visible to finance too. */
export const BILLING_FLAG_CODES = [
  "CATEGORY_AMBIGUOUS",
  "CREDIT_ACTIVITY_UNRESOLVED",
  "NO_ATHLETE",
  "NO_CURRENT_SEASON",
  "MEMBERSHIP_EXISTS",
  "MIGRATION_ERROR",
] as const;

export type FlagGroup = "attendance" | "billing" | "other";

export function flagGroup(code: string): FlagGroup {
  if ((ATTENDANCE_FLAG_CODES as readonly string[]).includes(code)) return "attendance";
  if ((BILLING_FLAG_CODES as readonly string[]).includes(code)) return "billing";
  return "other";
}

/** Attendance flags are admin-only (finance never sees attendance data). */
export function canSeeFlag(code: string, roles: { admin: boolean; finance: boolean }): boolean {
  if (roles.admin) return true;
  return roles.finance && flagGroup(code) !== "attendance";
}

type FlagLike = { entityTable: string; entityId: string | null; reasonCode: string; details: Record<string, unknown> };

const str = (v: unknown): string | null => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

/** Admin page of the flagged record (null when there is none to open). */
export function flagHref(f: FlagLike): string | null {
  const id = f.entityId;
  const teamId = str(f.details.team_id);
  switch (f.entityTable) {
    case "team_memberships":
      return teamId ? `/admin/teams/${teamId}?tab=roster` : null;
    case "teams":
      return id ? `/admin/teams/${id}?tab=coaches` : null;
    case "athletes":
      return id ? `/admin/athletes/${id}${f.reasonCode === "ATHLETE_WITHOUT_GUARDIAN" ? "" : "?tab=billing"}` : null;
    case "events":
      if (!id) return null;
      return f.reasonCode === "ATTENDANCE_UNFINISHED" ? `/admin/schedule/${id}/attendance` : `/admin/schedule/${id}`;
    case "attendance_sessions":
      return id ? `/admin/attendance/${id}` : null;
    case "invoices":
      return id ? `/admin/invoices/${id}` : null;
    case "families":
      return id ? `/admin/families/${id}` : null;
    default:
      return null;
  }
}
