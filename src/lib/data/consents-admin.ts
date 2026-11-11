import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";

export type ConsentForm = { id: string; key: string; title: string; version: number; isRequired: boolean; isActive: boolean; bodyLength: number; acceptedCount: number };

export async function listConsentForms(): Promise<ConsentForm[]> {
  const me = await getSessionUser();
  if (!me?.orgId) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("consent_forms").select("id,key,title,version,is_required,is_active,body").eq("org_id", me.orgId).order("key").order("version", { ascending: false });
  const forms = data ?? [];
  const counts = (await admin.from("consent_acceptances").select("consent_form_id").eq("org_id", me.orgId).eq("status", "accepted")).data ?? [];
  const byForm = new Map<string, number>();
  for (const c of counts) byForm.set(c.consent_form_id, (byForm.get(c.consent_form_id) ?? 0) + 1);
  return forms.map((f) => ({ id: f.id, key: f.key, title: f.title, version: f.version, isRequired: f.is_required, isActive: f.is_active, bodyLength: (f.body ?? "").length, acceptedCount: byForm.get(f.id) ?? 0 }));
}

export type Acceptance = { athleteName: string; parentName: string; version: number; acceptedAt: string; ip: string | null; hasSnapshot: boolean };
export type AuditResult = { form: { id: string; key: string; title: string; version: number } | null; accepted: Acceptance[]; notAccepted: string[] };

export async function consentAudit(formId: string): Promise<AuditResult> {
  const me = await getSessionUser();
  if (!me?.orgId) return { form: null, accepted: [], notAccepted: [] };
  const admin = createAdminClient();
  const { data: form } = await admin.from("consent_forms").select("id,key,title,version").eq("id", formId).eq("org_id", me.orgId).maybeSingle();
  if (!form) return { form: null, accepted: [], notAccepted: [] };

  const { data: accs } = await admin.from("consent_acceptances").select("athlete_id,accepted_by,accepted_version,accepted_at,ip_address,accepted_text").eq("org_id", me.orgId).eq("consent_form_id", formId).eq("status", "accepted").order("accepted_at", { ascending: false });
  const rows = accs ?? [];
  const aIds = Array.from(new Set(rows.map((r) => r.athlete_id).filter((x): x is string => !!x)));
  const pIds = Array.from(new Set(rows.map((r) => r.accepted_by).filter((x): x is string => !!x)));
  const allAthletes = (await admin.from("athletes").select("id,first_name,last_name").eq("org_id", me.orgId)).data ?? [];
  const aName = new Map(allAthletes.map((a) => [a.id, `${a.first_name} ${a.last_name}`]));
  const profs = pIds.length ? (await admin.from("profiles").select("id,full_name,email").in("id", pIds)).data ?? [] : [];
  const pName = new Map(profs.map((p) => [p.id, p.full_name ?? p.email]));

  const accepted: Acceptance[] = rows.map((r) => ({ athleteName: r.athlete_id ? aName.get(r.athlete_id) ?? "—" : "—", parentName: r.accepted_by ? pName.get(r.accepted_by) ?? "—" : "Public registration", version: r.accepted_version, acceptedAt: r.accepted_at, ip: r.ip_address, hasSnapshot: Boolean(r.accepted_text) }));
  const acceptedAthletes = new Set(aIds);
  const notAccepted = allAthletes.filter((a) => !acceptedAthletes.has(a.id)).map((a) => `${a.first_name} ${a.last_name}`);
  return { form, accepted, notAccepted };
}
