import { z } from "zod";

/** zod schemas + DB error mapping for the staff-time, lesson-plan and calendar actions. */

export const uuid = z.string().uuid();
const optUuid = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().uuid().nullable());
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** "YYYY-MM-DDTHH:MM" from a datetime-local input (club wall-clock time). */
export const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/);
const optText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() ? v.trim() : null) : v ?? null), z.string().max(max).nullable());

export const clockInSchema = z.object({
  venueId: optUuid,
  note: optText(500),
  position: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000).nullable().optional() })
    .nullable()
    .optional(),
});
export type ClockInInput = z.input<typeof clockInSchema>;

export const entrySchema = z
  .object({
    entryId: optUuid,
    profileId: optUuid,
    clockIn: localDateTime,
    clockOut: localDateTime,
    venueId: optUuid,
    reason: z.string().trim().min(3).max(500),
    breaks: z.array(z.object({ start: localDateTime, end: localDateTime })).max(10).nullable().optional(),
  })
  .refine((e) => e.entryId || e.profileId, { path: ["profileId"] });
export type EntryInput = z.input<typeof entrySchema>;

export const timesheetSchema = z.object({
  profileId: uuid,
  from: dayKey,
  to: dayKey,
  approve: z.boolean(),
  note: optText(500),
});
export type TimesheetInput = z.input<typeof timesheetSchema>;

export const shiftTemplateSchema = z
  .object({
    id: optUuid,
    profileId: uuid,
    venueId: optUuid,
    weekday: z.coerce.number().int().min(1).max(7),
    startTime: time,
    endTime: time,
    validFrom: z.preprocess((v) => (v === "" ? null : v), dayKey.nullable().optional()),
    validUntil: z.preprocess((v) => (v === "" ? null : v), dayKey.nullable().optional()),
    label: optText(120),
    isActive: z.boolean().default(true),
  })
  .refine((t) => t.startTime !== t.endTime, { path: ["endTime"] })
  .refine((t) => !t.validFrom || !t.validUntil || t.validUntil >= t.validFrom, { path: ["validUntil"] });
export type ShiftTemplateInput = z.input<typeof shiftTemplateSchema>;

export const geofenceSchema = z
  .object({
    venueId: uuid,
    latitude: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().min(-90).max(90).nullable()),
    longitude: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().min(-180).max(180).nullable()),
    radiusM: z.coerce.number().int().min(25).max(5000),
  })
  .refine((g) => (g.latitude === null) === (g.longitude === null), { path: ["longitude"] });
export type GeofenceInput = z.input<typeof geofenceSchema>;

export const drillSchema = z.object({
  name: z.string().trim().min(1).max(160),
  minutes: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().int().min(0).max(600).nullable()),
  description: optText(1000),
});

export const lessonPlanSchema = z.object({
  kind: z.enum(["session", "event"]),
  itemId: uuid,
  title: optText(160),
  objectives: optText(4000),
  drills: z.array(drillSchema).max(50),
  notes: optText(4000),
  sharedWithParents: z.boolean(),
});
export type LessonPlanInput = z.input<typeof lessonPlanSchema>;

export const LESSON_PLAN_BUCKET = "lesson-plans";
export const LESSON_PLAN_MAX_BYTES = 10 * 1024 * 1024;
export const LESSON_PLAN_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const CLUB_EVENT_TYPES = ["international", "tournament", "meeting", "social", "holiday", "trip", "other"] as const;
export const CLUB_EVENT_AUDIENCES = ["everyone", "staff", "parents"] as const;

export const clubEventSchema = z
  .object({
    id: optUuid,
    title: z.string().trim().min(1).max(160),
    type: z.enum(CLUB_EVENT_TYPES),
    allDay: z.boolean(),
    startDate: dayKey,
    startTime: z.preprocess((v) => (v === "" ? null : v), time.nullable().optional()),
    endDate: dayKey,
    endTime: z.preprocess((v) => (v === "" ? null : v), time.nullable().optional()),
    venueId: optUuid,
    teamId: optUuid,
    location: optText(200),
    audience: z.enum(CLUB_EVENT_AUDIENCES),
    description: optText(4000),
    url: z.preprocess(
      (v) => (typeof v === "string" && v.trim() ? v.trim() : null),
      z.string().max(500).regex(/^https:\/\//i).nullable(),
    ),
  })
  .refine((e) => e.allDay || (e.startTime && e.endTime), { path: ["startTime"] })
  .refine((e) => e.endDate >= e.startDate, { path: ["endDate"] });
export type ClubEventInput = z.input<typeof clubEventSchema>;

/** Translation key (under staff.errors) for a database / RPC error message. */
export function staffErrorKey(message: string | null | undefined): string {
  const m = message ?? "";
  const map: [RegExp, string][] = [
    [/ALREADY_CLOCKED_IN/, "alreadyClockedIn"],
    [/NOT_CLOCKED_IN/, "notClockedIn"],
    [/ALREADY_ON_BREAK/, "alreadyOnBreak"],
    [/NOT_ON_BREAK/, "notOnBreak"],
    [/REASON_REQUIRED/, "reasonRequired"],
    [/INVALID_TIMES|staff_time_entries_times_chk/, "invalidTimes"],
    [/INVALID_BREAKS/, "invalidBreaks"],
    [/TIMESHEET_APPROVED/, "timesheetApproved"],
    [/OPEN_ENTRIES/, "openEntries"],
    [/EMPLOYEE_NOT_FOUND/, "employeeNotFound"],
    [/VENUE_NOT_FOUND/, "venueNotFound"],
    [/SESSION_NOT_FOUND/, "sessionNotFound"],
    [/EVENT_NOT_FOUND/, "eventNotFound"],
    [/ENTRY_NOT_FOUND|TIMESHEET_NOT_FOUND/, "notFound"],
    [/CROSS_ORG_REFERENCE/, "invalid"],
    [/NOT_AUTHORIZED|row-level security|permission denied/, "forbidden"],
    [/duplicate key/, "duplicate"],
  ];
  for (const [re, key] of map) if (re.test(m)) return `staff.errors.${key}`;
  return "staff.errors.generic";
}
