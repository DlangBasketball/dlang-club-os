import { createClient } from "@/lib/supabase/server";

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(data: T): Result<T> => ({ data, error: null });
const fail = (error: string): Result<never> => ({ data: null, error });

const UNPAID: ("pending" | "draft" | "overdue")[] = ["pending", "draft", "overdue"];
const uniq = (ids: (string | null | undefined)[]) =>
  Array.from(new Set(ids.filter((x): x is string => Boolean(x))));

export type FamilyListItem = {
  id: string;
  name: string;
  phone: string | null;
  athleteCount: number;
  openInvoices: number;
  balance: number;
};

export async function listFamilies(): Promise<Result<FamilyListItem[]>> {
  const supabase = await createClient();
  const [families, athletes, invoices] = await Promise.all([
    supabase.from("families").select("id,name,phone").order("name"),
    supabase.from("athletes").select("id,family_id"),
    supabase.from("invoices").select("family_id,total_chf,status").in("status", UNPAID),
  ]);
  if (families.error) return fail(families.error.message);

  const countByFamily = new Map<string, number>();
  for (const a of athletes.data ?? [])
    countByFamily.set(a.family_id, (countByFamily.get(a.family_id) ?? 0) + 1);

  const balByFamily = new Map<string, { count: number; total: number }>();
  for (const inv of invoices.data ?? []) {
    const e = balByFamily.get(inv.family_id) ?? { count: 0, total: 0 };
    e.count++;
    e.total += Number(inv.total_chf ?? 0);
    balByFamily.set(inv.family_id, e);
  }

  return ok(
    (families.data ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      phone: f.phone,
      athleteCount: countByFamily.get(f.id) ?? 0,
      openInvoices: balByFamily.get(f.id)?.count ?? 0,
      balance: balByFamily.get(f.id)?.total ?? 0,
    })),
  );
}

export type Guardian = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  relation: string | null;
  isPrimary: boolean;
};
export type FamilyAthlete = {
  id: string;
  firstName: string;
  lastName: string;
  dob: string;
  status: string;
};
export type FamilyInvoice = {
  id: string;
  number: string;
  total: number;
  status: string;
  dueDate: string | null;
};
export type FamilyDocument = {
  id: string;
  kind: string;
  fileName: string | null;
  createdAt: string;
};
export type FamilyDetail = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  contactName: string | null;
  contactEmail: string | null;
  guardians: Guardian[];
  athletes: FamilyAthlete[];
  invoices: FamilyInvoice[];
  balance: number;
  registrationCount: number;
  documents: FamilyDocument[];
};

export async function getFamily(id: string): Promise<Result<FamilyDetail | null>> {
  const supabase = await createClient();
  const { data: family, error } = await supabase
    .from("families")
    .select("id,name,address,phone,contact_name,contact_email")
    .eq("id", id)
    .maybeSingle();
  if (error) return fail(error.message);
  if (!family) return ok(null);

  const [members, athletes, invoices, famDocs] = await Promise.all([
    supabase.from("family_members").select("profile_id,relation,is_primary").eq("family_id", id),
    supabase.from("athletes").select("id,first_name,last_name,dob,status").eq("family_id", id).order("first_name"),
    supabase.from("invoices").select("id,number,total_chf,status,due_date,issued_at").eq("family_id", id).order("issued_at", { ascending: false }),
    supabase.from("documents").select("id,kind,file_name,created_at,athlete_id").eq("family_id", id),
  ]);

  const profileIds = uniq((members.data ?? []).map((m) => m.profile_id));
  const profiles = profileIds.length
    ? await supabase.from("profiles").select("id,full_name,email,phone").in("id", profileIds)
    : { data: [] as { id: string; full_name: string | null; email: string; phone: string | null }[] };
  const pMap = new Map((profiles.data ?? []).map((p) => [p.id, p]));

  const athleteIds = uniq((athletes.data ?? []).map((a) => a.id));
  const [regCount, athleteDocs] = await Promise.all([
    athleteIds.length
      ? supabase.from("registrations").select("id", { count: "exact", head: true }).in("athlete_id", athleteIds)
      : Promise.resolve({ count: 0 }),
    athleteIds.length
      ? supabase.from("documents").select("id,kind,file_name,created_at").in("athlete_id", athleteIds)
      : Promise.resolve({ data: [] as FamilyDocument[] }),
  ]);

  const docMap = new Map<string, FamilyDocument>();
  for (const d of [...(famDocs.data ?? []), ...((athleteDocs as { data: { id: string; kind: string; file_name: string | null; created_at: string }[] }).data ?? [])])
    docMap.set(d.id, { id: d.id, kind: d.kind, fileName: d.file_name, createdAt: d.created_at });

  const balance = (invoices.data ?? [])
    .filter((i) => (UNPAID as readonly string[]).includes(i.status))
    .reduce((sum, i) => sum + Number(i.total_chf ?? 0), 0);

  return ok({
    id: family.id,
    name: family.name,
    address: family.address,
    phone: family.phone,
    contactName: family.contact_name,
    contactEmail: family.contact_email,
    guardians: (members.data ?? []).map((m) => {
      const p = pMap.get(m.profile_id);
      return {
        id: m.profile_id,
        name: p?.full_name ?? null,
        email: p?.email ?? null,
        phone: p?.phone ?? null,
        relation: m.relation,
        isPrimary: m.is_primary,
      };
    }),
    athletes: (athletes.data ?? []).map((a) => ({
      id: a.id,
      firstName: a.first_name,
      lastName: a.last_name,
      dob: a.dob,
      status: a.status,
    })),
    invoices: (invoices.data ?? []).map((i) => ({
      id: i.id,
      number: i.number,
      total: Number(i.total_chf ?? 0),
      status: i.status,
      dueDate: i.due_date,
    })),
    balance,
    registrationCount: (regCount as { count: number | null }).count ?? 0,
    documents: Array.from(docMap.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  });
}
