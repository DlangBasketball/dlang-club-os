import { createClient } from "@/lib/supabase/server";

export type Result<T> = { data: T; error: null } | { data: null; error: string };

export type ProgramListItem = {
  id: string;
  name: string;
  slug: string | null;
  kind: "camp" | "recurring_team" | "clinic" | "tournament";
  price: number;
  capacity: number | null;
  enrolled: number;
  startsOn: string | null;
  endsOn: string | null;
  location: string | null;
  isPublic: boolean;
  isActive: boolean;
};

/** The current org's programmes (RLS: programs_select scopes to the caller's org). */
export async function listPrograms(orgId: string): Promise<Result<ProgramListItem[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("programs")
    .select("id,name,slug,kind,price_chf,capacity,starts_on,ends_on,location,is_public,is_active")
    // programs_select also admits other clubs' PUBLIC programmes: filter to ours.
    .eq("org_id", orgId)
    .order("is_active", { ascending: false })
    .order("starts_on", { ascending: true, nullsFirst: false })
    .order("name");
  if (error) return { data: null, error: error.message };

  const ids = (data ?? []).map((p) => p.id);
  const { data: regs } = ids.length
    ? await supabase.from("registrations").select("program_id,status").in("program_id", ids).in("status", ["pending", "confirmed"])
    : { data: [] as { program_id: string; status: string }[] };
  const count = new Map<string, number>();
  for (const r of regs ?? []) count.set(r.program_id, (count.get(r.program_id) ?? 0) + 1);

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
    })),
    error: null,
  };
}
