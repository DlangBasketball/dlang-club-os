"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import type { AppRole } from "@/lib/auth/roles";
import { getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchNotification, retryEmailLog } from "@/lib/notifications/dispatch";
import type { Json } from "@/types/database";
import { runBookingNotifications } from "@/lib/booking/notify";
import { instalmentChoiceSchema } from "@/lib/booking/instalments";
import { instalmentsDb } from "@/lib/booking/instalments-db";
import { holdThirdPartyTraining, quoteThirdPartyTraining, thirdPartyIds } from "@/lib/public-entry/server";
import { consentErrorCode } from "@/lib/public-entry/shared";
import {
  bookingErrorCode, bookingPayloadSchema, cancelPayloadSchema, declinePayloadSchema, familyRequestSchema, payerSchema, quickCreateSchema,
  reschedulePayloadSchema, toBookingRpcPayload, toFamilyRequestRpcPayload, toPayerRpcPayload, toQuickCreateRpcPayload,
  type BookingPayloadInput, type BookingQuote, type CancelPayloadInput, type ConfirmResult, type DeclinePayloadInput, type DuplicateCheck,
  type FamilyQuote, type FamilyRequestInput, type FamilyRequestResult, type InvoiceResult, type PayerInput, type QuickCreateInput,
  type QuickCreateResult, type RequestDecisionResult, type ReschedulePayloadInput,
} from "@/lib/booking/types";

/*
 * Booking workflow — server actions (migration 20250420104400). The org is
 * always the caller's session org; every RPC re-checks tenant and role in
 * SQL. Writes take a client-generated requestId (uuid, one per user intent,
 * reused on retry: `newRequestId()` in src/lib/billing/request-id.ts).
 *
 * Result: { ok: true, data?, message? } | { ok: false, error, code? }, the
 * error translated from bookingWorkflow.errors.<CODE>. Refusals that carry
 * data (SETUP_MISSING with the missing setup, DUPLICATE_SUSPECTED with the
 * candidates) arrive as ok: true with data.ok === false — see
 * docs/booking-workflow.md §6.
 */
export type BkResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string; code?: string };

type Me = SessionUser & { orgId: string };
const STAFF: AppRole[] = ["admin", "finance"];

async function session(roles: AppRole[] = STAFF): Promise<{ me: Me | null; t: Translator }> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId) return { me: null, t };
  if (!roles.some((r) => me.roles.includes(r))) return { me: null, t };
  return { me: me as Me, t };
}

function fail(t: Translator, error: { message?: string } | string | null | undefined): { ok: false; error: string; code?: string } {
  const msg = typeof error === "string" ? error : error?.message ?? "";
  const code = bookingErrorCode(msg);
  if (code) return { ok: false, code, error: t.dynamic(`bookingWorkflow.errors.${code}`, undefined, t("bookingWorkflow.errors.generic")) };
  if (msg) logError("bookingWorkflow", msg);
  return { ok: false, error: t("bookingWorkflow.errors.generic") };
}
const denied = (t: Translator) => ({ ok: false as const, code: "NOT_AUTHORIZED", error: t("bookingWorkflow.errors.NOT_AUTHORIZED") });
const invalid = (t: Translator, code?: string) => ({ ok: false as const, code: code ?? "INVALID_INPUT", error: t("bookingWorkflow.errors.invalid") });
const requestIdSchema = z.string().uuid();

function revalidateBookings(bookingId?: string) {
  revalidatePath("/admin/bookings", "layout");
  revalidatePath("/admin/schedule", "layout");
  revalidatePath("/admin/invoices", "layout");
  revalidatePath("/coach", "layout");
  revalidatePath("/parent", "layout");
  revalidatePath("/player", "layout");
  if (bookingId) revalidatePath(`/admin/bookings/${bookingId}`);
}

/** Deliver the queued notifications of a booking right away (best effort; retried from the follow-up list). */
async function notifyNow(orgId: string, bookingId: string) {
  await runBookingNotifications({ orgId, bookingId, limit: 20 });
}

// ===========================================================================
// Quote / confirm / reschedule / cancel
// ===========================================================================
/** What confirming would do: price, package coverage, warnings, blocking errors, setup_missing. Writes nothing. */
export async function quoteBooking(input: BookingPayloadInput): Promise<BkResult<BookingQuote>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = bookingPayloadSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("booking_quote", { p_payload: toBookingRpcPayload(p.data) as Json });
  if (error) return fail(t, error);
  return { ok: true, data: data as unknown as BookingQuote };
}

export async function confirmBooking(input: BookingPayloadInput, requestId: string): Promise<BkResult<ConfirmResult>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = bookingPayloadSchema.safeParse(input);
  if (!p.success || !requestIdSchema.safeParse(requestId).success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("booking_confirm", { p_payload: toBookingRpcPayload(p.data) as Json, p_request_id: requestId });
  if (error) return fail(t, error);
  const res = data as unknown as ConfirmResult;
  if (!res.replayed) await notifyNow(me.orgId, res.booking_id);
  revalidateBookings(res.booking_id);
  return { ok: true, data: res, message: res.status === "requested" ? t("bookingWorkflow.messages.requested") : t("bookingWorkflow.messages.confirmed") };
}

// ===========================================================================
// Booking requests (20250420104700): coach / admin decide, guardians request
// ===========================================================================
const DECIDERS: AppRole[] = ["admin", "coach"];

/** The session coach (or an admin) confirms a held request. Idempotent with requestId. */
export async function confirmBookingRequest(bookingId: string, requestId: string): Promise<BkResult<RequestDecisionResult>> {
  const { me, t } = await session(DECIDERS);
  if (!me) return denied(t);
  if (!requestIdSchema.safeParse(bookingId).success || !requestIdSchema.safeParse(requestId).success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("booking_request_confirm", { p_booking: bookingId, p_request_id: requestId });
  if (error) return fail(t, error);
  const res = data as unknown as RequestDecisionResult;
  if (!res.replayed && !res.already_decided) await notifyNow(me.orgId, bookingId);
  revalidateBookings(bookingId);
  return { ok: true, data: res, message: t("bookingWorkflow.messages.requestConfirmed") };
}

/** Decline a request (reason required): cancelled, place released, package restored, never invoiced. */
export async function declineBookingRequest(input: DeclinePayloadInput, requestId: string): Promise<BkResult<RequestDecisionResult>> {
  const { me, t } = await session(DECIDERS);
  if (!me) return denied(t);
  const p = declinePayloadSchema.safeParse(input);
  if (!p.success) return p.error.issues.some((i) => i.path[0] === "reason") ? fail(t, "REASON_REQUIRED") : invalid(t);
  if (!requestIdSchema.safeParse(requestId).success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("booking_request_decline", {
    p_booking: p.data.bookingId, p_reason: p.data.reason, p_request_id: requestId, p_notify: p.data.notify,
  });
  if (error) return fail(t, error);
  const res = data as unknown as RequestDecisionResult;
  if (!res.replayed) await notifyNow(me.orgId, p.data.bookingId);
  revalidateBookings(p.data.bookingId);
  return { ok: true, data: res, message: t("bookingWorkflow.messages.requestDeclined") };
}

/** Family request quote (guardian of the child): slot, coach, price / package coverage, promo. Writes nothing. */
export async function quoteFamilyRequest(input: FamilyRequestInput): Promise<BkResult<FamilyQuote>> {
  const { me, t } = await session(["parent"]);
  if (!me) return denied(t);
  const p = familyRequestSchema.safeParse(input);
  if (!p.success) return invalid(t);
  // "Someone else" participant (Workstream B): the booker's quote, no promo codes.
  if ((await thirdPartyIds(me.id, me.orgId, [p.data.athleteId])).size) {
    const q = await quoteThirdPartyTraining(toFamilyRequestRpcPayload(p.data));
    if (q.error) return fail(t, q.error);
    return { ok: true, data: q.data as unknown as FamilyQuote };
  }
  const db = await createClient();
  const { data, error } = await db.rpc("booking_family_quote", { p_payload: toFamilyRequestRpcPayload(p.data) as Json });
  if (error) return fail(t, error);
  return { ok: true, data: data as unknown as FamilyQuote };
}

/**
 * A guardian requests a session for their own child; the coach (or club) confirms it. Payer = the family.
 * `instalments`: pay in 1..4 payments where the service allows it (default due dates; parents never set dates).
 */
export async function createFamilyRequest(input: FamilyRequestInput, requestId: string, instalments = 1): Promise<BkResult<FamilyRequestResult>> {
  const { me, t } = await session(["parent"]);
  if (!me) return denied(t);
  const p = familyRequestSchema.safeParse(input);
  const n = instalmentChoiceSchema.safeParse({ count: instalments });
  if (!p.success || !n.success || !requestIdSchema.safeParse(requestId).success) return invalid(t);
  // "Someone else" participant (Workstream B): the place is held as a request
  // awaiting the guardian's consent; the booker pays (no instalments).
  if ((await thirdPartyIds(me.id, me.orgId, [p.data.athleteId])).size) {
    const h = await holdThirdPartyTraining(me.orgId, toFamilyRequestRpcPayload(p.data), requestId);
    if (!h.ok) {
      const own = consentErrorCode(h.message);
      if (own) return { ok: false, code: own, error: t.dynamic(`consentRequest.errors.${own}`, undefined, t("consentRequest.errors.generic")) };
      return fail(t, h.message);
    }
    revalidatePath("/parent/bookings/others");
    return { ok: true, data: { ...(h.raw as unknown as FamilyRequestResult), third_party: true }, message: t("consentRequest.held.training") };
  }
  const db = await instalmentsDb();
  const { data, error } = await db.rpc("booking_family_request_plan", {
    p_payload: { ...toFamilyRequestRpcPayload(p.data), instalments: n.data.count } as Json, p_request_id: requestId,
  });
  if (error) return fail(t, error);
  const res = data as unknown as FamilyRequestResult;
  if (!res.replayed) await notifyNow(me.orgId, res.booking_id);
  revalidateBookings(res.booking_id);
  return { ok: true, data: res, message: t("bookingWorkflow.messages.requestSent") };
}

/** A guardian withdraws their family's open request (before the coach decided). */
export async function withdrawBookingRequest(bookingId: string, requestId: string): Promise<BkResult<RequestDecisionResult>> {
  const { me, t } = await session(["parent"]);
  if (!me) return denied(t);
  if (!requestIdSchema.safeParse(bookingId).success || !requestIdSchema.safeParse(requestId).success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("booking_request_withdraw", { p_booking: bookingId, p_request_id: requestId });
  if (error) return fail(t, error);
  const res = data as unknown as RequestDecisionResult;
  if (!res.replayed) await notifyNow(me.orgId, bookingId);
  revalidateBookings(bookingId);
  return { ok: true, data: res, message: t("bookingWorkflow.messages.requestWithdrawn") };
}

export async function rescheduleBooking(input: ReschedulePayloadInput, requestId: string): Promise<BkResult<Record<string, unknown>>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = reschedulePayloadSchema.safeParse(input);
  if (!p.success || !requestIdSchema.safeParse(requestId).success) return invalid(t);
  const v = p.data;
  const payload: Record<string, unknown> = {
    coach_id: v.coachId ?? undefined, session_id: v.sessionId ?? undefined,
    starts_at: v.startsAt ? new Date(v.startsAt).toISOString() : undefined, venue_space_id: v.venueSpaceId ?? undefined,
    price: v.price ?? undefined, price_reason: v.priceReason ?? undefined,
    override_availability: v.overrideAvailability || undefined, override_reason: v.overrideReason ?? undefined, notify: v.notify,
  };
  const db = await createClient();
  const { data, error } = await db.rpc("booking_reschedule", { p_booking: v.bookingId, p_payload: payload as Json, p_request_id: requestId });
  if (error) return fail(t, error);
  const res = data as unknown as Record<string, unknown>;
  if (!res.replayed) await notifyNow(me.orgId, v.bookingId);
  revalidateBookings(v.bookingId);
  return { ok: true, data: res, message: t("bookingWorkflow.messages.rescheduled") };
}

export async function cancelBooking(input: CancelPayloadInput, requestId: string): Promise<BkResult<Record<string, unknown>>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = cancelPayloadSchema.safeParse(input);
  if (!p.success) return p.error.issues.some((i) => i.path[0] === "reason") ? fail(t, "REASON_REQUIRED") : invalid(t);
  if (!requestIdSchema.safeParse(requestId).success) return invalid(t);
  const v = p.data;
  const db = await createClient();
  const { data, error } = await db.rpc("booking_cancel", {
    p_booking: v.bookingId, p_reason: v.reason, p_request_id: requestId, p_refund_mode: v.refundMode,
    p_restore_package: v.restorePackage ?? null, p_notify: v.notify,
  });
  if (error) return fail(t, error);
  const res = data as unknown as Record<string, unknown>;
  if (!res.replayed) await notifyNow(me.orgId, v.bookingId);
  revalidateBookings(v.bookingId);
  return { ok: true, data: res, message: t("bookingWorkflow.messages.cancelled") };
}

// ===========================================================================
// Invoice + payments
// ===========================================================================
/**
 * One invoice per booking. send=true issues it (final number) and e-mails
 * the payer; the delivery is logged in email_logs (invoice_id), so a failed
 * e-mail shows on the booking and in the follow-up list (retryInvoiceEmail).
 * send=false keeps a staff-only draft (issued later from the invoice page).
 */
export async function createBookingInvoice(bookingId: string, requestId: string, send = false): Promise<BkResult<InvoiceResult & { emailOk?: boolean | null }>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  if (!requestIdSchema.safeParse(bookingId).success || !requestIdSchema.safeParse(requestId).success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("booking_create_invoice", { p_booking: bookingId, p_request_id: requestId, p_send: send });
  if (error) return fail(t, error);
  const res = data as unknown as InvoiceResult;
  if (!res.ok) return { ok: true, data: res, message: t("bookingWorkflow.errors.SETUP_MISSING") };
  let emailOk: boolean | null = null;
  if (send && !res.replayed && !res.already_invoiced) emailOk = await emailInvoice(me.orgId, res.invoice_id);
  revalidateBookings(bookingId);
  const message = !send ? t("bookingWorkflow.messages.invoiced")
    : emailOk === false ? t("bookingWorkflow.messages.invoiceEmailFailed") : t("bookingWorkflow.messages.invoiceSent");
  return { ok: true, data: { ...res, emailOk }, message };
}

/** E-mail an issued booking invoice to its payer (payer e-mail, else the family contact). */
async function emailInvoice(orgId: string, invoiceId: string): Promise<boolean | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("invoices")
      .select("id,org_id,number,total_chf,adjustments_total,due_date,family_id,payer_email,payer_name,payer_profile_id,status")
      .eq("id", invoiceId)
      .eq("org_id", orgId)
      .maybeSingle();
    const inv = data as {
      id: string; number: string; total_chf: number; adjustments_total: number; due_date: string | null; family_id: string;
      payer_email: string | null; payer_name: string | null; payer_profile_id: string | null; status: string;
    } | null;
    if (!inv || inv.status === "draft") return null;
    let to = inv.payer_email;
    if (!to) {
      const { data: fam } = await admin.from("families").select("contact_email").eq("id", inv.family_id).eq("org_id", orgId).maybeSingle();
      to = (fam as { contact_email: string | null } | null)?.contact_email ?? null;
    }
    if (!to && !inv.payer_profile_id) return false;
    const res = await dispatchNotification({
      orgId, type: "invoice_sent", recipientProfileId: inv.payer_profile_id, toEmail: to, invoiceId: inv.id,
      vars: {
        ...(inv.payer_name ? { parent_name: inv.payer_name } : {}),
        invoice_number: inv.number, amount_due: Number(inv.total_chf) + Number(inv.adjustments_total ?? 0),
        ...(inv.due_date ? { due_date: inv.due_date } : {}),
        ...(inv.payer_profile_id ? { payment_link: `/parent/invoices/${inv.id}` } : {}),
      },
    });
    return res.emailLogId ? res.emailOk : Boolean(res.notificationId);
  } catch (e) {
    logError("bookingWorkflow.invoiceEmail", e);
    return false;
  }
}

/** Re-send a failed invoice e-mail (email_logs row of a booking invoice). */
export async function retryInvoiceEmail(emailLogId: string): Promise<BkResult> {
  const { me, t } = await session();
  if (!me) return denied(t);
  if (!requestIdSchema.safeParse(emailLogId).success) return invalid(t);
  const db = await createClient();
  // RLS-scoped lookup: the log must belong to the caller's org and a booking invoice.
  const { data: log } = await db.from("email_logs").select("id,invoice_id,org_id").eq("id", emailLogId).eq("org_id", me.orgId).maybeSingle();
  if (!log) return fail(t, "NOTIFICATION_NOT_FOUND");
  const res = await retryEmailLog(emailLogId);
  revalidateBookings();
  return res.ok ? { ok: true } : fail(t, res.error ?? null);
}

const paymentSchema = z.object({
  amount: z.coerce.number().finite().positive().max(1_000_000),
  method: z.enum(["bank_transfer", "twint", "manual", "qr_bill", "card"]).default("bank_transfer"),
  receivedOn: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().default(""),
  reference: z.string().trim().max(200).optional().default(""),
  note: z.string().trim().max(1000).optional().default(""),
});

/** Offline payment against the booking's invoice (receipt_record, idempotent with requestId). */
export async function recordBookingPayment(bookingId: string, input: z.input<typeof paymentSchema>, requestId: string): Promise<BkResult<Record<string, unknown>>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = paymentSchema.safeParse(input);
  if (!p.success) return p.error.issues.some((i) => i.path[0] === "amount") ? fail(t, "INVALID_AMOUNT") : invalid(t);
  if (!requestIdSchema.safeParse(bookingId).success || !requestIdSchema.safeParse(requestId).success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("booking_record_payment", {
    p_booking: bookingId,
    p_payload: {
      request_id: requestId, amount: p.data.amount, method: p.data.method, received_on: p.data.receivedOn || null,
      reference: p.data.reference || null, note: p.data.note || null,
    } as Json,
  });
  if (error) return fail(t, error);
  revalidateBookings(bookingId);
  return { ok: true, data: data as unknown as Record<string, unknown>, message: t("bookingWorkflow.messages.paymentRecorded") };
}

// ===========================================================================
// People
// ===========================================================================
const dupSchema = z.object({
  firstName: z.string().trim().max(80).optional(), lastName: z.string().trim().max(80).optional(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")), email: z.string().trim().max(254).optional(),
  payerName: z.string().trim().max(140).optional(),
});

/** Likely duplicate athletes (name incl. accents / case, dob) and payers / families / guardians (e-mail, name). */
export async function checkDuplicates(input: z.input<typeof dupSchema>): Promise<BkResult<DuplicateCheck>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = dupSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("people_duplicate_check", {
    p_payload: { first_name: p.data.firstName, last_name: p.data.lastName, dob: p.data.dob || null, email: p.data.email, payer_name: p.data.payerName } as Json,
  });
  if (error) return fail(t, error);
  return { ok: true, data: data as unknown as DuplicateCheck };
}

/** Athlete from the booking form; never enrols. A suspected duplicate comes back as data.ok === false. */
export async function quickCreateAthlete(input: QuickCreateInput, requestId: string): Promise<BkResult<QuickCreateResult>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = quickCreateSchema.safeParse(input);
  if (!p.success || !requestIdSchema.safeParse(requestId).success) {
    const path = p.success ? "" : String(p.error.issues[0]?.path[0] ?? "");
    if (path === "dob") return fail(t, "DOB_REQUIRED");
    if (path === "firstName" || path === "lastName") return fail(t, "NAME_REQUIRED");
    return invalid(t);
  }
  const db = await createClient();
  const { data, error } = await db.rpc("athlete_quick_create", { p_payload: toQuickCreateRpcPayload(p.data) as Json, p_request_id: requestId });
  if (error) return fail(t, error);
  const res = data as unknown as QuickCreateResult;
  if (res.ok) revalidatePath("/admin/athletes", "layout");
  return { ok: true, data: res, message: res.ok ? t("bookingWorkflow.messages.athleteCreated") : t("bookingWorkflow.errors.DUPLICATE_SUSPECTED") };
}

export async function savePayer(input: PayerInput, requestId?: string): Promise<BkResult<{ payer_id: string }>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = payerSchema.safeParse(input);
  if (!p.success) {
    const path = String(p.error.issues[0]?.path[0] ?? "");
    if (path === "name") return fail(t, "PAYER_NAME_REQUIRED");
    if (path === "email") return fail(t, "INVALID_EMAIL");
    if (path === "country") return fail(t, "INVALID_COUNTRY");
    return invalid(t);
  }
  if (requestId && !requestIdSchema.safeParse(requestId).success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("billing_payer_save", { p_payload: toPayerRpcPayload(p.data) as Json, p_request_id: requestId ?? null });
  if (error) return fail(t, error);
  revalidateBookings();
  return { ok: true, data: data as unknown as { payer_id: string }, message: t("bookingWorkflow.messages.payerSaved") };
}

// ===========================================================================
// Follow-up, catalogue
// ===========================================================================
/** Queue a failed / no-contact notification again and try to deliver it now. */
export async function retryBookingNotification(notificationId: string): Promise<BkResult<Record<string, unknown>>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  if (!requestIdSchema.safeParse(notificationId).success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("booking_notification_retry", { p_id: notificationId });
  if (error) return fail(t, error);
  const res = data as unknown as { booking_id: string };
  await notifyNow(me.orgId, res.booking_id);
  revalidateBookings(res.booking_id);
  return { ok: true, data: res as unknown as Record<string, unknown>, message: t("bookingWorkflow.messages.notificationRequeued") };
}

/** Eligible coaches of a service (admin, full replace). */
export async function setServiceCoaches(serviceId: string, coachIds: string[]): Promise<BkResult> {
  const { me, t } = await session(["admin"]);
  if (!me) return denied(t);
  const p = z.object({ serviceId: z.string().uuid(), coachIds: z.array(z.string().uuid()).max(200) }).safeParse({ serviceId, coachIds });
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { error } = await db.rpc("training_service_coaches_set", { p_service: p.data.serviceId, p_coaches: p.data.coachIds });
  if (error) return fail(t, error);
  revalidatePath("/admin/services", "layout");
  return { ok: true, message: t("bookingWorkflow.messages.coachesSaved") };
}
