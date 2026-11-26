import { asBillingClient } from "@/lib/people/billing-athletes";
import { createClient } from "@/lib/supabase/server";
import { HIDDEN_ATHLETE_STATUS_FILTER, VISIBLE_FAMILY_STATUS } from "@/lib/people/person-delete";
import { loadOpenInvoices } from "@/lib/data/open-invoices";
import { openByFamily, openByFamilyActivity, type CurrencyTotals, type OpenBucket } from "@/lib/payments/open-invoices";

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(data: T): Result<T> => ({ data, error: null });
const fail = (error: string): Result<never> => ({ data: null, error });

const uniq = (ids: (string | null | undefined)[]) =>
  Array.from(new Set(ids.filter((x): x is string => Boolean(x))));

/** Pages through a query: PostgREST caps one response at ~1000 rows. */
async function allRows<R>(page: (from: number, to: number) => PromiseLike<{ data: R[] | null; error: { message: string } | null }>): Promise<{ rows: R[]; error: string | null }> {
  const rows: R[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) return { rows, error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { rows, error: null };
}

export type FamilyListItem = {
  id: string;
  name: string;
  phone: string | null;
  membership: "member" | "guest";
  athleteCount: number;
  openInvoices: number;
  /** What the family still owes on open invoices, per currency. */
  balance: CurrencyTotals;
};

/**
 * Every visible family of the club (paged past the 1000-row response cap),
 * optionally narrowed by membership and a name / phone / e-mail search, with
 * athlete counts and the real balance of their open invoices (sent, partially
 * paid, overdue; drafts are not owed yet).
 */
export async function listFamilies(membership?: "member" | "guest" | null, search?: string | null): Promise<Result<FamilyListItem[]>> {
  const supabase = await createClient();
  const q = (search ?? "").trim().replace(/[%,()*\\]/g, " ").trim().slice(0, 80);
  const [families, athletes, open] = await Promise.all([
    allRows<{ id: string; name: string; phone: string | null; membership_status: "member" | "guest" | null }>((from, to) => {
      let qb = supabase.from("families").select("id,name,phone,membership_status").eq("status", VISIBLE_FAMILY_STATUS);
      if (membership) qb = qb.eq("membership_status", membership);
      if (q) qb = qb.or(`name.ilike.%${q}%,phone.ilike.%${q}%,contact_email.ilike.%${q}%,contact_name.ilike.%${q}%`);
      return qb.order("name").order("id").range(from, to);
    }),
    allRows<{ id: string; family_id: string }>((from, to) =>
      asBillingClient(supabase).from("billing_athletes").select("id,family_id").not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER).order("id").range(from, to)),
    loadOpenInvoices(supabase),
  ]);
  if (families.error) return fail(families.error);
  if (athletes.error) return fail(athletes.error);
  if (open.error !== null) return fail(open.error);

  const countByFamily = new Map<string, number>();
  for (const a of athletes.rows)
    countByFamily.set(a.family_id, (countByFamily.get(a.family_id) ?? 0) + 1);
  const balByFamily = openByFamily(open.data);

  return ok(
    families.rows.map((f) => ({
      id: f.id,
      name: f.name,
      phone: f.phone,
      membership: f.membership_status ?? "member",
      athleteCount: countByFamily.get(f.id) ?? 0,
      openInvoices: balByFamily.get(f.id)?.count ?? 0,
      balance: balByFamily.get(f.id)?.totals ?? {},
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
  /** Null for a finance-only caller (billing columns only). */
  dob: string | null;
  status: string;
  sponsorshipKind: "none" | "full" | "partial";
  sponsorshipPercent: number | null;
};
export type FamilyInvoice = {
  id: string;
  number: string;
  total: number;
  currency: string;
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
  /** active | archived | erased (20250420102500). */
  status: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  contactName: string | null;
  contactEmail: string | null;
  guardians: Guardian[];
  athletes: FamilyAthlete[];
  invoices: FamilyInvoice[];
  /** Still owed on open invoices, per currency. */
  balance: CurrencyTotals;
  openInvoiceCount: number;
  /** Open count and balance per billing activity (club_membership, selection, …), per currency. */
  balanceByActivity: Record<string, OpenBucket>;
  registrationCount: number;
  documents: FamilyDocument[];
};

export async function getFamily(id: string): Promise<Result<FamilyDetail | null>> {
  const supabase = await createClient();
  const { data: family, error } = await supabase
    .from("families")
    .select("id,name,status,address,postal_code,city,phone,contact_name,contact_email")
    .eq("id", id)
    .maybeSingle();
  if (error) return fail(error.message);
  if (!family) return ok(null);

  const [members, athletes, invoices, famDocs] = await Promise.all([
    supabase.from("family_members").select("profile_id,relation,is_primary").eq("family_id", id),
    familyAthletes(supabase, id),
    supabase.from("invoices").select("id,number,total_chf,currency,status,due_date,issued_at").eq("family_id", id).order("issued_at", { ascending: false }),
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

  const open = await loadOpenInvoices(supabase, { familyId: id });
  if (open.error !== null) return fail(open.error);
  const bucket = openByFamily(open.data).get(id);
  const balance = bucket?.totals ?? {};
  const openInvoiceCount = bucket?.count ?? 0;
  // Club, selection, camp … balances side by side, never merged (billing activities).
  const balanceByActivity: Record<string, OpenBucket> = openByFamilyActivity(open.data).get(id) ?? {};

  return ok({
    id: family.id,
    name: family.name,
    status: (family as { status?: string }).status ?? "active",
    address: family.address,
    postalCode: family.postal_code,
    city: family.city,
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
      sponsorshipKind: a.sponsorship_kind ?? "none",
      sponsorshipPercent: a.sponsorship_percent === null || a.sponsorship_percent === undefined ? null : Number(a.sponsorship_percent),
    })),
    invoices: (invoices.data ?? []).map((i) => ({
      id: i.id,
      number: i.number,
      total: Number(i.total_chf ?? 0),
      currency: (i.currency ?? "CHF").toUpperCase(),
      status: i.status,
      dueDate: i.due_date,
    })),
    balance,
    openInvoiceCount,
    balanceByActivity,
    registrationCount: (regCount as { count: number | null }).count ?? 0,
    documents: Array.from(docMap.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  });
}

/**
 * Children of a family: the full row for admins; billing columns (no DOB, no
 * profile fields) through billing_athletes for a finance-only caller
 * (20250420106300: finance never selects the athletes table).
 */
async function familyAthletes(supabase: Awaited<ReturnType<typeof createClient>>, familyId: string) {
  type Row = { id: string; first_name: string; last_name: string; dob: string | null; status: string; sponsorship_kind: "none" | "full" | "partial"; sponsorship_percent: number | null };
  const full = await supabase.from("athletes").select("id,first_name,last_name,dob,status,sponsorship_kind,sponsorship_percent")
    .eq("family_id", familyId).not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER).order("first_name");
  if (full.error || (full.data ?? []).length) return { data: (full.data ?? []) as Row[], error: full.error };
  const b = await asBillingClient(supabase).from("billing_athletes").select("id,first_name,last_name,status,sponsorship_kind,sponsorship_percent")
    .eq("family_id", familyId).not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER).order("first_name");
  return { data: (b.data ?? []).map((a): Row => ({ ...a, sponsorship_kind: a.sponsorship_kind as Row["sponsorship_kind"], dob: null })), error: b.error };
}
