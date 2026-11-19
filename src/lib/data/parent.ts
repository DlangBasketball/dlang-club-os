import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listInvoices } from "@/lib/data/invoices";

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(d: T): Result<T> => ({ data: d, error: null });
const fail = (e: string): Result<never> => ({ data: null, error: e });
const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => Boolean(x))));

export function ageFromDob(dob: string): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (365.25 * 864e5));
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export type ParentDashboard = {
  children: { id: string; name: string; age: number | null }[];
  openInvoices: { count: number; balance: number };
  upcomingSessions: { id: string; programName: string; startsAt: string; location: string | null }[];
  activeRegistrations: number;
  unreadNotifications: number;
  documentCount: number;
};

export async function getParentDashboard(): Promise<Result<ParentDashboard>> {
  const supabase = await createClient();
  const [kidsRes, invRes, regRes, notifRes, docRes, sessRes] = await Promise.all([
    supabase.from("athletes").select("id,first_name,last_name,dob").order("first_name"),
    listInvoices("all"),
    supabase.from("registrations").select("id,status").in("status", ["confirmed", "pending"]),
    supabase.from("notifications").select("id").is("read_at", null),
    supabase.from("documents").select("id"),
    supabase.from("program_sessions").select("id,program_id,starts_at,location").gte("starts_at", new Date().toISOString()).order("starts_at").limit(5),
  ]);
  if (invRes.error) return fail(invRes.error);

  const open = (invRes.data ?? []).filter((i) => i.balance > 0 && i.status !== "cancelled");
  const programIds = uniq((sessRes.data ?? []).map((s) => s.program_id));
  const progs = programIds.length ? await supabase.from("programs").select("id,name").in("id", programIds) : { data: [] as { id: string; name: string }[] };
  const pName = new Map((progs.data ?? []).map((p) => [p.id, p.name]));

  return ok({
    children: (kidsRes.data ?? []).map((k) => ({ id: k.id, name: `${k.first_name} ${k.last_name}`, age: ageFromDob(k.dob) })),
    openInvoices: { count: open.length, balance: open.reduce((s, i) => s + i.balance, 0) },
    upcomingSessions: (sessRes.data ?? []).map((s) => ({ id: s.id, programName: pName.get(s.program_id) ?? "Session", startsAt: s.starts_at, location: s.location })),
    activeRegistrations: (regRes.data ?? []).length,
    unreadNotifications: (notifRes.data ?? []).length,
    documentCount: (docRes.data ?? []).length,
  });
}

// ---------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------
export type ChildCard = { id: string; name: string; age: number | null; activeRegistrations: number };

export async function listChildren(): Promise<Result<ChildCard[]>> {
  const supabase = await createClient();
  const { data: kids, error } = await supabase.from("athletes").select("id,first_name,last_name,dob").order("first_name");
  if (error) return fail(error.message);
  const ids = (kids ?? []).map((k) => k.id);
  const regs = ids.length ? await supabase.from("registrations").select("athlete_id,status").in("athlete_id", ids).in("status", ["confirmed", "pending"]) : { data: [] as { athlete_id: string; status: string }[] };
  const count = new Map<string, number>();
  for (const r of regs.data ?? []) count.set(r.athlete_id, (count.get(r.athlete_id) ?? 0) + 1);
  return ok((kids ?? []).map((k) => ({ id: k.id, name: `${k.first_name} ${k.last_name}`, age: ageFromDob(k.dob), activeRegistrations: count.get(k.id) ?? 0 })));
}

export type ChildProfile = {
  id: string;
  name: string;
  dob: string;
  age: number | null;
  gender: string | null;
  medical: { allergies: string | null; conditions: string | null; medications: string | null; notes: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null } | null;
  registrations: { id: string; programName: string; status: string }[];
  consents: { title: string; acceptedAt: string }[];
  attendance: { date: string; programName: string | null; status: string }[];
};

export async function getChildProfile(athleteId: string): Promise<Result<ChildProfile | null>> {
  const supabase = await createClient();
  const { data: a, error } = await supabase.from("athletes").select("id,first_name,last_name,dob,gender").eq("id", athleteId).maybeSingle();
  if (error) return fail(error.message);
  if (!a) return ok(null);

  const [medRes, regRes, consentRes, attRes] = await Promise.all([
    supabase.from("athlete_medical").select("allergies,conditions,medications,notes,emergency_contact_name,emergency_contact_phone").eq("athlete_id", athleteId).maybeSingle(),
    supabase.from("registrations").select("id,program_id,status").eq("athlete_id", athleteId),
    supabase.from("consent_acceptances").select("consent_form_id,accepted_at").eq("athlete_id", athleteId),
    supabase.rpc("athlete_attendance_summary", { p_athlete: athleteId }),
  ]);

  const progIds = uniq((regRes.data ?? []).map((r) => r.program_id));
  const formIds = uniq((consentRes.data ?? []).map((c) => c.consent_form_id));
  const [progs, forms] = await Promise.all([
    progIds.length ? supabase.from("programs").select("id,name").in("id", progIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    formIds.length ? supabase.from("consent_forms").select("id,title").in("id", formIds) : Promise.resolve({ data: [] as { id: string; title: string }[] }),
  ]);
  const pName = new Map((progs.data ?? []).map((p) => [p.id, p.name]));
  const fTitle = new Map((forms.data ?? []).map((f) => [f.id, f.title]));

  return ok({
    id: a.id,
    name: `${a.first_name} ${a.last_name}`,
    dob: a.dob,
    age: ageFromDob(a.dob),
    gender: a.gender,
    medical: medRes.data
      ? { allergies: medRes.data.allergies, conditions: medRes.data.conditions, medications: medRes.data.medications, notes: medRes.data.notes, emergencyContactName: medRes.data.emergency_contact_name, emergencyContactPhone: medRes.data.emergency_contact_phone }
      : null,
    registrations: (regRes.data ?? []).map((r) => ({ id: r.id, programName: pName.get(r.program_id) ?? "Program", status: r.status })),
    consents: (consentRes.data ?? []).map((c) => ({ title: fTitle.get(c.consent_form_id) ?? "Consent", acceptedAt: c.accepted_at })),
    attendance: ((attRes.data ?? []) as { session_date: string; program_name: string | null; status: string }[]).map((r) => ({ date: r.session_date, programName: r.program_name, status: r.status })),
  });
}

// ---------------------------------------------------------------------------
// Account (contact details)
// ---------------------------------------------------------------------------
export async function getAccount(): Promise<Result<{ profile: { id: string; fullName: string | null; email: string; phone: string | null }; family: { id: string; name: string; phone: string | null; address: string | null; contactEmail: string | null } | null }>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Not signed in");
  const [{ data: profile }, { data: fams }] = await Promise.all([
    supabase.from("profiles").select("id,full_name,email,phone").eq("id", user.id).maybeSingle(),
    supabase.from("families").select("id,name,phone,address,contact_email").limit(1),
  ]);
  const family = (fams ?? [])[0] ?? null;
  return ok({
    profile: { id: user.id, fullName: profile?.full_name ?? null, email: profile?.email ?? user.email ?? "", phone: profile?.phone ?? null },
    family: family ? { id: family.id, name: family.name, phone: family.phone, address: family.address, contactEmail: family.contact_email } : null,
  });
}

// ---------------------------------------------------------------------------
// Documents, notifications, bookings
// ---------------------------------------------------------------------------
export async function listFamilyDocuments(): Promise<Result<{ id: string; fileName: string | null; kind: string; createdAt: string; athleteName: string | null }[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("documents").select("id,file_name,kind,created_at,athlete_id").order("created_at", { ascending: false });
  if (error) return fail(error.message);
  const athleteIds = uniq((data ?? []).map((d) => d.athlete_id));
  const athletes = athleteIds.length ? await supabase.from("athletes").select("id,first_name,last_name").in("id", athleteIds) : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const aName = new Map((athletes.data ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`]));
  return ok((data ?? []).map((d) => ({ id: d.id, fileName: d.file_name, kind: d.kind, createdAt: d.created_at, athleteName: d.athlete_id ? aName.get(d.athlete_id) ?? null : null })));
}

export async function listFamilyConsents(): Promise<Result<{ athleteName: string; title: string; acceptedAt: string }[]>> {
  const supabase = await createClient();
  const { data: kids } = await supabase.from("athletes").select("id,first_name,last_name");
  const ids = (kids ?? []).map((k) => k.id);
  if (!ids.length) return ok([]);
  const aName = new Map((kids ?? []).map((k) => [k.id, `${k.first_name} ${k.last_name}`]));
  const { data, error } = await supabase.from("consent_acceptances").select("athlete_id,consent_form_id,accepted_at").in("athlete_id", ids).order("accepted_at", { ascending: false });
  if (error) return fail(error.message);
  const formIds = uniq((data ?? []).map((c) => c.consent_form_id));
  const forms = formIds.length ? await supabase.from("consent_forms").select("id,title").in("id", formIds) : { data: [] as { id: string; title: string }[] };
  const fTitle = new Map((forms.data ?? []).map((f) => [f.id, f.title]));
  return ok((data ?? []).map((c) => ({ athleteName: aName.get(c.athlete_id) ?? "Child", title: fTitle.get(c.consent_form_id) ?? "Consent", acceptedAt: c.accepted_at })));
}

export type ParentNotification = { id: string; type: string; title: string; body: string | null; link: string | null; readAt: string | null; archivedAt: string | null; createdAt: string };
export async function listNotifications(status: "active" | "unread" | "archived" = "active"): Promise<Result<ParentNotification[]>> {
  const supabase = await createClient();
  let q = supabase.from("notifications").select("id,type,title,body,link,read_at,archived_at,created_at").order("created_at", { ascending: false }).limit(100);
  if (status === "unread") q = q.is("read_at", null).is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  else q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) return fail(error.message);
  return ok((data ?? []).map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, readAt: n.read_at, archivedAt: n.archived_at, createdAt: n.created_at })));
}

export type ParentBooking = { id: string; serviceName: string; coachName: string; coachId: string; start: string; status: string; price: number | null };
export async function listBookings(): Promise<Result<ParentBooking[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("training_bookings").select("id,service_id,coach_id,slot_start,status,price_chf").order("slot_start", { ascending: false });
  if (error) return fail(error.message);
  const svcIds = uniq((data ?? []).map((b) => b.service_id));
  const coachIds = uniq((data ?? []).map((b) => b.coach_id));
  const [svc, coaches] = await Promise.all([
    svcIds.length ? supabase.from("training_services").select("id,name").in("id", svcIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    coachIds.length ? supabase.from("coaches").select("id,display_name").in("id", coachIds) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
  ]);
  const sName = new Map((svc.data ?? []).map((s) => [s.id, s.name]));
  const cName = new Map((coaches.data ?? []).map((c) => [c.id, c.display_name]));
  return ok((data ?? []).map((b) => ({ id: b.id, serviceName: sName.get(b.service_id) ?? "Session", coachName: cName.get(b.coach_id) ?? "Coach", coachId: b.coach_id, start: b.slot_start, status: b.status, price: b.price_chf ? Number(b.price_chf) : null })));
}

/** Public/active programs a family can register for (read via admin client; public info). */
export async function listAvailablePrograms(orgId: string | null): Promise<{ slug: string; name: string; priceChf: number; kind: string }[]> {
  if (!orgId) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("programs").select("slug,name,price_chf,kind,is_public,is_active").eq("org_id", orgId).eq("is_public", true).eq("is_active", true);
  return (data ?? []).filter((p) => p.slug).map((p) => ({ slug: p.slug as string, name: p.name, priceChf: Number(p.price_chf), kind: p.kind }));
}
