import "server-only";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { formsDb, CONTRACTS_BUCKET, SIGNED_URL_TTL, type ContractRow, type ContractTemplateRow } from "@/lib/forms/db";
import type { ActivityType } from "./merge";

/** Server-side reads for contracts (RLS-scoped: admins of the org, guardians of the family). */
type Me = SessionUser & { orgId: string };
type Res<T> = { data: T; error: null } | { data: null; error: string };

async function me(roles: ("admin" | "parent")[]): Promise<Me | null> {
  const u = await getSessionUser();
  if (!u?.orgId || !roles.some((r) => u.roles.includes(r))) return null;
  return u as Me;
}

export type TemplateItem = {
  id: string; name: string; activityType: ActivityType; programId: string | null; title: string; body: string; version: number;
  status: string; autoIssue: boolean; publishedAt: string | null; updatedAt: string; contracts: number;
};
const toTemplate = (t: ContractTemplateRow, contracts = 0): TemplateItem => ({
  id: t.id, name: t.name, activityType: t.activity_type as ActivityType, programId: t.program_id, title: t.title, body: t.body,
  version: t.version, status: t.status, autoIssue: t.auto_issue, publishedAt: t.published_at, updatedAt: t.updated_at, contracts,
});

export async function listTemplates(): Promise<Res<TemplateItem[]>> {
  const u = await me(["admin"]);
  if (!u) return { data: null, error: "forbidden" };
  const db = await formsDb();
  const [{ data, error }, { data: cs }] = await Promise.all([
    db.from("contract_templates").select("*").eq("org_id", u.orgId).order("updated_at", { ascending: false }),
    db.from("contracts").select("template_id").eq("org_id", u.orgId),
  ]);
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []).map((t) => toTemplate(t, (cs ?? []).filter((c) => c.template_id === t.id).length)), error: null };
}

export async function getTemplate(id: string): Promise<Res<TemplateItem | null>> {
  const u = await me(["admin"]);
  if (!u) return { data: null, error: "forbidden" };
  const db = await formsDb();
  const { data, error } = await db.from("contract_templates").select("*").eq("id", id).eq("org_id", u.orgId).maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: data ? toTemplate(data) : null, error: null };
}

export type ContractItem = {
  id: string; title: string; status: string; source: string; templateId: string; templateVersion: number; familyId: string; familyName: string;
  athleteId: string | null; athleteName: string | null; registrationId: string | null; programId: string | null; issuedAt: string;
  signedAt: string | null; signerName: string | null; voidedAt: string | null; voidReason: string | null; reissuedFrom: string | null;
};

async function decorate(rows: ContractRow[]): Promise<ContractItem[]> {
  const db = await formsDb();
  const famIds = Array.from(new Set(rows.map((r) => r.family_id)));
  const athIds = Array.from(new Set(rows.map((r) => r.athlete_id).filter((x): x is string => !!x)));
  const [fams, aths] = await Promise.all([
    famIds.length ? db.from("families").select("id,name").in("id", famIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    athIds.length ? db.from("athletes").select("id,first_name,last_name").in("id", athIds) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
  ]);
  const fMap = new Map((fams.data ?? []).map((f) => [f.id, f.name]));
  const aMap = new Map((aths.data ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`]));
  return rows.map((r) => ({
    id: r.id, title: r.title, status: r.status, source: r.source, templateId: r.template_id, templateVersion: r.template_version,
    familyId: r.family_id, familyName: fMap.get(r.family_id) ?? "", athleteId: r.athlete_id, athleteName: r.athlete_id ? aMap.get(r.athlete_id) ?? null : null,
    registrationId: r.registration_id, programId: r.program_id, issuedAt: r.issued_at, signedAt: r.signed_at, signerName: r.signer_name,
    voidedAt: r.voided_at, voidReason: r.void_reason, reissuedFrom: r.reissued_from,
  }));
}

export type ContractFilters = { status?: string; templateId?: string; programId?: string; registrationId?: string; q?: string };

export async function listContracts(f: ContractFilters = {}): Promise<Res<ContractItem[]>> {
  const u = await me(["admin", "parent"]);
  if (!u) return { data: null, error: "forbidden" };
  const db = await formsDb();
  let q = db.from("contracts").select("*").eq("org_id", u.orgId).order("issued_at", { ascending: false }).limit(500);
  if (f.status && ["issued", "signed", "void"].includes(f.status)) q = q.eq("status", f.status);
  if (f.templateId) q = q.eq("template_id", f.templateId);
  if (f.programId) q = q.eq("program_id", f.programId);
  if (f.registrationId) q = q.eq("registration_id", f.registrationId);
  const { data, error } = await q;
  if (error) return { data: null, error: error.message };
  let items = await decorate(data ?? []);
  const needle = (f.q ?? "").trim().toLowerCase();
  if (needle) items = items.filter((c) => [c.title, c.familyName, c.athleteName ?? ""].some((s) => s.toLowerCase().includes(needle)));
  return { data: items, error: null };
}

export type ContractDetail = ContractItem & { body: string; pdfUrl: string | null };

export async function getContract(id: string): Promise<Res<ContractDetail | null>> {
  const u = await me(["admin", "parent"]);
  if (!u) return { data: null, error: "forbidden" };
  const db = await formsDb();
  const { data, error } = await db.from("contracts").select("*").eq("id", id).eq("org_id", u.orgId).maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: null };
  const [item] = await decorate([data]);
  let pdfUrl: string | null = null;
  if (data.pdf_path) {
    // Signed with the viewer's own session: Storage RLS decides.
    const { data: s } = await db.storage.from(CONTRACTS_BUCKET).createSignedUrl(data.pdf_path, SIGNED_URL_TTL);
    pdfUrl = s?.signedUrl ?? null;
  }
  return { data: { ...item, body: data.body, pdfUrl }, error: null };
}
