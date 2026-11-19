import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

/**
 * Typed view of the tables and RPCs of migration
 * 20250420100900_shop_search_sports_rollcall.sql (shop, sports, venues
 * additions, member cards, global search). Kept local like
 * src/lib/training/db.ts; merges into src/types/database.ts once the types
 * are regenerated with `npm run types`.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type ProductRow = {
  id: string; org_id: string; name: string; description: string | null; category: string | null; price: number; currency: string;
  images: string[]; visibility: "public" | "members"; is_active: boolean; pickup_available: boolean; pickup_venue_id: string | null;
  shipping_available: boolean; shipping_fee: number; low_stock_threshold: number; sort_order: number; created_by: string | null;
  created_at: string; updated_at: string;
};
export type VariantRow = {
  id: string; org_id: string; product_id: string; sku: string | null; size: string | null; color: string | null; price: number | null;
  stock: number; is_active: boolean; sort_order: number; created_at: string; updated_at: string;
};
export type OrderRow = {
  id: string; org_id: string; number: string; status: string; family_id: string | null; profile_id: string | null; is_guest: boolean;
  buyer_name: string; buyer_email: string; buyer_phone: string | null; fulfillment: "pickup" | "shipping"; pickup_venue_id: string | null;
  shipping_address: string | null; currency: string; subtotal: number; discount_total: number; shipping_total: number; total: number;
  promo_code: string | null; invoice_id: string | null; access_token_hash: string | null; notes: string | null; paid_at: string | null;
  ready_at: string | null; fulfilled_at: string | null; cancelled_at: string | null; cancel_reason: string | null; refunded_at: string | null;
  stock_released_at: string | null; created_at: string; updated_at: string;
};
export type OrderItemRow = {
  id: string; org_id: string; order_id: string; product_id: string | null; variant_id: string | null; name: string; variant_label: string | null;
  sku: string | null; unit_price: number; quantity: number; line_total: number; created_at: string;
};
export type MovementRow = {
  id: string; org_id: string; variant_id: string; product_id: string; kind: "sale" | "release" | "restock" | "adjustment"; quantity: number;
  stock_after: number; reason: string | null; order_id: string | null; created_by: string | null; created_at: string;
};
export type SportRow = {
  id: string; org_id: string; name: string; icon: string | null; terminology: Json; is_active: boolean; sort_order: number;
  created_at: string; updated_at: string;
};
export type LocationRow = {
  id: string; org_id: string; name: string; address: string | null; city: string | null; postal_code: string | null; country: string | null;
  capacity: number | null; notes: string | null; is_active: boolean; opening_hours: Json | null; latitude: number | null; longitude: number | null;
  geofence_radius_m: number; map_url: string | null; photo_path: string | null; created_at: string; updated_at: string;
};
export type MemberCardRow = {
  id: string; org_id: string; athlete_id: string; version: number; nfc_tag_id: string | null; is_active: boolean; issued_at: string;
  rotated_at: string | null;
};
export type SearchRow = { kind: string; id: string; title: string; subtitle: string | null; score: number };

type ShopTables = {
  shop_products: T<ProductRow>;
  shop_product_variants: T<VariantRow>;
  shop_orders: T<OrderRow>;
  shop_order_items: T<OrderItemRow>;
  shop_stock_movements: T<MovementRow>;
  sports: T<SportRow>;
  venues: T<LocationRow>;
  member_cards: T<MemberCardRow>;
};

type ShopFunctions = {
  shop_place_order: { Args: { p_payload: Json }; Returns: Json };
  shop_set_order_status: { Args: { p_order: string; p_status: string; p_reason?: string | null }; Returns: Json };
  shop_adjust_stock: { Args: { p_variant: string; p_delta: number; p_kind: string; p_reason?: string | null }; Returns: Json };
  global_search: { Args: { p_q: string; p_kinds?: string[] | null; p_limit?: number }; Returns: SearchRow[] };
  member_card_token: { Args: { p_athlete: string }; Returns: string };
  rotate_member_card: { Args: { p_athlete: string }; Returns: string };
  assign_member_tag: { Args: { p_athlete: string; p_tag: string | null }; Returns: Json };
  resolve_member_token: { Args: { p_token: string }; Returns: { athlete_id: string; first_name: string; last_name: string }[] };
  training_guest_checkout_promo: { Args: { p_slug: string; p_user: string; p_payload: Json }; Returns: Json };
};

type Pub = Database["public"];
export type ShopDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Omit<Pub["Tables"], keyof ShopTables> & ShopTables;
    Functions: Pub["Functions"] & ShopFunctions;
  };
};
export type ShopClient = SupabaseClient<ShopDatabase>;

/** RLS-scoped client (user session). */
export async function shopDb(): Promise<ShopClient> {
  return (await createClient()) as unknown as ShopClient;
}

/** Service-role client (server only; callers filter by org explicitly). */
export function shopAdminDb(): ShopClient {
  return createAdminClient() as unknown as ShopClient;
}

/** Public bucket for product + venue photos (no personal data). */
export const CLUB_MEDIA_BUCKET = "club-media";

/** Public URL of a club-media object. */
export function clubMediaUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${CLUB_MEDIA_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
