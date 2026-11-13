import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

/**
 * Typed view of the training-system tables and RPCs
 * (migration 20250420100200_training_system.sql). Kept local like
 * src/lib/sportsops/db.ts; merges into src/types/database.ts once the types
 * are regenerated with `npm run types`.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type SessionType = "individual" | "group";
export type PurchaseStatus = "pending" | "active" | "cancelled";
export type PaymentMode = "invoice" | "paid" | "comp";

export type TrainingServiceRow = {
  id: string; org_id: string; slug: string; name: string; tagline: string | null; description: string | null;
  duration_min: number; price_chf: number; credits_required: number; credit_category: "personal" | "nutrition" | "mental";
  is_active: boolean; session_type: SessionType; max_participants: number; min_participants: number;
  venue_id: string | null; location_text: string | null; currency: string | null; color: string | null; sort_order: number;
};
export type PackageDbRow = {
  id: string; org_id: string; name: string; credit_category: "personal" | "nutrition" | "mental"; credits: number; price_chf: number;
  is_active: boolean; service_id: string | null; validity_days: number | null; sort_order: number; description: string | null;
  created_at: string; updated_at: string;
};
export type PurchaseRow = {
  id: string; org_id: string; athlete_id: string; family_id: string | null; service_id: string; package_id: string | null;
  sessions: number; sessions_used: number; list_price: number; discount_total: number; discount_ids: string[]; amount: number;
  currency: string; payment_mode: PaymentMode; status: PurchaseStatus; invoice_id: string | null; validity_days: number | null;
  granted_at: string | null; expires_at: string | null; cancelled_at: string | null; cancel_reason: string | null;
  notes: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type TemplateRow = {
  id: string; org_id: string; coach_id: string; venue_id: string | null; service_id: string | null; weekday: number;
  start_time: string; end_time: string; capacity: number; valid_from: string | null; valid_until: string | null;
  is_active: boolean; notes: string | null; created_at: string; updated_at: string;
};
export type WindowRow = {
  id: string; org_id: string; coach_id: string; starts_at: string; ends_at: string; is_booked: boolean;
  venue_id: string | null; service_id: string | null; capacity: number;
};
export type BlackoutRow = {
  id: string; org_id: string; coach_id: string | null; venue_id: string | null; starts_at: string; ends_at: string;
  reason: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type ProfileRow = {
  id: string; org_id: string; athlete_id: string; goals: string | null; notes: string | null; level: string | null;
  focus_areas: string[]; updated_by: string | null; created_at: string; updated_at: string;
};
export type BookingDbRow = {
  id: string; org_id: string; athlete_id: string; service_id: string; coach_id: string; slot_start: string; slot_end: string | null;
  status: "booked" | "completed" | "no_show" | "cancelled"; paid_with: string | null; invoice_id: string | null; credits_used: number;
  price_chf: number | null; notes: string | null; created_by: string | null; cancel_reason: string | null; cancelled_at: string | null;
  cancelled_by: string | null; purchase_id: string | null; venue_id: string | null; location_text: string | null;
  group_confirmed_at: string | null; created_at: string;
};
export type VenueDbRow = {
  id: string; org_id: string; name: string; address: string | null; city: string | null; postal_code: string | null; country: string | null;
  capacity: number | null; notes: string | null; is_active: boolean; opening_hours: Json | null;
};

type TrainingTables = {
  training_services: T<TrainingServiceRow>;
  credit_packages: T<PackageDbRow>;
  training_package_purchases: T<PurchaseRow>;
  coach_availability_templates: T<TemplateRow>;
  coach_availability: T<WindowRow>;
  training_blackouts: T<BlackoutRow>;
  athlete_training_profiles: T<ProfileRow>;
  training_bookings: T<BookingDbRow>;
  venues: T<VenueDbRow>;
};

type TrainingFunctions = {
  training_busy: {
    Args: { p_from: string; p_to: string };
    Returns: { coach_id: string; service_id: string; slot_start: string; slot_end: string; booked: number }[];
  };
  training_balances: {
    Args: { p_athlete: string };
    Returns: { service_id: string; remaining: number; pending: number; next_expiry: string | null }[];
  };
  purchase_training_package: {
    Args: {
      p_athlete: string; p_service: string; p_package?: string | null; p_mode?: string; p_note?: string | null;
      p_promo_code?: string | null; p_manual_discounts?: string[] | null;
    };
    Returns: Json;
  };
  cancel_training_purchase: { Args: { p_purchase: string; p_reason: string }; Returns: Json };
  book_training: {
    Args: {
      p_athlete: string; p_service: string; p_coach: string; p_start: string; p_pay_with?: string; p_purchase?: string | null;
      p_package?: string | null; p_mode?: string; p_override?: boolean; p_notes?: string | null;
      p_promo_code?: string | null; p_manual_discounts?: string[] | null;
    };
    Returns: Json;
  };
  reschedule_training: { Args: { p_booking: string; p_coach: string; p_start: string }; Returns: Json };
  mark_training_booking: { Args: { p_booking: string; p_status: string }; Returns: Json };
  confirm_training_group: { Args: { p_coach: string; p_service: string; p_start: string }; Returns: Json };
  cancel_training_group: { Args: { p_coach: string; p_service: string; p_start: string; p_reason: string }; Returns: Json };
  training_public_catalog: { Args: { p_slug: string; p_from: string | null; p_to: string | null }; Returns: Json };
  training_guest_checkout: { Args: { p_slug: string; p_user: string; p_payload: Json }; Returns: Json };
  training_guest_checkout_promo: { Args: { p_slug: string; p_user: string; p_payload: Json }; Returns: Json };
};

type Pub = Database["public"];
export type TrainingDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Omit<Pub["Tables"], keyof TrainingTables> & TrainingTables;
    Functions: Pub["Functions"] & TrainingFunctions;
  };
};
export type TrainingClient = SupabaseClient<TrainingDatabase>;

/** RLS-scoped client (user session) with the training tables typed. */
export async function trainingDb(): Promise<TrainingClient> {
  return (await createClient()) as unknown as TrainingClient;
}

/** Service-role client (server only; callers filter by org explicitly). */
export function trainingAdminDb(): TrainingClient {
  return createAdminClient() as unknown as TrainingClient;
}
