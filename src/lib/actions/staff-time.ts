"use server";

import { revalidatePath } from "next/cache";
import { requireRole, writeAudit, type ActionResult } from "@/lib/people/server";
import { getLocaleContext } from "@/lib/i18n/server";
import { zonedWallTimeToUtc } from "@/lib/format";
import { staffDb } from "@/lib/staff/db";
import { geoStatusFor, type GeoStatus } from "@/lib/staff/hours";
import {
  clockInSchema,
  entrySchema,
  geofenceSchema,
  shiftTemplateSchema,
  staffErrorKey,
  timesheetSchema,
  uuid,
  type ClockInInput,
  type EntryInput,
  type GeofenceInput,
  type ShiftTemplateInput,
  type TimesheetInput,
} from "@/lib/staff/validation";
import { logError } from "@/lib/log";

/**
 * Employee clock-in and admin time management. The org always comes from the
 * signed-in user's profile; the clock RPCs act only on the caller's own shift
 * and use server time; corrections / approvals are admin-only RPCs that need
 * a reason and write audit_logs. A device position is used in memory to
 * compute a distance flag and is never stored or logged.
 */

const STAFF = ["admin", "finance", "coach"] as ("admin" | "finance" | "coach")[];

function revalidateStaff(profileId?: string | null) {
  revalidatePath("/coach", "layout");
  revalidatePath("/admin/timesheets");
  if (profileId) revalidatePath(`/admin/timesheets/${profileId}`);
  revalidatePath("/admin/staff-schedules");
  revalidatePath("/admin/calendar");
}

function wallToIso(local: string, timeZone: string): string | null {
  const [d, tm] = local.split("T");
  return zonedWallTimeToUtc(d, tm, timeZone)?.toISOString() ?? null;
}

export async function clockIn(input: ClockInInput): Promise<ActionResult<{ id: string; linked: boolean; geo: GeoStatus }>> {
  const { me, t } = await requireRole(STAFF);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  const p = clockInSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("staff.errors.invalid") };
  const db = await staffDb();

  let geo: GeoStatus = "not_checked";
  if (p.data.position) {
    const venue = p.data.venueId
      ? (await db.from("venues").select("latitude,longitude,geofence_radius_m").eq("id", p.data.venueId).eq("org_id", me.orgId).maybeSingle()).data
      : null;
    geo = geoStatusFor(
      { lat: p.data.position.lat, lng: p.data.position.lng, accuracy: p.data.position.accuracy ?? null },
      venue ? { latitude: venue.latitude === null ? null : Number(venue.latitude), longitude: venue.longitude === null ? null : Number(venue.longitude), radiusM: venue.geofence_radius_m } : null,
    );
  }

  const { data, error } = await db.rpc("staff_clock_in", { p_venue: p.data.venueId, p_geo: geo, p_note: p.data.note });
  if (error || !data) {
    logError("staff.clockIn", error);
    return { ok: false, error: t.dynamic(staffErrorKey(error?.message)) };
  }
  const { data: row } = await db.from("staff_time_entries").select("program_session_id,event_id").eq("id", data).maybeSingle();
  const linked = !!(row?.program_session_id || row?.event_id);
  revalidateStaff(me.id);
  return { ok: true, message: t(linked ? "staff.messages.clockedInLinked" : "staff.messages.clockedIn"), data: { id: data, linked, geo } };
}

export async function clockOut(note?: string | null): Promise<ActionResult> {
  const { me, t } = await requireRole(STAFF);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  const n = typeof note === "string" ? note.trim().slice(0, 500) : null;
  const db = await staffDb();
  const { data, error } = await db.rpc("staff_clock_out", { p_note: n || null });
  if (error) {
    logError("staff.clockOut", error);
    return { ok: false, error: t.dynamic(staffErrorKey(error.message)) };
  }
  const status = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>).status : null;
  revalidateStaff(me.id);
  return { ok: true, message: t(status === "missed" ? "staff.messages.clockOutMissed" : "staff.messages.clockedOut") };
}

export async function setBreak(start: boolean): Promise<ActionResult> {
  const { me, t } = await requireRole(STAFF);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  if (typeof start !== "boolean") return { ok: false, error: t("staff.errors.invalid") };
  const db = await staffDb();
  const { error } = await db.rpc("staff_break", { p_start: start });
  if (error) {
    logError("staff.setBreak", error);
    return { ok: false, error: t.dynamic(staffErrorKey(error.message)) };
  }
  revalidateStaff(me.id);
  return { ok: true, message: t(start ? "staff.messages.breakStarted" : "staff.messages.breakEnded") };
}

// ---------------------------------------------------------------------------
// Admin: corrections, approvals, missed clock-outs
// ---------------------------------------------------------------------------

export async function saveTimeEntry(input: EntryInput): Promise<ActionResult<{ id: string }>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  const p = entrySchema.safeParse(input);
  if (!p.success) {
    const reasonIssue = p.error.issues.some((i) => i.path[0] === "reason");
    return { ok: false, error: t(reasonIssue ? "staff.errors.reasonRequired" : "staff.errors.invalidTimes") };
  }
  const { timeZone } = await getLocaleContext(me.orgId);
  const clockIn = wallToIso(p.data.clockIn, timeZone);
  const clockOut = wallToIso(p.data.clockOut, timeZone);
  if (!clockIn || !clockOut) return { ok: false, error: t("staff.errors.invalidTimes") };
  let breaks: { start: string; end: string }[] | null = null;
  if (p.data.breaks) {
    breaks = [];
    for (const b of p.data.breaks) {
      const s = wallToIso(b.start, timeZone);
      const e = wallToIso(b.end, timeZone);
      if (!s || !e) return { ok: false, error: t("staff.errors.invalidBreaks") };
      breaks.push({ start: s, end: e });
    }
  }
  const db = await staffDb();
  const { data, error } = await db.rpc("staff_save_time_entry", {
    p_entry: p.data.entryId,
    p_profile: p.data.profileId,
    p_clock_in: clockIn,
    p_clock_out: clockOut,
    p_reason: p.data.reason,
    p_venue: p.data.venueId,
    p_breaks: breaks,
  });
  if (error || !data) {
    logError("staff.saveTimeEntry", error);
    return { ok: false, error: t.dynamic(staffErrorKey(error?.message)) };
  }
  // The RPC writes the audit row with the reason; this adds the app intent.
  await writeAudit(me, p.data.entryId ? "staff.entry.correct" : "staff.entry.create", "staff_time_entries", data, { via: "admin_timesheet" });
  const { data: row } = await db.from("staff_time_entries").select("profile_id").eq("id", data).maybeSingle();
  revalidateStaff(row?.profile_id ?? p.data.profileId);
  return { ok: true, message: t("staff.messages.entrySaved"), data: { id: data } };
}

export async function deleteTimeEntry(entryId: string, reason: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  if (!uuid.safeParse(entryId).success) return { ok: false, error: t("staff.errors.notFound") };
  if (typeof reason !== "string" || reason.trim().length < 3) return { ok: false, error: t("staff.errors.reasonRequired") };
  const db = await staffDb();
  const { data: row } = await db.from("staff_time_entries").select("profile_id").eq("id", entryId).eq("org_id", me.orgId).maybeSingle();
  const { error } = await db.rpc("staff_delete_time_entry", { p_entry: entryId, p_reason: reason.trim().slice(0, 500) });
  if (error) {
    logError("staff.deleteTimeEntry", error);
    return { ok: false, error: t.dynamic(staffErrorKey(error.message)) };
  }
  await writeAudit(me, "staff.entry.delete", "staff_time_entries", entryId);
  revalidateStaff(row?.profile_id);
  return { ok: true, message: t("staff.messages.entryDeleted") };
}

export async function setTimesheet(input: TimesheetInput): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  const p = timesheetSchema.safeParse(input);
  if (!p.success || p.data.to < p.data.from) return { ok: false, error: t("staff.errors.invalid") };
  const db = await staffDb();
  const { data, error } = await db.rpc("staff_set_timesheet", {
    p_profile: p.data.profileId, p_from: p.data.from, p_to: p.data.to, p_approve: p.data.approve, p_note: p.data.note,
  });
  if (error) {
    logError("staff.setTimesheet", error);
    return { ok: false, error: t.dynamic(staffErrorKey(error.message)) };
  }
  await writeAudit(me, p.data.approve ? "staff.timesheet.approve" : "staff.timesheet.reopen", "staff_timesheets", data ?? null, {
    from: p.data.from, to: p.data.to,
  });
  revalidateStaff(p.data.profileId);
  return { ok: true, message: t(p.data.approve ? "staff.messages.timesheetApproved" : "staff.messages.timesheetReopened") };
}

export async function flagMissedClockOuts(): Promise<ActionResult<{ count: number }>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  const db = await staffDb();
  const { data, error } = await db.rpc("staff_flag_missed_clockouts", {});
  if (error) {
    logError("staff.flagMissed", error);
    return { ok: false, error: t.dynamic(staffErrorKey(error.message)) };
  }
  const count = Number(data ?? 0);
  if (count > 0) await writeAudit(me, "staff.missed_clockouts.flag", "staff_time_entries", null, { count });
  revalidateStaff();
  return { ok: true, message: t("staff.messages.missedFlagged", { count }), data: { count } };
}

// ---------------------------------------------------------------------------
// Admin: planned shifts and clock-in locations
// ---------------------------------------------------------------------------

export async function saveShiftTemplate(input: ShiftTemplateInput): Promise<ActionResult<{ id: string }>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  const p = shiftTemplateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("staff.errors.invalid") };
  const db = await staffDb();
  const { data: staff } = await db.from("staff_roles").select("profile_id").eq("org_id", me.orgId).eq("profile_id", p.data.profileId)
    .in("role", ["admin", "finance", "coach"]).limit(1);
  if (!staff?.length) return { ok: false, error: t("staff.errors.employeeNotFound") };
  const row = {
    org_id: me.orgId,
    profile_id: p.data.profileId,
    venue_id: p.data.venueId,
    weekday: p.data.weekday,
    start_time: p.data.startTime,
    end_time: p.data.endTime,
    valid_from: p.data.validFrom ?? null,
    valid_until: p.data.validUntil ?? null,
    label: p.data.label,
    is_active: p.data.isActive,
  };
  const res = p.data.id
    ? await db.from("staff_shift_templates").update(row).eq("id", p.data.id).eq("org_id", me.orgId).select("id").maybeSingle()
    : await db.from("staff_shift_templates").insert({ ...row, created_by: me.id }).select("id").single();
  if (res.error || !res.data) {
    logError("staff.saveShiftTemplate", res.error);
    return { ok: false, error: t.dynamic(staffErrorKey(res.error?.message ?? "NOT_AUTHORIZED")) };
  }
  await writeAudit(me, p.data.id ? "staff.shift_template.update" : "staff.shift_template.create", "staff_shift_templates", res.data.id, {
    profile_id: p.data.profileId, weekday: p.data.weekday,
  });
  revalidateStaff(p.data.profileId);
  return { ok: true, message: t("staff.messages.templateSaved"), data: { id: res.data.id } };
}

export async function deleteShiftTemplate(id: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  if (!uuid.safeParse(id).success) return { ok: false, error: t("staff.errors.notFound") };
  const db = await staffDb();
  const { data, error } = await db.from("staff_shift_templates").delete().eq("id", id).eq("org_id", me.orgId).select("id,profile_id");
  if (error || !data?.length) {
    logError("staff.deleteShiftTemplate", error);
    return { ok: false, error: t.dynamic(error ? staffErrorKey(error.message) : "staff.errors.notFound") };
  }
  await writeAudit(me, "staff.shift_template.delete", "staff_shift_templates", id);
  revalidateStaff(data[0].profile_id);
  return { ok: true, message: t("staff.messages.templateDeleted") };
}

export async function setVenueGeofence(input: GeofenceInput): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("staff.errors.forbidden") };
  const p = geofenceSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("staff.errors.invalid") };
  const db = await staffDb();
  const { data, error } = await db.from("venues")
    .update({ latitude: p.data.latitude, longitude: p.data.longitude, geofence_radius_m: p.data.radiusM })
    .eq("id", p.data.venueId).eq("org_id", me.orgId).select("id");
  if (error || !data?.length) {
    logError("staff.setVenueGeofence", error);
    return { ok: false, error: t.dynamic(error ? staffErrorKey(error.message) : "staff.errors.venueNotFound") };
  }
  await writeAudit(me, "venue.geofence.update", "venues", p.data.venueId, { radius_m: p.data.radiusM, has_coordinates: p.data.latitude !== null });
  revalidatePath("/admin/staff-schedules");
  return { ok: true, message: t("staff.messages.geofenceSaved") };
}
