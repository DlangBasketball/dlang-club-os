import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";

export type DocScope = "global" | "program" | "family" | "athlete";
export type AdminDoc = { id: string; title: string | null; fileName: string | null; kind: string; scope: DocScope; targetName: string; sizeBytes: number | null; createdAt: string };

function scopeOf(d: { athlete_id: string | null; family_id: string | null; program_id: string | null }): DocScope {
  if (d.athlete_id) return "athlete";
  if (d.family_id) return "family";
  if (d.program_id) return "program";
  return "global";
}

export async function listAllDocuments(): Promise<AdminDoc[]> {
  const me = await getSessionUser();
  if (!me?.orgId) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("documents").select("id,title,file_name,kind,athlete_id,family_id,program_id,size_bytes,created_at").eq("org_id", me.orgId).order("created_at", { ascending: false });
  const rows = data ?? [];
  const aIds = rows.map((r) => r.athlete_id).filter((x): x is string => !!x);
  const fIds = rows.map((r) => r.family_id).filter((x): x is string => !!x);
  const pIds = rows.map((r) => r.program_id).filter((x): x is string => !!x);
  const [aRes, fRes, pRes] = await Promise.all([
    aIds.length ? admin.from("athletes").select("id,first_name,last_name").in("id", aIds) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
    fIds.length ? admin.from("families").select("id,name").in("id", fIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    pIds.length ? admin.from("programs").select("id,name").in("id", pIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const aName = new Map((aRes.data ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`]));
  const fName = new Map((fRes.data ?? []).map((f) => [f.id, f.name]));
  const pName = new Map((pRes.data ?? []).map((p) => [p.id, p.name]));
  return rows.map((r) => {
    const scope = scopeOf(r);
    const targetName = scope === "athlete" ? aName.get(r.athlete_id!) ?? "—" : scope === "family" ? fName.get(r.family_id!) ?? "—" : scope === "program" ? pName.get(r.program_id!) ?? "—" : "All members";
    return { id: r.id, title: r.title, fileName: r.file_name, kind: r.kind, scope, targetName, sizeBytes: r.size_bytes, createdAt: r.created_at };
  });
}

export type Opt = { id: string; label: string };
export async function documentTargets(): Promise<{ programs: Opt[]; families: Opt[]; athletes: Opt[] }> {
  const me = await getSessionUser();
  if (!me?.orgId) return { programs: [], families: [], athletes: [] };
  const admin = createAdminClient();
  const [p, f, a] = await Promise.all([
    admin.from("programs").select("id,name").eq("org_id", me.orgId).order("name"),
    admin.from("families").select("id,name").eq("org_id", me.orgId).order("name"),
    admin.from("athletes").select("id,first_name,last_name").eq("org_id", me.orgId).order("last_name"),
  ]);
  return {
    programs: (p.data ?? []).map((x) => ({ id: x.id, label: x.name })),
    families: (f.data ?? []).map((x) => ({ id: x.id, label: x.name })),
    athletes: (a.data ?? []).map((x) => ({ id: x.id, label: `${x.first_name} ${x.last_name}` })),
  };
}
