"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/server";
import { sendEmail } from "@/lib/email/resend";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { bookingConfirmation, coachBookingAlert } from "@/lib/email/templates";
import { logError } from "@/lib/log";
import type { Json } from "@/types/database";
import { trainingAdminDb, trainingDb } from "@/lib/training/db";
import { hostNamesOtherClub } from "@/lib/training/format";
import {
  blackoutSchema, bookSchema, guestCheckoutSchema, openingHoursSchema, packageListSchema, profileSchema, purchaseSchema,
  reasonSchema, rescheduleSchema, serviceInputSchema, settingsSchema, templateSchema, trainingErrorKey, windowSchema, zodKey,
  type BlackoutInput, type BookInput, type GuestCheckoutInput, type OpeningHoursInput, type PackageRowInput, type ProfileInput,
  type PurchaseInput, type ServiceInput, type TemplateInput, type TrainingSettingsInput, type WindowInput,
} from "@/lib/training/validation";
import { z } from "zod";
import { promoErrorKey } from "@/lib/shop/validation";

export type TrainingResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
type Me = SessionUser & { orgId: string };
type Role = "admin" | "finance" | "coach" | "parent";

async function fail(key: string): Promise<{ ok: false; error: string }> {
  const t = await getTranslations();
  return { ok: false, error: t.dynamic(key, undefined, t("training.errors.generic")) };
}
const dbFail = (message: string | null | undefined) => fail(promoErrorKey(message) ?? trainingErrorKey(message));

/** Signed-in user of a club with one of the roles; the org is the profile's (never the client's). */
async function requireRole(roles: Role[]): Promise<Me | null> {
  const me = await getSessionUser();
  if (!me?.orgId || !roles.some((r) => me.roles.includes(r))) return null;
  return me as Me;
}

const isUuid = (v: unknown): v is string => typeof v === "string" && z.string().uuid().safeParse(v).success;

function revalidateTraining(extra: string[] = []) {
  for (const p of [
    "/admin/services", "/admin/training", "/admin/availability", "/admin/bookings", "/admin/credits",
    "/parent/bookings", "/parent/children", "/coach/availability", "/coach/training", "/coach/schedule", ...extra,
  ]) revalidatePath(p);
}

async function audit(me: Me, action: string, table: string, id: string | null, data: Record<string, unknown>) {
  try {
    const { error } = await trainingAdminDb().from("audit_logs").insert({
      org_id: me.orgId, actor_id: me.id, action, target_table: table, target_id: id, new_data: data as Json,
    });
    if (error) logError("training.audit", error, { action });
  } catch (e) {
    logError("training.audit", e, { action });
  }
}

function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "service";
}

// ===========================================================================
// Services (+ which coaches offer them) and packages
// ===========================================================================
export async function saveTrainingService(id: string | null, input: ServiceInput): Promise<TrainingResult<{ id: string }>> {
  const me = await requireRole(["admin"]);
  if (!me) return fail("training.errors.notPermitted");
  if (id !== null && !isUuid(id)) return fail("training.errors.invalidRequest");
  const p = serviceInputSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const db = await trainingDb();
  const row = {
    name: v.name, description: v.description || null, session_type: v.sessionType, max_participants: v.maxParticipants,
    min_participants: v.minParticipants, duration_min: v.durationMin, price_chf: v.price, currency: v.currency || null,
    venue_id: v.venueId, location_text: v.locationText || null, color: v.color || null, is_active: v.isActive, sort_order: v.sortOrder,
    credit_category: v.creditCategory, credits_required: v.creditsRequired,
  };
  let serviceId = id;
  let slug: string;
  if (id) {
    const { data, error } = await db.from("training_services").update(row).eq("id", id).eq("org_id", me.orgId).select("id,slug");
    if (error) return dbFail(error.message);
    if (!data?.length) return fail("training.errors.notFound");
    slug = data[0].slug;
  } else {
    slug = `${slugify(v.name)}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await db.from("training_services").insert({ ...row, org_id: me.orgId, slug }).select("id").single();
    if (error) return dbFail(error.message);
    serviceId = data.id;
  }

  // Coaches offering the service: coaches.serves holds service slugs.
  const { data: coaches, error: cErr } = await db.from("coaches").select("id,serves").eq("org_id", me.orgId);
  if (cErr) return dbFail(cErr.message);
  const wanted = new Set(v.coachIds);
  for (const c of coaches ?? []) {
    const serves: string[] = c.serves ?? [];
    const has = serves.includes(slug);
    if (wanted.has(c.id) === has) continue;
    const next = wanted.has(c.id) ? [...serves, slug] : serves.filter((s) => s !== slug);
    const { error } = await db.from("coaches").update({ serves: next }).eq("id", c.id).eq("org_id", me.orgId);
    if (error) return dbFail(error.message);
  }
  revalidateTraining([`/admin/services/${serviceId}`, "/admin/coaches"]);
  return { ok: true, data: { id: serviceId! } };
}

/** Replace the package rows of a service: update by id, insert new, delete the ones removed. */
export async function saveServicePackages(serviceId: string, rows: PackageRowInput[]): Promise<TrainingResult> {
  const me = await requireRole(["admin"]);
  if (!me) return fail("training.errors.notPermitted");
  if (!isUuid(serviceId)) return fail("training.errors.invalidRequest");
  const p = packageListSchema.safeParse(rows);
  if (!p.success) return fail(zodKey(p.error));
  const db = await trainingDb();
  const { data: svc } = await db.from("training_services").select("id,credit_category").eq("id", serviceId).eq("org_id", me.orgId).maybeSingle();
  if (!svc) return fail("training.errors.notFound");
  const { data: existing, error } = await db.from("credit_packages").select("id").eq("service_id", serviceId).eq("org_id", me.orgId);
  if (error) return dbFail(error.message);
  const t = await getTranslations();
  const keep = new Set<string>();
  for (const [i, r] of p.data.entries()) {
    const row = {
      name: r.name || t("training.packages.defaultName", { count: r.sessions }), credits: r.sessions, price_chf: r.price,
      validity_days: r.validityDays, is_active: r.isActive, sort_order: r.sortOrder || i + 1, description: r.description || null,
      credit_category: svc.credit_category,
    };
    if (r.id && (existing ?? []).some((e) => e.id === r.id)) {
      keep.add(r.id);
      const { error: uErr } = await db.from("credit_packages").update(row).eq("id", r.id).eq("org_id", me.orgId);
      if (uErr) return dbFail(uErr.message);
    } else {
      const { error: iErr } = await db.from("credit_packages").insert({ ...row, org_id: me.orgId, service_id: serviceId });
      if (iErr) return dbFail(iErr.message);
    }
  }
  const removed = (existing ?? []).map((e) => e.id).filter((x) => !keep.has(x));
  if (removed.length) {
    const { error: dErr } = await db.from("credit_packages").delete().in("id", removed).eq("org_id", me.orgId);
    if (dErr) return dbFail(dErr.message);
  }
  revalidateTraining([`/admin/services/${serviceId}`]);
  return { ok: true };
}

// ===========================================================================
// Availability: weekly templates, one-off windows, blackouts, venue hours
// ===========================================================================
/** Admin (any coach) or the coach themself (own rows; RLS enforces). */
async function availabilityActor(coachId: string | null): Promise<Me | null> {
  const me = await requireRole(["admin", "coach"]);
  if (!me) return null;
  if (me.roles.includes("admin")) return me;
  if (!coachId) return null;
  const db = await trainingDb();
  const { data } = await db.from("coaches").select("id").eq("id", coachId).eq("profile_id", me.id).maybeSingle();
  return data ? me : null;
}

export async function saveTemplate(input: TemplateInput): Promise<TrainingResult> {
  const p = templateSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const me = await availabilityActor(v.coachId);
  if (!me) return fail("training.errors.notPermitted");
  const db = await trainingDb();
  const row = {
    coach_id: v.coachId, venue_id: v.venueId, service_id: v.serviceId, weekday: v.weekday, start_time: v.startTime, end_time: v.endTime,
    capacity: v.capacity, valid_from: v.validFrom, valid_until: v.validUntil, is_active: v.isActive,
  };
  const { error } = v.id
    ? await db.from("coach_availability_templates").update(row).eq("id", v.id).eq("org_id", me.orgId)
    : await db.from("coach_availability_templates").insert({ ...row, org_id: me.orgId });
  if (error) return dbFail(error.message);
  revalidateTraining();
  return { ok: true };
}

export async function deleteTemplate(id: string): Promise<TrainingResult> {
  const me = await requireRole(["admin", "coach"]);
  if (!me) return fail("training.errors.notPermitted");
  if (!isUuid(id)) return fail("training.errors.invalidRequest");
  const db = await trainingDb();
  const { data, error } = await db.from("coach_availability_templates").delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("training.errors.notFound");
  revalidateTraining();
  return { ok: true };
}

export async function saveWindow(input: WindowInput): Promise<TrainingResult> {
  const p = windowSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const me = await availabilityActor(v.coachId);
  if (!me) return fail("training.errors.notPermitted");
  const db = await trainingDb();
  const row = {
    coach_id: v.coachId, venue_id: v.venueId, service_id: v.serviceId, capacity: v.capacity,
    starts_at: new Date(v.startsAt).toISOString(), ends_at: new Date(v.endsAt).toISOString(),
  };
  const { error } = v.id
    ? await db.from("coach_availability").update(row).eq("id", v.id).eq("org_id", me.orgId).eq("is_booked", false)
    : await db.from("coach_availability").insert({ ...row, org_id: me.orgId });
  if (error) return dbFail(error.message);
  revalidateTraining();
  return { ok: true };
}

export async function deleteWindow(id: string): Promise<TrainingResult> {
  const me = await requireRole(["admin", "coach"]);
  if (!me) return fail("training.errors.notPermitted");
  if (!isUuid(id)) return fail("training.errors.invalidRequest");
  const db = await trainingDb();
  const { data, error } = await db.from("coach_availability").delete().eq("id", id).eq("org_id", me.orgId).eq("is_booked", false).select("id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("training.errors.notFound");
  revalidateTraining();
  return { ok: true };
}

export async function saveBlackout(input: BlackoutInput): Promise<TrainingResult> {
  const p = blackoutSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const me = await requireRole(["admin", "coach"]);
  if (!me) return fail("training.errors.notPermitted");
  if (!me.roles.includes("admin") && !(await availabilityActor(v.coachId))) return fail("training.errors.notPermitted");
  const db = await trainingDb();
  const row = {
    coach_id: v.coachId, venue_id: v.venueId, reason: v.reason || null,
    starts_at: new Date(v.startsAt).toISOString(), ends_at: new Date(v.endsAt).toISOString(),
  };
  const { error } = v.id
    ? await db.from("training_blackouts").update(row).eq("id", v.id).eq("org_id", me.orgId)
    : await db.from("training_blackouts").insert({ ...row, org_id: me.orgId, created_by: me.id });
  if (error) return dbFail(error.message);
  revalidateTraining();
  return { ok: true };
}

export async function deleteBlackout(id: string): Promise<TrainingResult> {
  const me = await requireRole(["admin", "coach"]);
  if (!me) return fail("training.errors.notPermitted");
  if (!isUuid(id)) return fail("training.errors.invalidRequest");
  const db = await trainingDb();
  const { data, error } = await db.from("training_blackouts").delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("training.errors.notFound");
  revalidateTraining();
  return { ok: true };
}

export async function saveVenueHours(venueId: string, hours: OpeningHoursInput): Promise<TrainingResult> {
  const me = await requireRole(["admin"]);
  if (!me) return fail("training.errors.notPermitted");
  if (!isUuid(venueId)) return fail("training.errors.invalidRequest");
  const p = openingHoursSchema.safeParse(hours);
  if (!p.success) return fail(zodKey(p.error));
  const db = await trainingDb();
  const { data, error } = await db.from("venues").update({ opening_hours: (p.data ?? null) as Json }).eq("id", venueId).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("training.errors.notFound");
  revalidateTraining(["/admin/schedule/venues"]);
  return { ok: true };
}

export async function updateTrainingSettings(input: TrainingSettingsInput): Promise<TrainingResult> {
  const me = await requireRole(["admin"]);
  if (!me) return fail("training.errors.notPermitted");
  const p = settingsSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const admin = trainingAdminDb();
  const { data: row } = await admin.from("app_settings").select("settings").eq("org_id", me.orgId).maybeSingle();
  const before = ((row as { settings?: unknown } | null)?.settings ?? {}) as Record<string, unknown>;
  const settings = {
    ...before,
    bookings_enabled: v.enabled,
    booking: {
      ...((before.booking as Record<string, unknown>) ?? {}),
      cancellation_hours: v.cancellationHours, refund_credits_on_cancel: v.refundCreditsOnCancel,
      slot_step_min: v.slotStepMin, lead_hours: v.leadHours, horizon_days: v.horizonDays,
    },
  };
  const { error } = await admin.from("app_settings").update({ settings: settings as Json }).eq("org_id", me.orgId);
  if (error) return dbFail(error.message);
  await audit(me, "TRAINING_SETTINGS_UPDATED", "app_settings", null, { bookings_enabled: v.enabled, booking: settings.booking });
  revalidateTraining();
  return { ok: true };
}

// ===========================================================================
// Purchases
// ===========================================================================
export async function purchaseTrainingPackage(input: PurchaseInput): Promise<TrainingResult<{ purchaseId: string; invoiceId: string | null; status: string }>> {
  const me = await requireRole(["admin", "parent"]);
  if (!me) return fail("training.errors.notPermitted");
  const p = purchaseSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  if (v.mode !== "invoice" && !me.roles.includes("admin")) return fail("training.errors.notPermitted");
  const db = await trainingDb();
  const { data, error } = await db.rpc("purchase_training_package", {
    p_athlete: v.athleteId, p_service: v.serviceId, p_package: v.packageId, p_mode: v.mode, p_note: v.note || null,
    p_promo_code: v.promoCode || null,
    p_manual_discounts: me.roles.includes("admin") && v.manualDiscountIds.length ? v.manualDiscountIds : null,
  });
  if (error) return dbFail(error.message);
  const r = (data ?? {}) as { purchase_id?: string; invoice_id?: string | null; status?: string };
  revalidateTraining(["/parent/invoices", "/admin/invoices", `/admin/athletes/${v.athleteId}/training`]);
  return { ok: true, data: { purchaseId: r.purchase_id ?? "", invoiceId: r.invoice_id ?? null, status: r.status ?? "" } };
}

export async function cancelTrainingPurchase(purchaseId: string, reason: string): Promise<TrainingResult> {
  const me = await requireRole(["admin"]);
  if (!me) return fail("training.errors.notPermitted");
  if (!isUuid(purchaseId)) return fail("training.errors.invalidRequest");
  const r = reasonSchema.safeParse(reason);
  if (!r.success) return fail(zodKey(r.error));
  const db = await trainingDb();
  const { error } = await db.rpc("cancel_training_purchase", { p_purchase: purchaseId, p_reason: r.data });
  if (error) return dbFail(error.message);
  revalidateTraining(["/admin/invoices", "/parent/invoices"]);
  return { ok: true };
}

// ===========================================================================
// Bookings
// ===========================================================================
async function notifyBooking(me: Me, bookingId: string, payNoteKey: "credits" | "invoice" | "package", amount: number | null) {
  try {
    const admin = trainingAdminDb();
    const { data: b } = await admin.from("training_bookings").select("athlete_id,service_id,coach_id,slot_start").eq("id", bookingId).eq("org_id", me.orgId).maybeSingle();
    if (!b) return;
    const [{ data: athlete }, { data: svc }, { data: coach }] = await Promise.all([
      admin.from("athletes").select("first_name,last_name").eq("id", b.athlete_id).maybeSingle(),
      admin.from("training_services").select("name,currency").eq("id", b.service_id).maybeSingle(),
      admin.from("coaches").select("display_name,profile_id").eq("id", b.coach_id).maybeSingle(),
    ]);
    const org = await getOrgEmailContext(me.orgId);
    const t = await getTranslations(me.orgId);
    const athleteName = athlete ? `${athlete.first_name} ${athlete.last_name}` : "";
    const serviceName = svc?.name ?? "";
    const coachName = coach?.display_name ?? "";
    const when = org.f.dateTime(b.slot_start);
    const payNote = payNoteKey === "invoice" && amount
      ? t("training.email.payInvoice", { amount: org.f.money(amount, svc?.currency ?? undefined) })
      : t(payNoteKey === "package" ? "training.email.payPackage" : "training.email.payCredits");
    if (me.email && me.roles.includes("parent")) {
      const mail = bookingConfirmation({ ...org.brand, parentName: me.fullName ?? "", athleteName, serviceName, coachName, when, payNote });
      await sendEmail({ to: me.email, subject: mail.subject, html: mail.html, fromName: org.senderName ?? org.clubName });
    }
    if (coach?.profile_id) {
      const { data: cp } = await admin.from("profiles").select("email").eq("id", coach.profile_id).maybeSingle();
      if (cp?.email) {
        const alert = coachBookingAlert({ ...org.brand, coachName, athleteName, serviceName, when });
        await sendEmail({ to: cp.email, subject: alert.subject, html: alert.html, fromName: org.senderName ?? org.clubName });
      }
    }
  } catch (e) {
    logError("training.notify", e, { bookingId });
  }
}

export async function bookTrainingSession(input: BookInput): Promise<TrainingResult<{ bookingId: string; purchaseId: string | null; invoiceId: string | null }>> {
  const me = await requireRole(["admin", "parent"]);
  if (!me) return fail("training.errors.notPermitted");
  const p = bookSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const isAdmin = me.roles.includes("admin");
  if (!isAdmin && (v.override || v.mode !== "invoice")) return fail("training.errors.notPermitted");
  const db = await trainingDb();
  const { data, error } = await db.rpc("book_training", {
    p_athlete: v.athleteId, p_service: v.serviceId, p_coach: v.coachId, p_start: new Date(v.start).toISOString(),
    p_pay_with: v.payWith, p_purchase: v.purchaseId, p_package: v.packageId, p_mode: v.mode, p_override: isAdmin && v.override,
    p_notes: v.notes || null, p_promo_code: v.promoCode || null,
  });
  if (error) return dbFail(error.message);
  const r = (data ?? {}) as { booking_id?: string; purchase_id?: string | null; invoice_id?: string | null; price?: number };
  if (r.booking_id) await notifyBooking(me, r.booking_id, v.payWith, r.price ?? null);
  revalidateTraining(["/parent/invoices", `/admin/athletes/${v.athleteId}/training`]);
  return { ok: true, data: { bookingId: r.booking_id ?? "", purchaseId: r.purchase_id ?? null, invoiceId: r.invoice_id ?? null } };
}

export async function rescheduleTrainingSession(bookingId: string, coachId: string, start: string): Promise<TrainingResult> {
  const me = await requireRole(["admin", "parent"]);
  if (!me) return fail("training.errors.notPermitted");
  const p = rescheduleSchema.safeParse({ bookingId, coachId, start });
  if (!p.success) return fail(zodKey(p.error));
  const db = await trainingDb();
  const { error } = await db.rpc("reschedule_training", { p_booking: p.data.bookingId, p_coach: p.data.coachId, p_start: new Date(p.data.start).toISOString() });
  if (error) return dbFail(error.message);
  revalidateTraining([`/parent/bookings/${bookingId}`, `/admin/bookings/${bookingId}`]);
  return { ok: true };
}

export async function cancelTrainingSession(bookingId: string): Promise<TrainingResult<{ refunded: boolean }>> {
  const me = await requireRole(["admin", "finance", "parent"]);
  if (!me) return fail("training.errors.notPermitted");
  if (!isUuid(bookingId)) return fail("training.errors.invalidRequest");
  const db = await trainingDb();
  const { data, error } = await db.rpc("cancel_training_booking", { p_booking: bookingId });
  if (error) return dbFail(error.message);
  revalidateTraining([`/parent/bookings/${bookingId}`, `/admin/bookings/${bookingId}`, "/parent/invoices"]);
  return { ok: true, data: { refunded: Boolean((data as { credits_refunded?: boolean } | null)?.credits_refunded) } };
}

export async function markTrainingSession(bookingId: string, status: "booked" | "completed" | "no_show"): Promise<TrainingResult> {
  const me = await requireRole(["admin", "coach"]);
  if (!me) return fail("training.errors.notPermitted");
  if (!isUuid(bookingId) || !["booked", "completed", "no_show"].includes(status)) return fail("training.errors.invalidRequest");
  const db = await trainingDb();
  const { error } = await db.rpc("mark_training_booking", { p_booking: bookingId, p_status: status });
  if (error) return dbFail(error.message);
  revalidateTraining();
  return { ok: true };
}

export async function confirmTrainingGroup(coachId: string, serviceId: string, start: string): Promise<TrainingResult> {
  const me = await requireRole(["admin"]);
  if (!me) return fail("training.errors.notPermitted");
  if (!isUuid(coachId) || !isUuid(serviceId) || Number.isNaN(Date.parse(start))) return fail("training.errors.invalidRequest");
  const db = await trainingDb();
  const { error } = await db.rpc("confirm_training_group", { p_coach: coachId, p_service: serviceId, p_start: new Date(start).toISOString() });
  if (error) return dbFail(error.message);
  revalidateTraining();
  return { ok: true };
}

export async function cancelTrainingGroup(coachId: string, serviceId: string, start: string, reason: string): Promise<TrainingResult> {
  const me = await requireRole(["admin"]);
  if (!me) return fail("training.errors.notPermitted");
  if (!isUuid(coachId) || !isUuid(serviceId) || Number.isNaN(Date.parse(start))) return fail("training.errors.invalidRequest");
  const r = reasonSchema.safeParse(reason);
  if (!r.success) return fail(zodKey(r.error));
  const db = await trainingDb();
  const { error } = await db.rpc("cancel_training_group", { p_coach: coachId, p_service: serviceId, p_start: new Date(start).toISOString(), p_reason: r.data });
  if (error) return dbFail(error.message);
  revalidateTraining(["/parent/invoices", "/admin/invoices"]);
  return { ok: true };
}

// ===========================================================================
// Athlete training profile (admin, or a coach who trains the athlete)
// ===========================================================================
export async function saveTrainingProfile(input: ProfileInput): Promise<TrainingResult> {
  const me = await requireRole(["admin", "coach"]);
  if (!me) return fail("training.errors.notPermitted");
  const p = profileSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const db = await trainingDb();
  const row = { goals: v.goals || null, notes: v.notes || null, level: v.level || null, focus_areas: v.focusAreas, updated_by: me.id };
  const { data: existing } = await db.from("athlete_training_profiles").select("id").eq("athlete_id", v.athleteId).maybeSingle();
  const { data, error } = existing
    ? await db.from("athlete_training_profiles").update(row).eq("id", existing.id).eq("org_id", me.orgId).select("id")
    : await db.from("athlete_training_profiles").insert({ ...row, org_id: me.orgId, athlete_id: v.athleteId }).select("id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("training.errors.notPermitted");
  revalidateTraining([`/admin/athletes/${v.athleteId}/training`, `/coach/training/${v.athleteId}`, `/parent/children/${v.athleteId}/training`]);
  return { ok: true };
}

// ===========================================================================
// Public booking page: guest (non-member) checkout
// ===========================================================================
export type GuestCheckoutResult = { ok: true; data: { bookingId: string; invoiceId: string | null; signedIn: boolean; authMode: "password" | "magic_link" } } | { ok: false; error: string };

export async function guestCheckout(input: GuestCheckoutInput): Promise<GuestCheckoutResult> {
  const p = guestCheckoutSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;

  // Members use the parent app. A signed-in user never goes through here.
  const current = await getSessionUser();
  if (current) return fail("training.errors.signedIn");

  // The club is the one owning the slug. On a host that names a club, the
  // slug must be that club (no booking into club B through club A's site).
  const tenant = await getTenant();
  if (hostNamesOtherClub(tenant, v.clubSlug)) {
    return fail("training.errors.notFound");
  }
  const admin = trainingAdminDb();
  const { data: org } = await admin.from("organizations").select("id,slug").eq("slug", v.clubSlug).maybeSingle();
  if (!org) return fail("training.errors.notFound");

  // 1) The parent's account (email + password, or a magic link).
  const supabase = await createClient();
  const emailCtx = await getOrgEmailContext(org.id);
  const redirectTo = emailCtx.link(`/auth/callback?redirect=${encodeURIComponent("/parent/bookings")}`);
  let userId: string | null = null;
  let signedIn = false;
  if (v.authMode === "password") {
    const { data, error } = await supabase.auth.signUp({
      email: v.parent.email, password: v.parent.password,
      options: { emailRedirectTo: redirectTo, data: { full_name: v.parent.name } },
    });
    if (error) {
      if (/registered|exists/i.test(error.message)) return fail("training.errors.accountExists");
      if (/password/i.test(error.message)) return fail("training.errors.password");
      logError("training.guest.signup", error);
      return fail("training.errors.generic");
    }
    // An existing address comes back without identities: send them to login.
    if (!data.user || (data.user.identities && data.user.identities.length === 0)) return fail("training.errors.accountExists");
    userId = data.user.id;
    signedIn = Boolean(data.session);
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email: v.parent.email, email_confirm: false, user_metadata: { full_name: v.parent.name } });
    if (error || !data.user) {
      if (error && /registered|exists/i.test(error.message)) return fail("training.errors.accountExists");
      logError("training.guest.create", error);
      return fail("training.errors.generic");
    }
    userId = data.user.id;
  }

  // 2) Family (non-member), child, consents and the booking, in one transaction.
  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  // With a promo code the wrapper hands the code to book_training() (same transaction).
  const { data: res, error: rpcErr } = await admin.rpc(v.promoCode ? "training_guest_checkout_promo" : "training_guest_checkout", {
    p_slug: v.clubSlug,
    p_user: userId,
    p_payload: {
      parent: { name: v.parent.name, email: v.parent.email, phone: v.parent.phone },
      child: { first_name: v.child.firstName, last_name: v.child.lastName, dob: v.child.dob },
      consents: v.consents,
      guardian_confirmed: v.guardianConfirmed,
      service_id: v.serviceId, coach_id: v.coachId, start: new Date(v.start).toISOString(),
      pay_with: v.payWith, package_id: v.packageId, ip, promo_code: v.promoCode || null,
    } as unknown as Json,
  });
  if (rpcErr) {
    // Nothing was booked: remove the account created a moment ago so the
    // parent can simply try again with the same email address.
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch (e) {
      logError("training.guest.rollback", e);
    }
    return dbFail(rpcErr.message);
  }
  const r = (res ?? {}) as { booking_id?: string; invoice_id?: string | null };

  // 3) Magic link: the email that signs them in (the booking is already made).
  if (v.authMode === "magic_link") {
    const { error } = await supabase.auth.signInWithOtp({ email: v.parent.email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
    if (error) logError("training.guest.otp", error);
  }
  return { ok: true, data: { bookingId: r.booking_id ?? "", invoiceId: r.invoice_id ?? null, signedIn, authMode: v.authMode } };
}
