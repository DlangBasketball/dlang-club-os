import "server-only";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { getTranslations } from "@/lib/i18n/server";
import { logError } from "@/lib/log";
import type { Json } from "@/types/database";
import { formsAdminDb, CONTRACTS_BUCKET, type ContractRow, type ContractTemplateRow, type FormsClient } from "@/lib/forms/db";
import { buildDocumentPdf } from "@/lib/forms/pdf";
import { contractPdfPath } from "@/lib/forms/paths";
import { activityForProgramKind, pickTemplate, renderMerge, type ActivityType, type MergeData } from "./merge";

/**
 * Contract issuing (server only). Merge data is always resolved here from the
 * database for ONE org (never from the client). Issuing from public
 * registration / purchase flows uses the service role and filters by the org
 * that owns the registration; admin issuing passes the admin's RLS client.
 */

type Ctx = { orgId: string };

async function guardianOf(db: FormsClient, familyId: string): Promise<{ name: string; email: string }> {
  const { data: fam } = await db.from("families").select("name,contact_name,contact_email,primary_contact_id").eq("id", familyId).maybeSingle();
  let name = fam?.contact_name ?? "";
  let email = fam?.contact_email ?? "";
  if ((!name || !email) && fam?.primary_contact_id) {
    const { data: p } = await db.from("profiles").select("full_name,email").eq("id", fam.primary_contact_id).maybeSingle();
    name = name || p?.full_name || "";
    email = email || p?.email || "";
  }
  return { name, email };
}

/** Merge data for a registration (programme or camp). */
export async function mergeDataForRegistration(db: FormsClient, ctx: Ctx, registrationId: string): Promise<{ data: MergeData; familyId: string; athleteId: string; programId: string; kind: string } | null> {
  const { data: reg } = await db.from("registrations").select("id,org_id,athlete_id,program_id,camp_edition_id,price_amount,price_currency").eq("id", registrationId).eq("org_id", ctx.orgId).maybeSingle();
  if (!reg) return null;
  const [{ data: ath }, { data: prog }] = await Promise.all([
    db.from("athletes").select("id,first_name,last_name,dob,family_id").eq("id", reg.athlete_id).eq("org_id", ctx.orgId).maybeSingle(),
    db.from("programs").select("id,name,kind,location,starts_on,ends_on,price_chf").eq("id", reg.program_id).eq("org_id", ctx.orgId).maybeSingle(),
  ]);
  if (!ath || !prog) return null;
  let start = prog.starts_on as string | null;
  let end = prog.ends_on as string | null;
  if (reg.camp_edition_id) {
    const { data: ed } = await db.from("camp_editions").select("starts_on,ends_on").eq("id", reg.camp_edition_id).eq("org_id", ctx.orgId).maybeSingle();
    if (ed) {
      start = ed.starts_on;
      end = ed.ends_on;
    }
  }
  const org = await getOrgEmailContext(ctx.orgId);
  const t = await getTranslations(ctx.orgId);
  const [guardian, fam] = await Promise.all([
    guardianOf(db, ath.family_id),
    db.from("families").select("name,address").eq("id", ath.family_id).maybeSingle(),
  ]);
  const amount = reg.price_amount !== null && reg.price_amount !== undefined ? Number(reg.price_amount) : Number(prog.price_chf ?? 0);
  const currency = (reg.price_currency as string | null) ?? undefined;
  const data: MergeData = {
    "athlete.first_name": ath.first_name,
    "athlete.last_name": ath.last_name,
    "athlete.full_name": `${ath.first_name} ${ath.last_name}`,
    "athlete.dob": ath.dob ? org.f.date(ath.dob) : "",
    "guardian.full_name": guardian.name,
    "guardian.email": guardian.email,
    "family.name": fam.data?.name ?? "",
    "family.address": fam.data?.address ?? "",
    "programme.name": prog.name,
    "programme.kind": t.dynamic(`programKind.${prog.kind}`, undefined, String(prog.kind)),
    "programme.location": prog.location ?? "",
    price: org.f.money(amount, currency),
    currency: currency ?? org.brand.currency ?? "",
    dates: start && end ? org.f.dateRange(start, end) : start ? org.f.date(start) : "",
    start_date: start ? org.f.date(start) : "",
    end_date: end ? org.f.date(end) : "",
    "club.name": org.clubName ?? "",
    today: org.f.date(new Date().toISOString().slice(0, 10)),
  };
  return { data, familyId: ath.family_id, athleteId: ath.id, programId: prog.id, kind: String(prog.kind) };
}

/** Merge data for a training package purchase. */
export async function mergeDataForPurchase(db: FormsClient, ctx: Ctx, purchaseId: string): Promise<{ data: MergeData; familyId: string; athleteId: string } | null> {
  const { data: pur } = await db.from("training_package_purchases").select("*").eq("id", purchaseId).eq("org_id", ctx.orgId).maybeSingle();
  if (!pur) return null;
  const [{ data: ath }, { data: svc }] = await Promise.all([
    db.from("athletes").select("id,first_name,last_name,dob,family_id").eq("id", pur.athlete_id).eq("org_id", ctx.orgId).maybeSingle(),
    db.from("training_services").select("name").eq("id", pur.service_id).eq("org_id", ctx.orgId).maybeSingle(),
  ]);
  if (!ath) return null;
  const org = await getOrgEmailContext(ctx.orgId);
  const [guardian, fam] = await Promise.all([guardianOf(db, ath.family_id), db.from("families").select("name,address").eq("id", ath.family_id).maybeSingle()]);
  const start = pur.created_at.slice(0, 10);
  const end = pur.expires_at ? pur.expires_at.slice(0, 10) : null;
  return {
    data: {
      "athlete.first_name": ath.first_name,
      "athlete.last_name": ath.last_name,
      "athlete.full_name": `${ath.first_name} ${ath.last_name}`,
      "athlete.dob": ath.dob ? org.f.date(ath.dob) : "",
      "guardian.full_name": guardian.name,
      "guardian.email": guardian.email,
      "family.name": fam.data?.name ?? "",
      "family.address": fam.data?.address ?? "",
      "programme.name": svc?.name ?? "",
      "programme.kind": "",
      "programme.location": "",
      price: org.f.money(Number(pur.amount), pur.currency),
      currency: pur.currency,
      dates: end ? org.f.dateRange(start, end) : org.f.date(start),
      start_date: org.f.date(start),
      end_date: end ? org.f.date(end) : "",
      "club.name": org.clubName ?? "",
      today: org.f.date(new Date().toISOString().slice(0, 10)),
    },
    familyId: ath.family_id,
    athleteId: ath.id,
  };
}

type IssueArgs = {
  db: FormsClient;
  orgId: string;
  template: ContractTemplateRow;
  data: MergeData;
  familyId: string;
  athleteId: string | null;
  registrationId?: string | null;
  purchaseId?: string | null;
  programId?: string | null;
  source: "registration" | "purchase" | "admin";
  issuedBy: string | null;
  reissuedFrom?: string | null;
};

export async function insertContract(a: IssueArgs): Promise<{ id: string } | { error: string }> {
  const body = renderMerge(a.template.body, a.data, "text").output;
  const title = renderMerge(a.template.title, a.data, "text").output || a.template.name;
  const { data, error } = await a.db.from("contracts").insert({
    org_id: a.orgId, template_id: a.template.id, template_version: a.template.version, family_id: a.familyId, athlete_id: a.athleteId,
    registration_id: a.registrationId ?? null, purchase_id: a.purchaseId ?? null, program_id: a.programId ?? null, source: a.source,
    title, body, merge_data: a.data as unknown as Json, issued_by: a.issuedBy, reissued_from: a.reissuedFrom ?? null,
  }).select("id").single();
  if (error || !data) return { error: error?.message ?? "insert failed" };
  return { id: data.id };
}

async function templatesFor(db: FormsClient, orgId: string): Promise<ContractTemplateRow[]> {
  const { data } = await db.from("contract_templates").select("*").eq("org_id", orgId).eq("status", "published");
  return data ?? [];
}

const templatePick = (rows: ContractTemplateRow[], activity: ActivityType, programId: string | null) =>
  pickTemplate(rows.map((r) => ({ ...r, activityType: r.activity_type, programId: r.program_id, autoIssue: r.auto_issue, updatedAt: r.updated_at })), activity, programId);

async function auditSystem(orgId: string, action: string, id: string, data: Record<string, unknown>) {
  await formsAdminDb().from("audit_logs").insert({ org_id: orgId, actor_id: null, action, target_table: "contracts", target_id: id, new_data: data as Json });
}

/**
 * After a registration (public, camp, parent app): issue the matching
 * auto-issue contract for each new registration. Never throws; a failure is
 * logged and never undoes the registration.
 */
export async function issueContractsForRegistrations(orgId: string, registrationIds: string[], issuedBy: string | null = null): Promise<number> {
  if (!registrationIds.length) return 0;
  let n = 0;
  try {
    const db = formsAdminDb();
    const templates = await templatesFor(db, orgId);
    if (!templates.length) return 0;
    for (const regId of registrationIds) {
      const m = await mergeDataForRegistration(db, { orgId }, regId);
      if (!m) continue;
      const tpl = templatePick(templates, activityForProgramKind(m.kind), m.programId);
      if (!tpl) continue;
      const { data: existing } = await db.from("contracts").select("id").eq("org_id", orgId).eq("registration_id", regId).neq("status", "void").limit(1);
      if (existing?.length) continue;
      const r = await insertContract({
        db, orgId, template: tpl, data: m.data, familyId: m.familyId, athleteId: m.athleteId, registrationId: regId, programId: m.programId,
        source: "registration", issuedBy,
      });
      if ("error" in r) {
        logError("contracts.issueRegistration", r.error);
        continue;
      }
      await auditSystem(orgId, "contracts.issue", r.id, { source: "registration", templateId: tpl.id, version: tpl.version });
      n++;
    }
  } catch (e) {
    logError("contracts.issueRegistration", e);
  }
  return n;
}

/** After a training package purchase. Never throws. */
export async function issueContractForPurchase(orgId: string, purchaseId: string, issuedBy: string | null = null): Promise<boolean> {
  try {
    const db = formsAdminDb();
    const templates = await templatesFor(db, orgId);
    const tpl = templatePick(templates, "training_package", null);
    if (!tpl) return false;
    const m = await mergeDataForPurchase(db, { orgId }, purchaseId);
    if (!m) return false;
    const r = await insertContract({ db, orgId, template: tpl, data: m.data, familyId: m.familyId, athleteId: m.athleteId, purchaseId, source: "purchase", issuedBy });
    if ("error" in r) {
      logError("contracts.issuePurchase", r.error);
      return false;
    }
    await auditSystem(orgId, "contracts.issue", r.id, { source: "purchase", templateId: tpl.id, version: tpl.version });
    return true;
  } catch (e) {
    logError("contracts.issuePurchase", e);
    return false;
  }
}

/** Build the signed contract PDF and store it privately (service role, once). */
export async function storeSignedPdf(contract: ContractRow): Promise<string | null> {
  try {
    const t = await getTranslations(contract.org_id);
    const org = await getOrgEmailContext(contract.org_id);
    const bytes = await buildDocumentPdf({
      title: contract.title,
      subtitle: org.clubName ?? undefined,
      meta: [
        { label: t("forms.contracts.pdf.version"), value: String(contract.template_version) },
        { label: t("forms.contracts.pdf.issued"), value: org.f.dateTime(contract.issued_at) },
        { label: t("forms.contracts.pdf.reference"), value: contract.id },
      ],
      blocks: contract.body.split(/\n{2,}/).map((p) => ({ kind: "paragraph" as const, text: p })),
      signature: {
        heading: t("forms.contracts.pdf.acceptance"),
        lines: [
          t("forms.contracts.pdf.signedBy", { name: contract.signer_name ?? "" }),
          t("forms.contracts.pdf.signedAt", { date: contract.signed_at ? org.f.dateTime(contract.signed_at) : "" }),
          t("forms.contracts.pdf.ipHash", { hash: contract.ip_hash ? contract.ip_hash.slice(0, 16) : "-" }),
        ],
      },
      footer: org.clubName ?? "",
    });
    const path = contractPdfPath(contract.org_id, contract.family_id, contract.id);
    const admin = formsAdminDb();
    const { error: upErr } = await admin.storage.from(CONTRACTS_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false });
    if (upErr && !/exists/i.test(upErr.message)) {
      logError("contracts.pdfUpload", upErr);
      return null;
    }
    const { error } = await admin.from("contracts").update({ pdf_path: path }).eq("id", contract.id).eq("org_id", contract.org_id).is("pdf_path", null);
    if (error) logError("contracts.pdfPath", error);
    return path;
  } catch (e) {
    logError("contracts.pdf", e);
    return null;
  }
}
