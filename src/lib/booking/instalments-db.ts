import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";
import type { ServiceInstalmentInfo } from "./instalments";

/**
 * Typed view of the service instalment functions (migration
 * 20250420105400_service_instalments.sql). Kept local, like
 * src/lib/programs/db.ts, so the shared generated types do not need a hand
 * edit; `npm run types` merges them later. Every function checks the caller's
 * role and club again (SECURITY DEFINER, current_org_id()).
 */
type InstalmentFunctions = {
  booking_order_confirm_plan: { Args: { p_payload: Json; p_request_id: string }; Returns: Json };
  booking_family_request_plan: { Args: { p_payload: Json; p_request_id: string }; Returns: Json };
  service_instalment_info: { Args: { p_services: string[] }; Returns: Json };
  booking_instalment_choice: { Args: { p_booking: string }; Returns: Json };
  service_instalments_save: { Args: { p_service: string; p_max: number }; Returns: Json };
};

type Pub = Database["public"];
export type InstalmentsDatabase = {
  public: Omit<Pub, "Functions"> & { Functions: Pub["Functions"] & InstalmentFunctions };
};
export type InstalmentsClient = SupabaseClient<InstalmentsDatabase>;

/** RLS-scoped client (the signed-in user's session). */
export async function instalmentsDb(): Promise<InstalmentsClient> {
  return (await createClient()) as unknown as InstalmentsClient;
}

/** Payments allowed per service of the caller's club, the booking invoice term and the club's today. */
export async function getServiceInstalmentInfo(serviceIds: string[]): Promise<ServiceInstalmentInfo | null> {
  if (!serviceIds.length) return null;
  const db = await instalmentsDb();
  const { data, error } = await db.rpc("service_instalment_info", { p_services: serviceIds });
  if (error || !data) return null;
  return data as unknown as ServiceInstalmentInfo;
}

export type BookingInstalmentChoice = {
  booking_id: string; order_id: string | null; instalments: number; instalment_dates: string[] | null; invoice_id: string | null;
};

/** The instalment choice of one booking (staff, or a guardian of the athlete); null when not visible. */
export async function getBookingInstalmentChoice(bookingId: string): Promise<BookingInstalmentChoice | null> {
  const db = await instalmentsDb();
  const { data, error } = await db.rpc("booking_instalment_choice", { p_booking: bookingId });
  if (error || !data) return null;
  return data as unknown as BookingInstalmentChoice;
}
