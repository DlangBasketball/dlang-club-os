"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import type { AppRole } from "@/lib/auth/roles";
import { getTranslations } from "@/lib/i18n/server";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { dispatchNotification } from "@/lib/notifications/dispatch";
import { createCheckoutSession } from "@/lib/actions/invoice";
import { SELECTABLE_CATEGORIES } from "@/lib/billing/activities";
import { bookingErrorCode, SERVICE_KINDS, type BookingDetail } from "@/lib/booking/types";
import type { PayerCandidates } from "@/lib/booking/admin-form";

/*
 * Admin booking screens — the server actions the booking workflow contract
 * (src/lib/actions/booking-workflow.ts) does not cover: pickers for the
 * New Booking form (athletes, families, open group sessions, Bill To
 * candidates), the service booking setup (kind, revenue category, default
 * space, capacity), sending a booking invoice to its payer and an online
 * payment link. The org is always the caller's session org; every read is
 * RLS-scoped and filtered by org_id explicitly.
 */
type Me = SessionUser & { orgId: string };
export type AbResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string; code?: string };

const STAFF: AppRole[] = ["admin", "finance"];
const uuid = z.string().uuid();

async function staff(roles: AppRole[] = STAFF): Promise<Me | null> {
  const me = await getSessionUser();
  if (!me?.orgId || !roles.some((r) => me.roles.includes(r))) return null;
  return me as Me;
}
async function denied(): Promise<{ ok: false; error: string; code: string }> {
  const t = await getTranslations();
  return { ok: false, code: "NOT_AUTHORIZED", error: t("bookingWorkflow.errors.NOT_AUTHORIZED") };
}
async function fail(message: string | null | undefined): Promise<{ ok: false; error: string; code?: string }> {
  const t = await getTranslations();
  const code = bookingErrorCode(message);
  if (code) return { ok: false, code, error: t.dynamic(`bookingWorkflow.errors.${code}`, undefined, t("bookingWorkflow.errors.generic")) };
  if (message) logError("adminBooking", message);
  return { ok: false, error: t("bookingWorkflow.errors.generic") };
}
/** Untyped client for tables the generated types do not list (venue_spaces). RLS still applies. */
const generic = async () => (await createClient()) as unknown as SupabaseClient;

/** Escape the LIKE wildcards of a user search. */
const like = (q: string) => `%${q.replace(/[\\%_,()]/g, " ").trim()}%`;

// ===========================================================================
// Pickers
// ===========================================================================
export type AthleteHit = { id: string; firstName: string; lastName: string; dob: string | null; familyId: string; familyName: string | null };

/** Athletes of the club by name (first, last or "first last"), active first. No medical or contact data. */
export async function searchBookingAthletes(query: string): Promise<AbResult<AthleteHit[]>> {
  const me = await staff();
  if (!me) return denied();
  const q = z.string().trim().max(80).safeParse(query);
  if (!q.success) return { ok: true, data: [] };
  const words = q.data.split(/\s+/).filter(Boolean).slice(0, 3);
  const db = await createClient();
  let req = db.from("athletes").select("id,first_name,last_name,dob,family_id,status").eq("org_id", me.orgId);
  for (const w of words) req = req.or(`first_name.ilike.${like(w)},last_name.ilike.${like(w)}`);
  const { data, error } = await req.order("last_name").order("first_name").limit(25);
  if (error) return fail(error.message);
  const rows = (data ?? []) as { id: string; first_name: string; last_name: string; dob: string | null; family_id: string; status: string }[];
  const famIds = [...new Set(rows.map((r) => r.family_id).filter(Boolean))];
  const fams = famIds.length
    ? ((await db.from("families").select("id,name").eq("org_id", me.orgId).in("id", famIds)).data ?? []) as { id: string; name: string }[]
    : [];
  const famName = new Map(fams.map((f) => [f.id, f.name]));
  rows.sort((a, b) => Number(a.status === "archived") - Number(b.status === "archived"));
  return {
    ok: true,
    data: rows.filter((r) => r.status !== "archived").map((r) => ({
      id: r.id, firstName: r.first_name, lastName: r.last_name, dob: r.dob, familyId: r.family_id, familyName: famName.get(r.family_id) ?? null,
    })),
  };
}

export type FamilyHit = { id: string; name: string; contactName: string | null; contactEmail: string | null };

/** Families (households) by family name, contact name or contact e-mail — to link a minor to an existing guardian. */
export async function searchBookingFamilies(query: string): Promise<AbResult<FamilyHit[]>> {
  const me = await staff();
  if (!me) return denied();
  const q = z.string().trim().min(2).max(80).safeParse(query);
  if (!q.success) return { ok: true, data: [] };
  const db = await createClient();
  const p = like(q.data);
  const { data, error } = await db.from("families").select("id,name,contact_name,contact_email").eq("org_id", me.orgId)
    .or(`name.ilike.${p},contact_name.ilike.${p},contact_email.ilike.${p}`).order("name").limit(15);
  if (error) return fail(error.message);
  return {
    ok: true,
    data: ((data ?? []) as { id: string; name: string; contact_name: string | null; contact_email: string | null }[])
      .map((f) => ({ id: f.id, name: f.name, contactName: f.contact_name, contactEmail: f.contact_email })),
  };
}

export type OpenSession = {
  id: string; coachId: string; coachName: string; startsAt: string; endsAt: string; capacity: number; participants: number;
  placesLeft: number; spaceName: string | null;
};

/** Upcoming scheduled sessions of a (group) service with their remaining places — "join existing session". */
export async function listOpenSessions(serviceId: string): Promise<AbResult<OpenSession[]>> {
  const me = await staff();
  if (!me) return denied();
  if (!uuid.safeParse(serviceId).success) return { ok: true, data: [] };
  const db = await generic();
  const { data, error } = await db.from("training_sessions")
    .select("id,coach_id,starts_at,ends_at,capacity,venue_space_id")
    .eq("org_id", me.orgId).eq("service_id", serviceId).eq("status", "scheduled")
    .gte("starts_at", new Date().toISOString()).order("starts_at").limit(40);
  if (error) return fail(error.message);
  const rows = (data ?? []) as { id: string; coach_id: string; starts_at: string; ends_at: string; capacity: number; venue_space_id: string | null }[];
  if (!rows.length) return { ok: true, data: [] };
  const [bk, coaches, spaces] = await Promise.all([
    db.from("training_bookings").select("session_id").eq("org_id", me.orgId).in("session_id", rows.map((r) => r.id)).in("status", ["booked", "completed", "no_show"]),
    db.from("coaches").select("id,display_name").eq("org_id", me.orgId).in("id", [...new Set(rows.map((r) => r.coach_id))]),
    rows.some((r) => r.venue_space_id)
      ? db.from("venue_spaces").select("id,name").eq("org_id", me.orgId).in("id", [...new Set(rows.map((r) => r.venue_space_id).filter(Boolean))] as string[])
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);
  const count = new Map<string, number>();
  for (const b of (bk.data ?? []) as { session_id: string }[]) count.set(b.session_id, (count.get(b.session_id) ?? 0) + 1);
  const coachName = new Map(((coaches.data ?? []) as { id: string; display_name: string }[]).map((c) => [c.id, c.display_name]));
  const spaceName = new Map(((spaces.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  return {
    ok: true,
    data: rows.map((r) => {
      const n = count.get(r.id) ?? 0;
      return {
        id: r.id, coachId: r.coach_id, coachName: coachName.get(r.coach_id) ?? "", startsAt: r.starts_at, endsAt: r.ends_at,
        capacity: r.capacity, participants: n, placesLeft: Math.max(0, r.capacity - n), spaceName: r.venue_space_id ? spaceName.get(r.venue_space_id) ?? null : null,
      };
    }),
  };
}

/** Bill To candidates of an athlete (billing_payer_candidates): saved payers incl. siblings', guardians, family default. */
export async function getBookingPayerCandidates(athleteId: string): Promise<AbResult<PayerCandidates>> {
  const me = await staff();
  if (!me) return denied();
  if (!uuid.safeParse(athleteId).success) return fail("ATHLETE_NOT_FOUND");
  const db = await createClient();
  const { data, error } = await db.rpc("billing_payer_candidates", { p_athlete: athleteId });
  if (error) return fail(error.message);
  return { ok: true, data: data as unknown as PayerCandidates };
}

// ===========================================================================
// Service booking setup
// ===========================================================================
const setupSchema = z.object({
  serviceId: uuid,
  kind: z.enum(SERVICE_KINDS),
  billingCategory: z.enum(SELECTABLE_CATEGORIES),
  defaultVenueSpaceId: uuid.nullable(),
  maxParticipants: z.coerce.number().int().min(1).max(100),
  coachIds: z.array(uuid).max(200),
  /** Families may request this service from the parent portal (booking requests). */
  bookableByFamilies: z.boolean().optional(),
});
export type ServiceSetupInput = z.input<typeof setupSchema>;

/**
 * Kind (private / group / trial / package), revenue category (never
 * "other"), default venue space, capacity and eligible coaches of a
 * service. Admin only (training_services RLS + training_service_coaches_set).
 */
export async function saveServiceBookingSetup(input: ServiceSetupInput): Promise<AbResult> {
  const me = await staff(["admin"]);
  if (!me) return denied();
  const p = setupSchema.safeParse(input);
  const t = await getTranslations();
  if (!p.success) return { ok: false, code: "INVALID_INPUT", error: t("bookingWorkflow.errors.invalid") };
  const v = p.data;
  const db = await createClient();
  if (v.defaultVenueSpaceId) {
    const { data: sp } = await (await generic()).from("venue_spaces").select("id").eq("org_id", me.orgId).eq("id", v.defaultVenueSpaceId).maybeSingle();
    if (!sp) return fail("SPACE_NOT_FOUND");
  }
  const capacity = v.kind === "group" ? Math.max(2, v.maxParticipants) : 1;
  const { data, error } = await db.from("training_services").update({
    kind: v.kind, billing_category: v.billingCategory, default_venue_space_id: v.defaultVenueSpaceId,
    max_participants: capacity, ...(v.kind === "group" ? { session_type: "group" } : { session_type: "individual", min_participants: 1 }),
    ...(v.bookableByFamilies === undefined ? {} : { bookable_by_families: v.bookableByFamilies }),
  }).eq("id", v.serviceId).eq("org_id", me.orgId).select("id");
  if (error) return fail(error.message);
  if (!data?.length) return fail("SERVICE_NOT_FOUND");
  const { error: cErr } = await db.rpc("training_service_coaches_set", { p_service: v.serviceId, p_coaches: v.coachIds });
  if (cErr) return fail(cErr.message);
  revalidatePath("/admin/services", "layout");
  revalidatePath("/admin/bookings", "layout");
  return { ok: true, message: t("adminBooking.services.saved") };
}

// ===========================================================================
// Invoice delivery + online payment
// ===========================================================================
/**
 * Send (draft -> issued, final number) or re-send a booking invoice to its
 * payer (payer e-mail, else the family contact). The delivery is an
 * email_logs row with invoice_id, shown on the booking.
 */
export async function sendBookingInvoice(bookingId: string): Promise<AbResult<{ emailOk: boolean | null }>> {
  const me = await staff();
  if (!me) return denied();
  if (!uuid.safeParse(bookingId).success) return fail("BOOKING_NOT_FOUND");
  const t = await getTranslations();
  const db = await createClient();
  const { data: det, error: dErr } = await db.rpc("booking_detail", { p_booking: bookingId });
  if (dErr) return fail(dErr.message);
  const b = det as unknown as BookingDetail | null;
  if (!b?.invoice) return fail("NOT_INVOICED");
  const { data: inv, error } = await db.from("invoices")
    .select("id,number,status,total_chf,adjustments_total,due_date,family_id,payer_email,payer_name,payer_profile_id")
    .eq("id", b.invoice.id).eq("org_id", me.orgId).maybeSingle();
  if (error) return fail(error.message);
  if (!inv) return fail("NOT_INVOICED");
  if (["cancelled", "refunded", "written_off"].includes(String(inv.status))) return fail("INVOICE_CANCELLED");
  let number = inv.number as string;
  if (inv.status === "draft") {
    // Same issue step as the invoice page (sendInvoice): the final number is assigned at issue.
    const { data: up, error: uErr } = await db.from("invoices").update({ status: "sent" }).eq("id", inv.id).eq("org_id", me.orgId).select("number").maybeSingle();
    if (uErr) return fail(uErr.message);
    number = (up?.number as string | undefined) ?? number;
  }
  let to = (inv.payer_email as string | null) ?? null;
  if (!to) {
    const { data: fam } = await db.from("families").select("contact_email").eq("id", inv.family_id).eq("org_id", me.orgId).maybeSingle();
    to = (fam as { contact_email: string | null } | null)?.contact_email ?? null;
  }
  const payerProfile = (inv.payer_profile_id as string | null) ?? null;
  let emailOk: boolean | null = null;
  if (!to && !payerProfile) emailOk = false;
  else {
    try {
      const res = await dispatchNotification({
        orgId: me.orgId, type: "invoice_sent", recipientProfileId: payerProfile, toEmail: to, invoiceId: inv.id,
        vars: {
          ...(inv.payer_name ? { parent_name: inv.payer_name as string } : {}),
          invoice_number: number, amount_due: Number(inv.total_chf) + Number(inv.adjustments_total ?? 0),
          ...(inv.due_date ? { due_date: inv.due_date as string } : {}),
          ...(payerProfile ? { payment_link: `/parent/invoices/${inv.id}` } : {}),
        },
      });
      emailOk = res.emailLogId ? res.emailOk : Boolean(res.notificationId);
    } catch (e) {
      logError("adminBooking.sendInvoice", e);
      emailOk = false;
    }
  }
  revalidatePath(`/admin/bookings/${bookingId}`);
  revalidatePath("/admin/invoices", "layout");
  return {
    ok: true, data: { emailOk },
    message: emailOk === false ? t("bookingWorkflow.messages.invoiceEmailFailed") : t("bookingWorkflow.messages.invoiceSent"),
  };
}

/** Online payment link (Stripe Checkout, card / TWINT) for the booking's open invoice. Paid status comes only from the webhook. */
export async function bookingPaymentLink(bookingId: string): Promise<AbResult<{ url: string }>> {
  const me = await staff();
  if (!me) return denied();
  if (!uuid.safeParse(bookingId).success) return fail("BOOKING_NOT_FOUND");
  const db = await createClient();
  const { data: det, error } = await db.rpc("booking_detail", { p_booking: bookingId });
  if (error) return fail(error.message);
  const b = det as unknown as BookingDetail | null;
  if (!b?.invoice) return fail("NOT_INVOICED");
  const res = await createCheckoutSession(b.invoice.id);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, data: { url: res.url } };
}
