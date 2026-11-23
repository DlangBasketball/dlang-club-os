"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import type { AppRole } from "@/lib/auth/roles";
import { getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { logError } from "@/lib/log";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import { runBookingNotifications } from "@/lib/booking/notify";
import { bookingErrorCode } from "@/lib/booking/types";
import {
  addDatesSchema, orderCancelSchema, orderPayloadSchema, orderRescheduleSchema, pricingSaveSchema, toOrderRpcPayload,
  type AddDatesInput, type OrderCancelInput, type OrderConfirmResult, type OrderInvoiceResult, type OrderPayloadInput, type OrderQuote,
  type OrderRescheduleInput, type PricingSaveInput,
} from "@/lib/booking/orders";

/*
 * Booking orders — server actions (migration 20250420104800). The org is the
 * caller's session org; every RPC re-checks tenant and staff role in SQL.
 * Writes take a client request id (one per user intent, reused on retry), so
 * a double click or a retry replays instead of booking / invoicing twice.
 * Result: { ok: true, data?, message? } | { ok: false, error, code?, date? }
 * (error = bookingWorkflow.errors.<CODE> translated; `date` = the date a
 * placement refusal names). Contract: docs/booking-workflow.md §13.
 */
export type OrderActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; code?: string; date?: string | null; athleteId?: string | null };

type Me = SessionUser & { orgId: string };
const STAFF: AppRole[] = ["admin", "finance"];
const uuid = z.string().uuid();

async function session(): Promise<{ me: Me | null; t: Translator }> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId || !STAFF.some((r) => me.roles.includes(r))) return { me: null, t };
  return { me: me as Me, t };
}

type DbError = { message?: string; details?: string | null } | null | undefined;

function fail(t: Translator, error: DbError | string): { ok: false; error: string; code?: string; date?: string | null; athleteId?: string | null } {
  const msg = typeof error === "string" ? error : error?.message ?? "";
  const code = bookingErrorCode(msg);
  let date: string | null = null;
  let athleteId: string | null = null;
  if (typeof error !== "string" && error?.details) {
    try {
      const d = JSON.parse(error.details) as { starts_at?: string; athlete_id?: string };
      date = d.starts_at ?? null;
      athleteId = d.athlete_id ?? null;
    } catch { /* not a placement detail */ }
  }
  if (code) return { ok: false, code, date, athleteId, error: t.dynamic(`bookingWorkflow.errors.${code}`, undefined, t("bookingWorkflow.errors.generic")) };
  if (msg) logError("bookingOrders", msg);
  return { ok: false, error: t("bookingWorkflow.errors.generic") };
}
const denied = (t: Translator) => ({ ok: false as const, code: "NOT_AUTHORIZED", error: t("bookingWorkflow.errors.NOT_AUTHORIZED") });
const invalid = (t: Translator) => ({ ok: false as const, code: "INVALID_INPUT", error: t("bookingWorkflow.errors.invalid") });

function revalidateOrders(orderId?: string) {
  revalidatePath("/admin/bookings", "layout");
  revalidatePath("/admin/finance/to-invoice");
  revalidatePath("/admin/invoices", "layout");
  revalidatePath("/admin/schedule", "layout");
  revalidatePath("/coach", "layout");
  revalidatePath("/parent", "layout");
  revalidatePath("/player", "layout");
  if (orderId) revalidatePath(`/admin/bookings/orders/${orderId}`);
}

async function notifyOrder(orgId: string, bookingIds: string[]) {
  for (const id of bookingIds.slice(0, 120)) {
    try { await runBookingNotifications({ orgId, bookingId: id, limit: 20 }); } catch (e) { logError("bookingOrders.notify", e); }
  }
}

// ===========================================================================
// Quote / confirm / schedule more dates
// ===========================================================================
/** Pricing, per-player charges, every date checked. Writes nothing. */
export async function quoteOrder(input: OrderPayloadInput): Promise<OrderActionResult<OrderQuote>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = orderPayloadSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("booking_order_quote", { p_payload: toOrderRpcPayload(p.data) as Json });
  if (error) return fail(t, error);
  return { ok: true, data: data as unknown as OrderQuote };
}

/** Create the order (all dates, all players) in one transaction. Idempotent with requestId. */
export async function confirmOrder(input: OrderPayloadInput, requestId: string): Promise<OrderActionResult<OrderConfirmResult>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = orderPayloadSchema.safeParse(input);
  if (!p.success || !uuid.safeParse(requestId).success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("booking_order_confirm", { p_payload: toOrderRpcPayload(p.data) as Json, p_request_id: requestId });
  if (error) return fail(t, error);
  const res = data as unknown as OrderConfirmResult;
  if (!res.ok) return { ok: true, data: res, message: t("bookingWorkflow.errors.DATES_UNAVAILABLE") };
  if (!res.replayed && p.data.notify) await notifyOrder(me.orgId, (res.bookings ?? []).map((b) => b.booking_id));
  revalidateOrders(res.order_id);
  return { ok: true, data: res, message: t("bookingOrders.messages.created") };
}

/** Schedule more dates (package sessions or group dates); dryRun checks them only. */
export async function addOrderDates(input: AddDatesInput, requestId: string | null): Promise<OrderActionResult<Record<string, unknown>>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = addDatesSchema.safeParse(input);
  if (!p.success) return invalid(t);
  if (!p.data.dryRun && !uuid.safeParse(requestId).success) return invalid(t);
  const v = p.data;
  const payload: Record<string, unknown> = {
    dates: v.dates.map((d) => new Date(d).toISOString()), participant_ids: v.participantIds ?? undefined,
    coach_id: v.coachId ?? undefined, venue_space_id: v.venueSpaceId ?? undefined,
    override_availability: v.overrideAvailability || undefined, override_reason: v.overrideReason ?? undefined,
    notify: v.notify, dry_run: v.dryRun || undefined,
  };
  const db = await createClient();
  const { data, error } = await db.rpc("booking_order_add_dates", { p_order: v.orderId, p_payload: payload as Json, p_request_id: v.dryRun ? null : requestId });
  if (error) return fail(t, error);
  const res = data as unknown as Record<string, unknown>;
  if (v.dryRun) return { ok: true, data: res };
  if (res.ok === false) return { ok: true, data: res, message: t("bookingWorkflow.errors.DATES_UNAVAILABLE") };
  if (!res.replayed && v.notify) await notifyOrder(me.orgId, ((res.bookings ?? []) as { booking_id: string }[]).map((b) => b.booking_id));
  revalidateOrders(v.orderId);
  return { ok: true, data: res, message: t("bookingOrders.messages.scheduled") };
}

// ===========================================================================
// Invoices per payer, payments
// ===========================================================================
export async function createOrderInvoices(orderIds: string[], requestId: string, send = true): Promise<OrderActionResult<OrderInvoiceResult>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  if (!z.array(uuid).min(1).max(50).safeParse(orderIds).success || !uuid.safeParse(requestId).success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("booking_order_create_invoices", { p_orders: orderIds, p_request_id: requestId, p_send: send });
  if (error) return fail(t, error);
  const res = data as unknown as OrderInvoiceResult;
  if (!res.ok) return { ok: true, data: res, message: t("bookingWorkflow.errors.SETUP_MISSING") };
  for (const id of orderIds) revalidateOrders(id);
  return {
    ok: true, data: res,
    message: res.nothing_to_invoice ? t("bookingOrders.messages.nothingToInvoice") : t("bookingOrders.messages.invoiced", { count: res.invoices.length }),
  };
}

const paymentSchema = z.object({
  amount: z.coerce.number().finite().positive().max(1_000_000),
  method: z.enum(["bank_transfer", "twint", "manual", "qr_bill", "card"]).default("bank_transfer"),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")).transform((v) => v || null),
  reference: z.string().trim().max(140).nullish().transform((v) => v || null),
  note: z.string().trim().max(500).nullish().transform((v) => v || null),
});

/** Offline payment against one invoice of the order (receipt + allocation; idempotent). */
export async function recordOrderPayment(orderId: string, invoiceId: string, input: z.input<typeof paymentSchema>, requestId: string): Promise<OrderActionResult<Record<string, unknown>>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = paymentSchema.safeParse(input);
  if (!p.success || !uuid.safeParse(orderId).success || !uuid.safeParse(invoiceId).success || !uuid.safeParse(requestId).success) return invalid(t);
  const db = await createClient();
  const { data, error } = await db.rpc("booking_order_record_payment", {
    p_order: orderId, p_invoice: invoiceId,
    p_payload: { request_id: requestId, amount: p.data.amount, method: p.data.method, received_on: p.data.receivedOn,
                 reference: p.data.reference, note: p.data.note } as Json,
  });
  if (error) return fail(t, error);
  revalidateOrders(orderId);
  return { ok: true, data: data as unknown as Record<string, unknown>, message: t("bookingWorkflow.messages.paymentRecorded") };
}

// ===========================================================================
// Partial changes
// ===========================================================================
export async function cancelOrderPart(input: OrderCancelInput, requestId: string): Promise<OrderActionResult<Record<string, unknown>>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = orderCancelSchema.safeParse(input);
  if (!p.success) return p.error.issues.some((i) => i.path[0] === "reason") ? fail(t, "REASON_REQUIRED") : invalid(t);
  if (!uuid.safeParse(requestId).success) return invalid(t);
  const v = p.data;
  const db = await createClient();
  const { data, error } = await db.rpc("booking_order_cancel", {
    p_order: v.orderId, p_request_id: requestId,
    p_payload: { scope: v.scope, booking_id: v.bookingId, participant_id: v.participantId, session_id: v.sessionId, reason: v.reason,
                 refund_mode: v.refundMode, ...(v.restorePackage === null || v.restorePackage === undefined ? {} : { restore_package: v.restorePackage }),
                 notify: v.notify } as Json,
  });
  if (error) return fail(t, error);
  const res = data as unknown as { replayed?: boolean; cancelled?: { booking_id: string }[] };
  if (!res.replayed && v.notify) await notifyOrder(me.orgId, (res.cancelled ?? []).map((c) => c.booking_id));
  revalidateOrders(v.orderId);
  return { ok: true, data: res as Record<string, unknown>, message: t("bookingOrders.messages.cancelled") };
}

export async function rescheduleOrderPart(input: OrderRescheduleInput, requestId: string): Promise<OrderActionResult<Record<string, unknown>>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = orderRescheduleSchema.safeParse(input);
  if (!p.success || !uuid.safeParse(requestId).success) return invalid(t);
  const v = p.data;
  const db = await createClient();
  const { data, error } = await db.rpc("booking_order_reschedule", {
    p_order: v.orderId, p_request_id: requestId,
    p_payload: {
      scope: v.scope, booking_id: v.bookingId ?? undefined, session_id: v.sessionId ?? undefined,
      starts_at: new Date(v.startsAt).toISOString(), coach_id: v.coachId ?? undefined, venue_space_id: v.venueSpaceId ?? undefined,
      price: v.price ?? undefined, price_reason: v.priceReason ?? undefined,
      override_availability: v.overrideAvailability || undefined, override_reason: v.overrideReason ?? undefined, notify: v.notify,
    } as Json,
  });
  if (error) return fail(t, error);
  const res = data as unknown as { replayed?: boolean; rescheduled?: { booking_id: string }[] };
  if (!res.replayed && v.notify) await notifyOrder(me.orgId, (res.rescheduled ?? []).map((c) => c.booking_id));
  revalidateOrders(v.orderId);
  return { ok: true, data: res as Record<string, unknown>, message: t("bookingWorkflow.messages.rescheduled") };
}

// ===========================================================================
// Service pricing (Services -> service page, admin + finance)
// ===========================================================================
export async function saveServicePricing(input: PricingSaveInput): Promise<OrderActionResult<Record<string, unknown>>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  const p = pricingSaveSchema.safeParse(input);
  if (!p.success) return invalid(t);
  const v = p.data;
  const payload: Record<string, unknown> = {
    pricing_basis: v.pricingBasis,
    short_description: v.shortDescription ?? "",
    ...(v.price !== null && v.price !== undefined ? { price: v.price } : {}),
    group_rate: v.groupRate ?? null,
    ...(v.packages ? {
      packages: v.packages.map((x) => ({ id: x.id ?? null, name: x.name ?? null, sessions: x.sessions, total: x.total,
                                         validity_days: x.validityDays ?? null, is_active: x.isActive })),
    } : {}),
  };
  const db = await createClient();
  const { data, error } = await db.rpc("service_pricing_save", { p_service: v.serviceId, p_payload: payload as Json });
  if (error) return fail(t, error);
  revalidatePath("/admin/services", "layout");
  revalidatePath("/admin/bookings", "layout");
  revalidatePath("/admin/training");
  return { ok: true, data: data as unknown as Record<string, unknown>, message: t("bookingOrders.pricing.saved") };
}

// ===========================================================================
// Picker: packages the athlete already holds for the service ("use this package")
// ===========================================================================
export type AthletePackage = { purchaseId: string; sessions: number; used: number; remaining: number; expiresAt: string | null; orderId: string | null };

export async function getAthletePackages(athleteId: string, serviceId: string): Promise<OrderActionResult<AthletePackage[]>> {
  const { me, t } = await session();
  if (!me) return denied(t);
  if (!uuid.safeParse(athleteId).success || !uuid.safeParse(serviceId).success) return invalid(t);
  // Untyped client: these tables are not in the generated types. RLS (finance) still applies.
  const db = (await createClient()) as unknown as SupabaseClient;
  const { data, error } = await db.from("training_package_purchases")
    .select("id,sessions,sessions_used,expires_at,status")
    .eq("org_id", me.orgId).eq("athlete_id", athleteId).eq("service_id", serviceId).eq("status", "active")
    .order("created_at", { ascending: true }).limit(20);
  if (error) return fail(t, error);
  const now = Date.now();
  const rows = ((data ?? []) as { id: string; sessions: number; sessions_used: number; expires_at: string | null }[])
    .filter((r) => r.sessions_used < r.sessions && (!r.expires_at || new Date(r.expires_at).getTime() > now));
  const orders = new Map<string, string>();
  if (rows.length) {
    const { data: os } = await db.from("booking_orders").select("id,purchase_id").eq("org_id", me.orgId)
      .in("purchase_id", rows.map((r) => r.id));
    for (const o of (os ?? []) as { id: string; purchase_id: string }[]) orders.set(o.purchase_id, o.id);
  }
  return {
    ok: true,
    data: rows.map((r) => ({ purchaseId: r.id, sessions: r.sessions, used: r.sessions_used, remaining: r.sessions - r.sessions_used,
                             expiresAt: r.expires_at, orderId: orders.get(r.id) ?? null })),
  };
}
