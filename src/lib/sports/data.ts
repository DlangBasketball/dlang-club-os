import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { shopDb, type LocationRow } from "@/lib/shop/db";
import type { SportItem } from "@/components/sports/sports-manager";
import { SPORT_TERMS, type SportTerm } from "./icons";

/** Sports of the session's club (RLS) with how many teams / programmes use each. */
export async function listSports(orgId: string): Promise<SportItem[]> {
  const db = await shopDb();
  const [{ data: sports }, { data: teams }, { data: programs }] = await Promise.all([
    db.from("sports").select("*").eq("org_id", orgId).order("sort_order").order("name"),
    db.from("teams").select("sport_id").eq("org_id", orgId).not("sport_id" as never, "is", null),
    db.from("programs").select("sport_id").eq("org_id", orgId).not("sport_id" as never, "is", null),
  ]);
  const usage = new Map<string, number>();
  for (const r of [...((teams ?? []) as { sport_id?: string | null }[]), ...((programs ?? []) as { sport_id?: string | null }[])]) {
    if (r.sport_id) usage.set(r.sport_id, (usage.get(r.sport_id) ?? 0) + 1);
  }
  return (sports ?? []).map((s) => {
    const raw = (s.terminology ?? {}) as Record<string, unknown>;
    const terminology: Partial<Record<SportTerm, string>> = {};
    for (const k of SPORT_TERMS) if (typeof raw[k] === "string") terminology[k] = raw[k] as string;
    return { id: s.id, name: s.name, icon: s.icon, terminology, isActive: s.is_active, sortOrder: s.sort_order, usage: usage.get(s.id) ?? 0 };
  });
}

/** Active sports for pickers. */
export async function sportOptions(orgId: string): Promise<{ id: string; name: string }[]> {
  const db = await shopDb();
  const { data } = await db.from("sports").select("id,name").eq("org_id", orgId).eq("is_active", true).order("sort_order").order("name");
  return (data ?? []).map((s) => ({ id: s.id, name: s.name }));
}

/** Current sport_id of a taggable row (RLS). */
export async function currentSportId(table: "teams" | "programs", id: string): Promise<string | null> {
  const db = await shopDb();
  const { data } = await db.from(table).select("sport_id" as never).eq("id", id).maybeSingle();
  return ((data as { sport_id?: string | null } | null)?.sport_id) ?? null;
}

/** Current sport_id of an assessment template (RLS: admins / coaches of the club). */
export async function assessmentSportId(id: string): Promise<string | null> {
  const db = (await createClient()) as unknown as SupabaseClient;
  const { data } = await db.from("assessment_templates").select("sport_id").eq("id", id).maybeSingle();
  return ((data as { sport_id?: string | null } | null)?.sport_id) ?? null;
}

export async function listLocations(orgId: string): Promise<LocationRow[]> {
  const db = await shopDb();
  const { data } = await db.from("venues").select("*").eq("org_id", orgId).order("is_active", { ascending: false }).order("name");
  return (data ?? []) as LocationRow[];
}

export async function getLocation(orgId: string, id: string): Promise<{ venue: LocationRow; spaces: { id: string; name: string; isActive: boolean }[] } | null> {
  const db = await shopDb();
  const { data } = await db.from("venues").select("*").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (!data) return null;
  const generic = (await createClient()) as unknown as SupabaseClient;
  const { data: spaces } = await generic.from("venue_spaces").select("id,name,is_active").eq("venue_id", id).eq("org_id", orgId).order("name");
  const rows = (spaces ?? []) as { id: string; name: string; is_active: boolean }[];
  return { venue: data as LocationRow, spaces: rows.map((s) => ({ id: s.id, name: s.name, isActive: s.is_active })) };
}
