import { z } from "zod";

/*
 * Team attendance — shared contract (client + server safe, no I/O).
 * Schema: supabase/migrations/20250420104000_team_attendance.sql.
 * Full contract: docs/team-attendance.md.
 */

export const MARK_STATUSES = ["unmarked", "present", "late", "excused", "unexcused"] as const;
export type MarkStatus = (typeof MARK_STATUSES)[number];
/** Statuses a mark can be finalized / corrected to (never "unmarked"). */
export const FINAL_STATUSES = ["present", "late", "excused", "unexcused"] as const;
export type FinalStatus = (typeof FINAL_STATUSES)[number];

export const SHEET_STATUSES = ["draft", "final", "reopened"] as const;
export type SheetStatus = (typeof SHEET_STATUSES)[number];

export const ABSENCE_CATEGORIES = ["illness", "injury", "school", "family", "travel", "other"] as const;
export type AbsenceCategory = (typeof ABSENCE_CATEGORIES)[number];
export const ABSENCE_STATUSES = ["reported", "acknowledged", "superseded", "withdrawn"] as const;

export const ALERT_STATUSES = ["pending", "sent", "failed", "no_contact", "suppressed", "superseded"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];
export const ALERT_KINDS = ["initial", "correction"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const CORRECTION_REQUEST_STATUSES = ["open", "accepted", "rejected", "withdrawn"] as const;
export const SESSION_ACCESS_STATUSES = ["approved", "pending", "rejected"] as const;

/** Event types that take an attendance sheet. */
export const SHEET_EVENT_TYPES = ["training", "game", "tournament"] as const;

/** Days an approved substitute keeps access after finalization (= SQL ta_grace_days()). */
export const SUBSTITUTE_GRACE_DAYS = 7;
/** Delivery attempts of a no-show alert before staff follow-up (= SQL ta_alert_max_attempts()). */
export const ALERT_MAX_ATTEMPTS = 5;

/**
 * Error codes raised (or returned as `code`) by the attendance RPCs. Each
 * has a translation under teamAttendance.errors.<CODE>.
 */
export const ATTENDANCE_ERROR_CODES = [
  "NOT_AUTHORIZED", "EVENT_NOT_FOUND", "TEAM_NOT_FOUND", "ATHLETE_NOT_FOUND", "COACH_NOT_FOUND", "PROFILE_NOT_FOUND",
  "SEASON_NOT_FOUND", "EVENT_HAS_NO_TEAM", "EVENT_TYPE_NOT_SUPPORTED", "EVENT_CANCELLED", "EVENT_CLOSED",
  "SHEET_NOT_FOUND", "SHEET_FINAL", "SHEET_NOT_FINAL", "INVALID_STATUS", "INVALID_MARKS", "NOT_ON_SHEET",
  "ALREADY_ON_SHEET", "GUEST_MARKED", "MARK_NOT_FOUND", "NOTE_TOO_LONG", "REASON_REQUIRED", "REASON_TOO_LONG",
  "REQUEST_ID_REUSED", "VERSION_CONFLICT", "UNMARKED_PLAYERS", "REPORTED_ABSENCE_UNACKNOWLEDGED",
  "ALREADY_ON_TEAM", "NOT_ON_TEAM", "INVALID_EFFECTIVE_DATE", "SAME_TEAM", "SELECTION_ROSTER_MANAGED",
  "INVALID_JERSEY", "JERSEY_TAKEN", "MEMBERSHIP_HAS_ATTENDANCE", "ABSENCE_CUTOFF_PASSED", "INVALID_CATEGORY",
  "REPORT_NOT_FOUND", "REPORT_CLOSED", "ASSIGNMENT_NOT_FOUND", "ALREADY_TEAM_COACH", "INVALID_ROLE",
  "CORRECTION_NOT_FOUND", "CORRECTION_CLOSED", "CORRECTION_OPEN_EXISTS", "MESSAGE_REQUIRED", "MESSAGE_TOO_LONG",
  "NOTE_REQUIRED", "PLAYER_ALREADY_LINKED", "PLAYER_IS_GUARDIAN", "INVALID_RANGE", "INVALID_GROUP",
  "TRAINING_OUTSIDE_SEASON_WINDOW", "TRAINING_IN_BREAK", "LABEL_REQUIRED", "BREAK_DATES_INVALID", "BREAK_NOT_FOUND",
] as const;
export type AttendanceErrorCode = (typeof ATTENDANCE_ERROR_CODES)[number];

/** The attendance error code inside a database error message, if any. */
export function attendanceErrorCode(message: string | null | undefined): AttendanceErrorCode | null {
  const m = message ?? "";
  for (const code of ATTENDANCE_ERROR_CODES) if (new RegExp(`\\b${code}\\b`).test(m)) return code;
  return null;
}

/** Warning a save / correction returns; the UI must make the coach acknowledge it. */
export type AttendanceWarning = { code: "REPORTED_ABSENCE"; athlete_id: string; report_id: string; acknowledged: boolean };

export type SheetMark = {
  mark_id: string | null; athlete_id: string; first_name: string; last_name: string;
  jersey_number: number | null; position: string | null; photo_path: string | null;
  is_guest: boolean; status: MarkStatus; finalized_status: FinalStatus | null; rev: number; note: string | null;
  updated_by: string | null; updated_by_name: string | null; updated_at: string | null; reported_absence_ack: boolean;
  reported_absence: null | {
    report_id: string; reason: string | null; reason_category: AbsenceCategory; status: "reported" | "acknowledged";
    needs_review: boolean; reporter_kind: "guardian" | "player"; created_at: string;
  };
};

/** attendance_sheet / attendance_open result. */
export type AttendanceSheet = {
  event: {
    /** null for a booked training session (its roster = the confirmed bookings, docs/booking-workflow.md §5). */
    id: string; team_id: string | null; team_name: string | null; type: string; title: string | null; starts_at: string; ends_at: string;
    status: string; cancel_reason: string | null; timezone: string; local_date: string; ended: boolean; tracked: boolean;
    location_name: string | null; training_session_id?: string | null;
  };
  sheet: null | {
    id: string; status: SheetStatus; version: number; roster_date: string; led_by_coach_id: string | null; led_by_name: string | null;
    finalized_at: string | null; finalized_by: string | null; first_finalized_at: string | null; reopened_at: string | null;
    finalize_count: number; correction_count: number;
  };
  access: { is_admin: boolean; is_team_coach: boolean; is_substitute: boolean; can_edit: boolean; can_correct: boolean; can_resolve_requests: boolean };
  marks: SheetMark[];
  counts: { total: number; unmarked: number; present: number; late: number; excused: number; unexcused: number; guests: number; reported_absences: number };
};

export type SaveResult = {
  ok: true; version: number; version_conflict: boolean; replayed: boolean;
  applied: { athlete_id: string; status: MarkStatus; rev: number }[];
  conflicts: { athlete_id: string; your_status: MarkStatus; current_status: MarkStatus; current_rev: number;
               updated_by: string | null; updated_by_name: string | null; updated_at: string }[];
  warnings: AttendanceWarning[];
};

export type FinalizeResult =
  | { ok: true; already_final: boolean; version: number; finalized_at: string; alerts_created: number; replayed?: boolean; event_ended?: boolean }
  | { ok: false; code: "VERSION_CONFLICT"; version: number }
  | { ok: false; code: "UNMARKED_PLAYERS"; version: number; unmarked: { athlete_id: string; first_name: string; last_name: string }[] }
  | { ok: false; code: "REPORTED_ABSENCE_UNACKNOWLEDGED"; version: number; athletes: { athlete_id: string; first_name: string; last_name: string; report_id: string }[] };

// ---------------------------------------------------------------------------
// Input schemas (server actions)
// ---------------------------------------------------------------------------
export const uuidSchema = z.string().uuid();
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const reason = z.string().trim().min(3).max(500);

export const markInputSchema = z.object({
  athleteId: uuidSchema,
  status: z.enum(MARK_STATUSES),
  /** The mark's `rev` the client loaded (per-mark merge); omit to overwrite. */
  baseRev: z.number().int().min(0).optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export const saveSchema = z.object({
  eventId: uuidSchema,
  marks: z.array(markInputSchema).max(200),
  expectedVersion: z.number().int().min(1),
  requestId: uuidSchema,
  ackReported: z.boolean().default(false),
});
export type SaveInput = z.input<typeof saveSchema>;

export const finalizeSchema = z.object({
  eventId: uuidSchema,
  ledByCoachId: uuidSchema.nullable().optional(),
  expectedVersion: z.number().int().min(1),
  requestId: uuidSchema,
  ackReported: z.boolean().default(false),
});
export type FinalizeInput = z.input<typeof finalizeSchema>;

export const correctSchema = z.object({
  eventId: uuidSchema, athleteId: uuidSchema, status: z.enum(FINAL_STATUSES), reason, requestId: uuidSchema,
  ackReported: z.boolean().default(false),
});
export type CorrectInput = z.input<typeof correctSchema>;

export const absenceSchema = z.object({
  eventId: uuidSchema, athleteId: uuidSchema, category: z.enum(ABSENCE_CATEGORIES).default("other"),
  reason: z.string().trim().max(500).optional().nullable().transform((v) => (v ? v : null)),
});
export type AbsenceInput = z.input<typeof absenceSchema>;

export const correctionRequestSchema = z.object({
  eventId: uuidSchema, athleteId: uuidSchema, message: z.string().trim().min(1).max(1000),
  requestedStatus: z.enum(FINAL_STATUSES).nullable().optional(),
});
export type CorrectionRequestInput = z.input<typeof correctionRequestSchema>;

export const resolveCorrectionSchema = z.object({
  requestId: uuidSchema, accept: z.boolean(), newStatus: z.enum(FINAL_STATUSES).nullable().optional(),
  note: z.string().trim().max(1000).optional().nullable().transform((v) => (v ? v : null)),
}).refine((v) => v.accept || Boolean(v.note), { path: ["note"] });
export type ResolveCorrectionInput = z.input<typeof resolveCorrectionSchema>;

export const rosterAddSchema = z.object({
  teamId: uuidSchema, athleteId: uuidSchema, effectiveOn: isoDateSchema.nullable().optional(),
  jerseyNumber: z.number().int().min(0).max(999).nullable().optional(),
  position: z.string().trim().max(60).nullable().optional(),
});
export const rosterLeaveSchema = z.object({ teamId: uuidSchema, athleteId: uuidSchema, effectiveOn: isoDateSchema, reason });
export const rosterTransferSchema = z.object({
  fromTeamId: uuidSchema, toTeamId: uuidSchema, athleteId: uuidSchema, effectiveOn: isoDateSchema, reason,
}).refine((v) => v.fromTeamId !== v.toTeamId, { path: ["toTeamId"] });

export const breakSchema = z.object({
  id: uuidSchema.nullable().optional(),
  label: z.string().trim().min(1).max(120),
  startsOn: isoDateSchema, endsOn: isoDateSchema,
  seasonId: uuidSchema.nullable().optional(),
}).refine((v) => v.endsOn >= v.startsOn, { path: ["endsOn"] });
export type BreakInput = z.input<typeof breakSchema>;

/**
 * Parent-portal page of one finalized mark (built by the parent portal UI);
 * alert e-mails and in-app notices link here ("request a correction").
 */
export function attendancePortalPath(eventId: string, athleteId: string): string {
  return `/parent/attendance/team/${encodeURIComponent(eventId)}?athlete=${encodeURIComponent(athleteId)}`;
}
