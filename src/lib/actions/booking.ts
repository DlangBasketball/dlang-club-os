"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";
import { sendEmail } from "@/lib/email/resend";
import { bookingConfirmation, coachBookingAlert } from "@/lib/email/templates";
import { formatDate, formatTime } from "@/lib/utils";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const ERR: Record<string, string> = {
  BOOKINGS_DISABLED: "Online booking is currently disabled.",
  SLOT_TAKEN: "That slot was just taken — please pick another.",
  SLOT_NOT_FOUND: "That slot is no longer available.",
  NOT_AUTHORIZED: "You can only manage your own children's bookings.",
  INSUFFICIENT_CREDITS: "Not enough training credits for this service.",
  SERVICE_NOT_CREDIT_ELIGIBLE: "This service can't be paid with credits.",
  SERVICE_NOT_FOUND: "That service is unavailable.",
  NOT_CANCELLABLE: "This booking can no longer be cancelled.",
  NOT_RESCHEDULABLE: "This booking can no longer be rescheduled.",
};
const friendly = (m: string) => ERR[m] ?? m;

async function requireAdmin() {
  const me = await getSessionUser();
  return me && me.roles.includes("admin") ? me : null;
}

// ===========================================================================
// PARENT: book / reschedule / cancel
// ===========================================================================
export async function bookSession(athleteId: string, serviceId: string, slotId: string, payWith: "credits" | "invoice"): Promise<ActionResult<{ bookingId: string }>> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: "Not signed in" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("book_training_session", { p_athlete: athleteId, p_service: serviceId, p_slot: slotId, p_pay_with: payWith });
  if (error) return { ok: false, error: friendly(error.message) };
  const res = (data ?? {}) as { booking_id?: string; invoice_id?: string | null; price_chf?: number; credits_used?: number };

  // Best-effort notifications (no-ops if email isn't configured).
  try {
    const admin = createAdminClient();
    const [{ data: athlete }, { data: svc }] = await Promise.all([
      admin.from("athletes").select("first_name,last_name").eq("id", athleteId).maybeSingle(),
      admin.from("training_services").select("name").eq("id", serviceId).maybeSingle(),
    ]);
    const { data: booking } = await admin.from("training_bookings").select("coach_id,slot_start").eq("id", res.booking_id ?? "").maybeSingle();
    const athleteName = athlete ? `${(athlete as { first_name: string }).first_name} ${(athlete as { last_name: string }).last_name}` : "your child";
    const serviceName = (svc as { name?: string } | null)?.name ?? "Training session";
    const when = booking ? `${formatDate((booking as { slot_start: string }).slot_start)} at ${formatTime((booking as { slot_start: string }).slot_start)}` : "soon";

    let coachName = "your coach";
    let coachEmail: string | null = null;
    if (booking) {
      const { data: coach } = await admin.from("coaches").select("display_name,profile_id").eq("id", (booking as { coach_id: string }).coach_id).maybeSingle();
      coachName = (coach as { display_name?: string } | null)?.display_name ?? coachName;
      const profileId = (coach as { profile_id?: string } | null)?.profile_id;
      if (profileId) {
        const { data: cp } = await admin.from("profiles").select("email").eq("id", profileId).maybeSingle();
        coachEmail = (cp as { email?: string } | null)?.email ?? null;
      }
    }
    const payNote = payWith === "credits" ? `Paid with ${res.credits_used ?? 0} training credit(s).` : `An invoice for CHF ${(res.price_chf ?? 0).toFixed(2)} has been issued.`;
    const parent = bookingConfirmation({ parentName: me.fullName ?? "there", athleteName, serviceName, coachName, when, payNote });
    if (me.email) await sendEmail({ to: me.email, subject: parent.subject, html: parent.html });
    if (coachEmail) {
      const alert = coachBookingAlert({ coachName, athleteName, serviceName, when });
      await sendEmail({ to: coachEmail, subject: alert.subject, html: alert.html });
    }
  } catch { /* email is best-effort */ }

  revalidatePath("/parent/bookings");
  return { ok: true, data: { bookingId: res.booking_id ?? "" } };
}

export async function rescheduleBookingAction(bookingId: string, newSlotId: string): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: "Not signed in" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reschedule_booking", { p_booking: bookingId, p_new_slot: newSlotId });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/parent/bookings");
  revalidatePath(`/parent/bookings/${bookingId}`);
  revalidatePath("/admin/bookings");
  return { ok: true };
}

export async function cancelBookingAction(bookingId: string): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: "Not signed in" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_training_booking", { p_booking: bookingId });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/parent/bookings");
  revalidatePath(`/parent/bookings/${bookingId}`);
  revalidatePath("/admin/bookings");
  return { ok: true };
}

// ===========================================================================
// ADMIN: services
// ===========================================================================
const serviceSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().optional().default(""),
  durationMin: z.coerce.number().int().min(15).max(480),
  priceChf: z.coerce.number().min(0),
  creditCategory: z.enum(["personal", "nutrition", "mental"]),
  creditsRequired: z.coerce.number().int().min(0).max(99),
  isActive: z.boolean().default(true),
});
export type ServiceInput = z.input<typeof serviceSchema>;

function slugify(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60); }

export async function createService(input: ServiceInput): Promise<ActionResult<{ id: string }>> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  const p = serviceSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid service" };
  const d = p.data;
  const supabase = await createClient();
  const { data, error } = await supabase.from("training_services").insert({
    org_id: me.orgId, slug: `${slugify(d.name)}-${Math.random().toString(36).slice(2, 6)}`, name: d.name,
    description: d.description || null, duration_min: d.durationMin, price_chf: d.priceChf,
    credit_category: d.creditCategory, credits_required: d.creditsRequired, is_active: d.isActive,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/services");
  return { ok: true, data: { id: data.id } };
}

export async function updateService(id: string, input: ServiceInput): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  const p = serviceSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid service" };
  const d = p.data;
  const supabase = await createClient();
  const { error } = await supabase.from("training_services").update({
    name: d.name, description: d.description || null, duration_min: d.durationMin, price_chf: d.priceChf,
    credit_category: d.creditCategory, credits_required: d.creditsRequired, is_active: d.isActive,
  }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/services");
  return { ok: true };
}

export async function toggleService(id: string, isActive: boolean): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  const supabase = await createClient();
  const { error } = await supabase.from("training_services").update({ is_active: isActive }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/services");
  return { ok: true };
}

// ===========================================================================
// ADMIN: credit packages + grants
// ===========================================================================
const packageSchema = z.object({
  name: z.string().trim().min(1),
  creditCategory: z.enum(["personal", "nutrition", "mental"]),
  credits: z.coerce.number().int().min(1),
  priceChf: z.coerce.number().min(0),
});
export type PackageInput = z.input<typeof packageSchema>;

export async function createCreditPackage(input: PackageInput): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  const p = packageSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid package" };
  const d = p.data;
  const supabase = await createClient();
  const { error } = await supabase.from("credit_packages").insert({ org_id: me.orgId, name: d.name, credit_category: d.creditCategory, credits: d.credits, price_chf: d.priceChf });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/credits");
  return { ok: true };
}

export async function grantCredits(athleteId: string, category: "personal" | "nutrition" | "mental", credits: number): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: "Admins only" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("grant_training_credits", { p_athlete: athleteId, p_category: category, p_credits: credits });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/admin/credits");
  return { ok: true };
}

// ===========================================================================
// ADMIN: booking settings (cancellation rules + enable toggle)
// ===========================================================================
export async function updateBookingSettings(input: { enabled: boolean; cancellationHours: number; refundCreditsOnCancel: boolean }): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me?.orgId) return { ok: false, error: "Admins only" };
  const admin = createAdminClient();
  const { data: row } = await admin.from("app_settings").select("settings").eq("org_id", me.orgId).maybeSingle();
  const settings = (row?.settings ?? {}) as Record<string, unknown>;
  settings.bookings_enabled = input.enabled;
  settings.booking = { cancellation_hours: Math.max(0, Math.round(input.cancellationHours)), refund_credits_on_cancel: input.refundCreditsOnCancel };
  const { error } = await admin.from("app_settings").update({ settings }).eq("org_id", me.orgId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/services");
  return { ok: true };
}

// ===========================================================================
// COACH/ADMIN: availability
// ===========================================================================
export async function addAvailability(coachId: string, startISO: string, endISO: string): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!me || !(me.roles.includes("admin") || me.roles.includes("coach"))) return { ok: false, error: "Not permitted" };
  if (!startISO || !endISO || new Date(endISO) <= new Date(startISO)) return { ok: false, error: "End time must be after the start time." };
  const supabase = await createClient();
  const { error } = await supabase.from("coach_availability").insert({ org_id: me.orgId, coach_id: coachId, starts_at: startISO, ends_at: endISO });
  if (error) {
    if (error.message.includes("coach_availability_no_overlap")) return { ok: false, error: "That overlaps an existing slot." };
    return { ok: false, error: error.message };
  }
  revalidatePath("/coach/availability");
  revalidatePath("/admin/availability");
  return { ok: true };
}

export async function removeAvailability(slotId: string): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!me || !(me.roles.includes("admin") || me.roles.includes("coach"))) return { ok: false, error: "Not permitted" };
  const supabase = await createClient();
  const { error } = await supabase.from("coach_availability").delete().eq("id", slotId).eq("is_booked", false);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/coach/availability");
  revalidatePath("/admin/availability");
  return { ok: true };
}
