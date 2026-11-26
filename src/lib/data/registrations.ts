import { asBillingClient } from "@/lib/people/billing-athletes";
import { createClient } from "@/lib/supabase/server";
import { isHiddenAthleteStatus } from "@/lib/people/person-delete";
import { campsDb } from "@/lib/camps/db";

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(data: T): Result<T> => ({ data, error: null });
const fail = (error: string): Result<never> => ({ data: null, error });
const uniq = (ids: (string | null | undefined)[]) =>
  Array.from(new Set(ids.filter((x): x is string => Boolean(x))));

export type RegistrationListItem = {
  id: string;
  status: string;
  createdAt: string;
  athleteId: string;
  athleteName: string | null;
  programId: string;
  programName: string | null;
  /** Camp week (edition) of a camp registration. */
  editionName: string | null;
  editionStartsOn: string | null;
  familyId: string | null;
  familyName: string | null;
};

export type RegistrationFilter = {
  status?: string;
  programId?: string;
  familyId?: string;
  /** Athlete or family name. */
  q?: string;
  /** 1-based page. */
  page?: number;
  pageSize?: number;
};

export type RegistrationPage = { rows: RegistrationListItem[]; hasMore: boolean; page: number };

const REG_STATUSES = new Set(["pending", "confirmed", "waitlist", "cancelled", "completed"]);
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * One page of the club's registrations (programmes and camp weeks), newest
 * first, filterable by status, programme, family and athlete / family name.
 * Older registrations stay reachable through paging instead of being cut off
 * at a fixed row limit. Archived / erased people are left out (Recently
 * deleted lists them).
 */
export async function findRegistrations(filter: RegistrationFilter = {}): Promise<Result<RegistrationPage>> {
  const db = await campsDb();
  const pageSize = Math.min(Math.max(filter.pageSize ?? 100, 1), 999);
  const page = Math.max(1, Math.floor(filter.page ?? 1));
  const from = (page - 1) * pageSize;
  const familyId = filter.familyId && UUID.test(filter.familyId) ? filter.familyId : null;
  const term = (filter.q ?? "").trim().replace(/[%,()*\\]/g, " ").trim().slice(0, 80);

  // Family / name narrowing happens on the athletes first.
  let athleteIds: string[] | null = null;
  if (term || familyId) {
    let famAthletes: Set<string> | null = null;
    if (familyId) {
      const { data, error } = await asBillingClient(db).from("billing_athletes").select("id").eq("family_id", familyId).limit(500);
      if (error) return fail(error.message);
      famAthletes = new Set((data ?? []).map((a) => a.id));
    }
    let matched: Set<string> | null = null;
    if (term) {
      const words = term.split(/\s+/).filter(Boolean).slice(0, 3);
      let aq = db.from("athletes").select("id");
      for (const w of words) aq = aq.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%`);
      const [byName, fams] = await Promise.all([aq.limit(500), db.from("families").select("id").ilike("name", `%${term}%`).limit(200)]);
      if (byName.error) return fail(byName.error.message);
      if (fams.error) return fail(fams.error.message);
      matched = new Set((byName.data ?? []).map((a) => a.id));
      const famIds = (fams.data ?? []).map((f) => f.id);
      if (famIds.length) {
        const { data, error } = await asBillingClient(db).from("billing_athletes").select("id").in("family_id", famIds).limit(1000);
        if (error) return fail(error.message);
        for (const a of data ?? []) matched.add(a.id);
      }
    }
    athleteIds = famAthletes && matched ? Array.from(famAthletes).filter((id) => matched!.has(id)) : Array.from(famAthletes ?? matched ?? []);
    if (!athleteIds.length) return ok({ rows: [], hasMore: false, page });
  }

  let q = db
    .from("registrations")
    .select("id,status,created_at,athlete_id,program_id,camp_edition_id")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + pageSize); // one extra row tells whether there is a next page
  if (filter.status && REG_STATUSES.has(filter.status)) q = q.eq("status", filter.status as never);
  if (filter.programId && UUID.test(filter.programId)) q = q.eq("program_id", filter.programId);
  if (athleteIds) q = q.in("athlete_id", athleteIds.slice(0, 300));
  const { data, error } = await q;
  if (error) return fail(error.message);
  const hasMore = (data ?? []).length > pageSize;
  const regs = (data ?? []).slice(0, pageSize);

  const aIds = uniq(regs.map((r) => r.athlete_id));
  const pIds = uniq(regs.map((r) => r.program_id));
  const eIds = uniq(regs.map((r) => r.camp_edition_id));
  const [athletes, programs, editions] = await Promise.all([
    aIds.length ? asBillingClient(db).from("billing_athletes").select("id,first_name,last_name,family_id,status").in("id", aIds) : Promise.resolve({ data: [], error: null }),
    pIds.length ? db.from("programs").select("id,name").in("id", pIds) : Promise.resolve({ data: [], error: null }),
    eIds.length ? db.from("camp_editions").select("id,name,starts_on").in("id", eIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (athletes.error) return fail(athletes.error.message);
  if (programs.error) return fail(programs.error.message);
  if (editions.error) return fail(editions.error.message);
  const aMap = new Map((athletes.data ?? []).map((a) => [a.id, a]));
  const familyIds = uniq((athletes.data ?? []).map((a) => a.family_id));
  const families = familyIds.length ? await db.from("families").select("id,name").in("id", familyIds) : { data: [] as { id: string; name: string }[], error: null };
  if (families.error) return fail(families.error.message);
  const pName = new Map((programs.data ?? []).map((p) => [p.id, p.name]));
  const eMap = new Map((editions.data ?? []).map((e) => [e.id, e]));
  const fName = new Map((families.data ?? []).map((f) => [f.id, f.name]));

  return ok({
    hasMore,
    page,
    rows: regs
      .filter((r) => !isHiddenAthleteStatus(aMap.get(r.athlete_id)?.status))
      .map((r) => {
        const a = aMap.get(r.athlete_id);
        const e = r.camp_edition_id ? eMap.get(r.camp_edition_id) : undefined;
        return {
          id: r.id,
          status: r.status,
          createdAt: r.created_at,
          athleteId: r.athlete_id,
          athleteName: a ? `${a.first_name} ${a.last_name}` : null,
          programId: r.program_id,
          programName: pName.get(r.program_id) ?? null,
          editionName: e?.name ?? null,
          editionStartsOn: e?.starts_on ?? null,
          familyId: a?.family_id ?? null,
          familyName: a ? fName.get(a.family_id) ?? null : null,
        };
      }),
  });
}

/** Programmes of the club for the registrations filter (archived ones too). */
export async function registrationProgramOptions(orgId: string): Promise<Result<{ id: string; name: string; isActive: boolean }[]>> {
  const db = await campsDb();
  const { data, error } = await db.from("programs").select("id,name,is_active").eq("org_id", orgId).order("is_active", { ascending: false }).order("name").limit(1000);
  if (error) return fail(error.message);
  return ok((data ?? []).map((p) => ({ id: p.id, name: p.name, isActive: Boolean(p.is_active) })));
}

export type RegistrationConsent = { id: string; title: string; status: string; acceptedAt: string; ip: string | null };
export type RegistrationInvoice = { id: string; number: string; total: number; currency: string; status: string; dueDate: string | null };
export type RegistrationDetail = {
  id: string;
  status: string;
  createdAt: string;
  notes: string | null;
  cancellationReason: string | null;
  cancelledAt: string | null;
  athlete: { id: string; name: string; dob: string };
  family: { id: string; name: string; contactName: string | null; contactEmail: string | null; phone: string | null };
  program: { id: string; name: string; slug: string | null };
  /** Camp week of a camp registration. */
  edition: { id: string; name: string | null; startsOn: string; endsOn: string } | null;
  invoices: RegistrationInvoice[];
  consents: RegistrationConsent[];
};

export async function getRegistrationDetail(id: string): Promise<Result<RegistrationDetail | null>> {
  const supabase = await createClient();
  const { data: reg, error } = await supabase
    .from("registrations")
    .select("id,status,created_at,notes,athlete_id,program_id,cancellation_reason,cancelled_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return fail(error.message);
  if (!reg) return ok(null);
  const { data: campReg, error: campErr } = await (await campsDb())
    .from("registrations")
    .select("invoice_id,camp_edition_id")
    .eq("id", id)
    .maybeSingle();
  if (campErr) return fail(campErr.message);
  const edition = campReg?.camp_edition_id
    ? (await (await campsDb()).from("camp_editions").select("id,name,starts_on,ends_on").eq("id", campReg.camp_edition_id).maybeSingle()).data
    : null;

  const { data: athlete } = await supabase
    .from("athletes")
    .select("id,first_name,last_name,dob,family_id")
    .eq("id", reg.athlete_id)
    .maybeSingle();
  const familyId = athlete?.family_id ?? null;

  const [familyRes, programRes, invoicesRes, consentsRes] = await Promise.all([
    familyId
      ? supabase.from("families").select("id,name,contact_name,contact_email,phone").eq("id", familyId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("programs").select("id,name,slug").eq("id", reg.program_id).maybeSingle(),
    // The registration's own invoice (camp weeks, basket bookings: one invoice
    // can carry several weeks and no programme), invoices pointing back at
    // it, and the family's invoices for the programme (older registrations).
    supabase
      .from("invoices")
      .select("id,number,total_chf,currency,status,due_date")
      .or(
        [
          `registration_id.eq.${reg.id}`,
          ...(campReg?.invoice_id ? [`id.eq.${campReg.invoice_id}`] : []),
          ...(familyId ? [`and(family_id.eq.${familyId},program_id.eq.${reg.program_id})`] : []),
        ].join(","),
      )
      .order("issued_at", { ascending: false }),
    supabase.from("consent_acceptances").select("id,accepted_at,status,ip_address,consent_form_id").eq("athlete_id", reg.athlete_id),
  ]);

  const consentFormIds = uniq((consentsRes.data ?? []).map((c) => c.consent_form_id));
  const consentForms = consentFormIds.length
    ? await supabase.from("consent_forms").select("id,title").in("id", consentFormIds)
    : { data: [] as { id: string; title: string }[] };
  const cTitle = new Map((consentForms.data ?? []).map((c) => [c.id, c.title]));

  return ok({
    id: reg.id,
    status: reg.status,
    createdAt: reg.created_at,
    notes: reg.notes,
    cancellationReason: reg.cancellation_reason,
    cancelledAt: reg.cancelled_at,
    athlete: {
      id: reg.athlete_id,
      name: athlete ? `${athlete.first_name} ${athlete.last_name}` : "Athlete",
      dob: athlete?.dob ?? "",
    },
    family: {
      id: familyId ?? "",
      name: familyRes.data?.name ?? "—",
      contactName: familyRes.data?.contact_name ?? null,
      contactEmail: familyRes.data?.contact_email ?? null,
      phone: familyRes.data?.phone ?? null,
    },
    program: {
      id: reg.program_id,
      name: programRes.data?.name ?? "Program",
      slug: programRes.data?.slug ?? null,
    },
    edition: edition ? { id: edition.id, name: edition.name ?? null, startsOn: edition.starts_on, endsOn: edition.ends_on } : null,
    invoices: (invoicesRes.data ?? []).map((i) => ({
      id: i.id,
      number: i.number,
      total: Number(i.total_chf ?? 0),
      currency: (i.currency ?? "CHF").toUpperCase(),
      status: i.status,
      dueDate: i.due_date,
    })),
    consents: (consentsRes.data ?? []).map((c) => ({
      id: c.id,
      title: cTitle.get(c.consent_form_id) ?? "Consent",
      status: c.status,
      acceptedAt: c.accepted_at,
      ip: (c.ip_address as string | null) ?? null,
    })),
  });
}
