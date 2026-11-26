import { createClient } from "@/lib/supabase/server";
import { campsDb } from "@/lib/camps/db";

export type Result<T> = { data: T; error: null } | { data: null; error: string };

export type ProgramListItem = {
  id: string;
  name: string;
  slug: string | null;
  kind: "camp" | "recurring_team" | "clinic" | "tournament" | "selection";
  price: number;
  capacity: number | null;
  enrolled: number;
  startsOn: string | null;
  endsOn: string | null;
  location: string | null;
  isPublic: boolean;
  isActive: boolean;
  status: "draft" | "published" | "archived";
  currency: string | null;
  /** Camps: season set on the programme (null = derived from the first week). */
  season?: string | null;
  seasonYear?: number | null;
  /** Camps: first day of the first week. */
  firstWeek?: string | null;
};

/** The current org's programmes (RLS: programs_select scopes to the caller's org). */
export async function listPrograms(orgId: string): Promise<Result<ProgramListItem[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("programs")
    .select("id,name,slug,kind,price_chf,capacity,starts_on,ends_on,location,is_public,is_active,status,currency,season,season_year")
    // programs_select also admits other clubs' PUBLIC programmes: filter to ours.
    .eq("org_id", orgId)
    .order("is_active", { ascending: false })
    .order("starts_on", { ascending: true, nullsFirst: false })
    .order("name");
  if (error) return { data: null, error: error.message };

  const ids = (data ?? []).map((p) => p.id);
  // Active registrations per programme. Paged: one response is capped at
  // ~1000 rows, which made counts of big clubs stop at 1000 in total.
  const count = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    for (let from = 0; from < 200_000; from += 1000) {
      const { data: regs, error: regErr } = await supabase
        .from("registrations").select("id,program_id").in("program_id", chunk).in("status", ["pending", "confirmed"])
        .order("id").range(from, from + 999);
      if (regErr) return { data: null, error: regErr.message };
      for (const r of regs ?? []) count.set(r.program_id, (count.get(r.program_id) ?? 0) + 1);
      if (!regs || regs.length < 1000) break;
    }
  }
  // Camps: first week (season grouping when no season is set on the programme).
  const campIds = (data ?? []).filter((p) => p.kind === "camp").map((p) => p.id);
  const { data: weeks } = campIds.length
    ? await (await campsDb()).from("camp_editions").select("program_id,starts_on").in("program_id", campIds).order("starts_on")
    : { data: [] as { program_id: string; starts_on: string }[] };
  const firstWeek = new Map<string, string>();
  for (const w of weeks ?? []) if (!firstWeek.has(w.program_id)) firstWeek.set(w.program_id, w.starts_on);

  return {
    data: (data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      kind: p.kind,
      price: Number(p.price_chf ?? 0),
      capacity: p.capacity,
      enrolled: count.get(p.id) ?? 0,
      startsOn: p.starts_on,
      endsOn: p.ends_on,
      location: p.location,
      isPublic: p.is_public,
      isActive: p.is_active,
      status: ((p as { status?: string }).status ?? (p.is_active ? "published" : "archived")) as ProgramListItem["status"],
      currency: (p as { currency?: string | null }).currency ?? null,
      season: p.season ?? null,
      seasonYear: p.season_year ?? null,
      firstWeek: firstWeek.get(p.id) ?? null,
    })),
    error: null,
  };
}

export type ProgramDetail = ProgramListItem & {
  description: string | null;
  scheduleSummary: string;
  minAge: number | null;
  maxAge: number | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  archivedAt: string | null;
  registrations: number;
  updatedAt: string;
};

type ProgramDbRow = {
  id: string; name: string; slug: string | null; kind: ProgramListItem["kind"]; description: string | null; price_chf: number | string | null;
  capacity: number | null; starts_on: string | null; ends_on: string | null; location: string | null; schedule: unknown;
  is_public: boolean; is_active: boolean; status: ProgramListItem["status"]; currency: string | null; min_age: number | null; max_age: number | null;
  registration_opens_at: string | null; registration_closes_at: string | null; archived_at: string | null; updated_at: string;
};

/** One programme of the caller's org, with registration counts. */
export async function getProgram(orgId: string, id: string): Promise<Result<ProgramDetail | null>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { data: null as unknown as ProgramDetail, error: null };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("programs")
    .select("id,name,slug,kind,description,price_chf,capacity,starts_on,ends_on,location,schedule,is_public,is_active,status,currency,min_age,max_age,registration_opens_at,registration_closes_at,archived_at,updated_at")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!data) return { data: null as unknown as ProgramDetail, error: null };
  const p = data as unknown as ProgramDbRow;
  const [{ count: active }, { count: all }] = await Promise.all([
    supabase.from("registrations").select("id", { count: "exact", head: true }).eq("program_id", id).in("status", ["pending", "confirmed"]),
    supabase.from("registrations").select("id", { count: "exact", head: true }).eq("program_id", id),
  ]);
  const summary = p.schedule && typeof p.schedule === "object" && typeof (p.schedule as { summary?: unknown }).summary === "string"
    ? (p.schedule as { summary: string }).summary : "";
  return {
    data: {
      id: p.id, name: p.name, slug: p.slug, kind: p.kind, price: Number(p.price_chf ?? 0), capacity: p.capacity,
      enrolled: active ?? 0, startsOn: p.starts_on, endsOn: p.ends_on, location: p.location, isPublic: p.is_public,
      isActive: p.is_active, status: p.status, currency: p.currency, description: p.description, scheduleSummary: summary,
      minAge: p.min_age, maxAge: p.max_age, registrationOpensAt: p.registration_opens_at, registrationClosesAt: p.registration_closes_at,
      archivedAt: p.archived_at, registrations: all ?? 0, updatedAt: p.updated_at,
    },
    error: null,
  };
}
