/** Stable RPC exception codes of the club approval workflow -> catalog keys (approvals.errors.*). */
export const APPROVAL_ERROR_CODES = [
  "ALREADY_REQUESTED", "ALREADY_REGISTERED", "ALREADY_MEMBER", "ALREADY_DECIDED", "INFO_ALREADY_REQUESTED", "NO_INFO_REQUESTED",
  "MESSAGE_REQUIRED", "MESSAGE_TOO_LONG", "REQUEST_NOT_FOUND", "REQUEST_ID_REQUIRED", "REQUEST_ID_CONFLICT", "APPROVAL_NOT_REQUIRED",
  "PROGRAM_NOT_FOUND", "PROGRAM_NOT_OPEN", "PROGRAM_ARCHIVED", "REGISTRATION_CLOSED", "AGE_OUT_OF_RANGE", "ATHLETE_REQUIRED",
  "ATHLETE_NOT_FOUND", "FAMILY_NOT_FOUND", "TYPE_NOT_FOUND", "TYPE_INACTIVE", "INVALID_DECISION", "CLUB_APPROVAL_REQUIRED",
  "NOT_AUTHORIZED",
] as const;
export type ApprovalErrorCode = (typeof APPROVAL_ERROR_CODES)[number];

/** Validation codes of proposed profile details sent with a request (participants.errors.*). */
export const PROFILE_ERROR_CODES = [
  "FIELD_NOT_ALLOWED", "INVALID_HEIGHT", "INVALID_WEIGHT", "INVALID_JERSEY_NUMBER", "INVALID_DOB", "INVALID_SEX", "TOO_LONG",
] as const;

export function approvalErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  // Longest codes first so INFO_ALREADY_REQUESTED is not read as ALREADY_REQUESTED.
  for (const c of [...APPROVAL_ERROR_CODES].sort((a, b) => b.length - a.length)) if (m.includes(c)) return `approvals.errors.${c}`;
  // Proposed profile details (club_profile_proposal, 20250420106200): the participant catalog's messages.
  for (const c of PROFILE_ERROR_CODES) if (new RegExp(`\\b${c}\\b`).test(m)) return `participants.errors.${c}`;
  if (/row-level security|permission denied/i.test(m)) return "approvals.errors.NOT_AUTHORIZED";
  return "approvals.errors.generic";
}
