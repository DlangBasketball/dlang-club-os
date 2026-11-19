import { createClient } from "@/lib/supabase/server";

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(data: T): Result<T> => ({ data, error: null });
const fail = (error: string): Result<never> => ({ data: null, error });
const uniq = (ids: (string | null | undefined)[]) =>
  Array.from(new Set(ids.filter((x): x is string => Boolean(x))));

export type RegistrationListItem = {
  id: string;
  status: string;
  createdAt: string;
  athleteName: string;
  programName: string;
  familyName: string;
};

export async function listRegistrations(): Promise<Result<RegistrationListItem[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("registrations")
    .select("id,status,created_at,athlete_id,program_id")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return fail(error.message);

  const athleteIds = uniq((data ?? []).map((r) => r.athlete_id));
  const programIds = uniq((data ?? []).map((r) => r.program_id));
  const athletes = athleteIds.length
    ? await supabase.from("athletes").select("id,first_name,last_name,family_id").in("id", athleteIds)
    : { data: [] as { id: string; first_name: string; last_name: string; family_id: string }[] };
  const programs = programIds.length
    ? await supabase.from("programs").select("id,name").in("id", programIds)
    : { data: [] as { id: string; name: string }[] };
  const familyIds = uniq((athletes.data ?? []).map((a) => a.family_id));
  const families = familyIds.length
    ? await supabase.from("families").select("id,name").in("id", familyIds)
    : { data: [] as { id: string; name: string }[] };

  const aMap = new Map((athletes.data ?? []).map((a) => [a.id, a]));
  const pName = new Map((programs.data ?? []).map((p) => [p.id, p.name]));
  const fName = new Map((families.data ?? []).map((f) => [f.id, f.name]));

  return ok(
    (data ?? []).map((r) => {
      const a = aMap.get(r.athlete_id);
      return {
        id: r.id,
        status: r.status,
        createdAt: r.created_at,
        athleteName: a ? `${a.first_name} ${a.last_name}` : "Athlete",
        programName: pName.get(r.program_id) ?? "Program",
        familyName: a ? fName.get(a.family_id) ?? "—" : "—",
      };
    }),
  );
}

export type RegistrationConsent = { id: string; title: string; status: string; acceptedAt: string; ip: string | null };
export type RegistrationInvoice = { id: string; number: string; total: number; status: string; dueDate: string | null };
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
    familyId
      ? supabase.from("invoices").select("id,number,total_chf,status,due_date").eq("family_id", familyId).eq("program_id", reg.program_id)
      : Promise.resolve({ data: [] as { id: string; number: string; total_chf: number; status: string; due_date: string | null }[] }),
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
    invoices: (invoicesRes.data ?? []).map((i) => ({
      id: i.id,
      number: i.number,
      total: Number(i.total_chf ?? 0),
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
