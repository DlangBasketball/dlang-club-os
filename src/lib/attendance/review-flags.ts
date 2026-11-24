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
  // attendance consistency reconcile (migration 20250420105000)
  "MULTIPLE_LEADS",
  "ATTENDANCE_NO_LEAD",
  "ATTENDANCE_MARK_NOT_FINALIZED",
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

/** Participant profile codes (migration 20250420105600): admin only (children's identity data). */
export const PEOPLE_FLAG_CODES = [
  "ATHLETE_ELIGIBILITY_CHANGE",
  "ATHLETE_LINK_REQUEST",
  "POSSIBLE_DUPLICATE",
  // athlete data check (migration 20250420106200): staff confirm a login link
  "POSSIBLE_SELF_LINK",
] as const;

/** Flags decided in the participant review panel (approve / decline), not with the generic resolve form. */
export const DECIDED_IN_PANEL_CODES = ["ATHLETE_ELIGIBILITY_CHANGE", "ATHLETE_LINK_REQUEST", "POSSIBLE_SELF_LINK"] as const;

export type FlagGroup = "attendance" | "billing" | "people" | "other";

export function flagGroup(code: string): FlagGroup {
  if ((ATTENDANCE_FLAG_CODES as readonly string[]).includes(code)) return "attendance";
  if ((BILLING_FLAG_CODES as readonly string[]).includes(code)) return "billing";
  if ((PEOPLE_FLAG_CODES as readonly string[]).includes(code)) return "people";
  return "other";
}

/** Attendance and people flags are admin-only (finance sees billing and other flags). */
export function canSeeFlag(code: string, roles: { admin: boolean; finance: boolean }): boolean {
  if (roles.admin) return true;
  const g = flagGroup(code);
  return roles.finance && g !== "attendance" && g !== "people";
}

/** True when the flag is settled through the participant review panel. */
export function decidedInPanel(code: string): boolean {
  return (DECIDED_IN_PANEL_CODES as readonly string[]).includes(code);
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
      return id ? `/admin/athletes/${id}${f.reasonCode === "ATHLETE_WITHOUT_GUARDIAN" || f.reasonCode === "POSSIBLE_DUPLICATE" || f.reasonCode === "POSSIBLE_SELF_LINK" ? "" : "?tab=billing"}` : null;
    case "athlete_change_requests":
    case "athlete_link_requests": {
      const athleteId = str(f.details.athlete_id);
      return athleteId ? `/admin/athletes/${athleteId}` : null;
    }
    case "events":
      if (!id) return null;
      return f.reasonCode === "ATTENDANCE_UNFINISHED" || f.reasonCode === "MULTIPLE_LEADS" ? `/admin/schedule/${id}/attendance` : `/admin/schedule/${id}`;
    case "team_attendance_sheets": {
      const eventId = str(f.details.event_id);
      return eventId ? `/admin/schedule/${eventId}/attendance` : null;
    }
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
