import "server-only";
import { createClient } from "@/lib/supabase/server";
import { bookingErrorCode } from "./types";
import type { OrderDetail, OrderToInvoice } from "./orders";
import type { Read } from "./data";

/*
 * Booking orders — server-side reads (as the signed-in user; the RPCs re-check
 * tenant and staff role). Contract: docs/booking-workflow.md §13.
 */
async function call<T>(fn: "booking_order_detail" | "booking_orders_to_invoice", args: Record<string, unknown>): Promise<Read<T>> {
  const db = await createClient();
  const { data, error } = await db.rpc(fn, args as never);
  if (error) return { data: null, error: bookingErrorCode(error.message) ?? "UNKNOWN" };
  return { data: data as unknown as T, error: null };
}

/** One order: participants, dates (shared sessions), package usage, invoices per payer, totals. */
export const getBookingOrder = (orderId: string) => call<OrderDetail>("booking_order_detail", { p_order: orderId });

/** Orders with confirmed charges not yet invoiced (finance "To Invoice"). */
export const getOrdersToInvoice = (limit = 100) => call<OrderToInvoice[]>("booking_orders_to_invoice", { p_limit: limit });
