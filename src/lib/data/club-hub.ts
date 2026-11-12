import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Public club hub reads (no session). Service-role client, so every query is
 * pinned to the org resolved server-side from the request host and returns
 * only public, published, open-for-registration programme fields. No personal
 * data (no coaches, rosters, athletes or families).
 */

export type HubCamp = {
  slug: string;
  name: string;
  description: string | null;
  price: number;
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
};

export const HUB_CAMP_LIMIT = 24;

type Row = {
  slug: string | null;
  name: string;
  description: string | null;
  price_chf: number | string | null;
  location: string | null;
  starts_on: string | null;
  ends_on: string | null;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
};

/** Pure filter: open registration window and not yet finished (dates as YYYY-MM-DD). */
export function isOpenCamp(r: Row, now: number, today: string): boolean {
  if (!r.slug) return false;
  if (r.registration_opens_at && now < Date.parse(r.registration_opens_at)) return false;
  if (r.registration_closes_at && now >= Date.parse(r.registration_closes_at)) return false;
  const last = r.ends_on ?? r.starts_on;
  if (last && last < today) return false;
  return true;
}

export const getHubCamps = cache(async (orgId: string): Promise<HubCamp[]> => {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("programs")
      .select("slug,name,description,price_chf,location,starts_on,ends_on,registration_opens_at,registration_closes_at")
      .eq("org_id", orgId)
      .eq("kind", "camp")
      .eq("is_public", true)
      .eq("is_active", true)
      .not("slug", "is", null)
      .order("starts_on", { ascending: true, nullsFirst: false })
      .limit(HUB_CAMP_LIMIT * 2);
    if (error || !data) return [];
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    return (data as unknown as Row[])
      .filter((r) => isOpenCamp(r, now, today))
      .slice(0, HUB_CAMP_LIMIT)
      .map((r) => ({
        slug: r.slug!,
        name: r.name,
        description: r.description,
        price: Number(r.price_chf ?? 0),
        location: r.location,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
      }));
  } catch {
    return [];
  }
});
