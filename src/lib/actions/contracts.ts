"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formsAdminDb, formsDb } from "@/lib/forms/db";
import { contractTemplateSchema, issueContractSchema, reasonSchema, signContractSchema, zodKey, type ContractTemplateInput, type IssueContractInput, type SignContractInput } from "@/lib/forms/validation";
import { unknownMergeFields, type MergeData } from "@/lib/contracts/merge";
import { insertContract, mergeDataForPurchase, mergeDataForRegistration, storeSignedPdf } from "@/lib/contracts/server";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { audit, dbFail, fail, ok, requestIpHash, requireMe, type FormsResult } from "@/lib/forms/server";

/**
 * Contract templates and contracts. Admins manage templates and issue /
 * void / reissue; a guardian of the family accepts (sign_contract RPC:
 * typed name + timestamp + IP hash + template version). Signed contracts
 * are immutable in the database.
 */
const isUuid = (v: unknown): v is string => typeof v === "string" && z.string().uuid().safeParse(v).success;

function revalidateContracts(id?: string) {
  revalidatePath("/admin/contracts", "layout");
  if (id) revalidatePath(`/admin/contracts/${id}`);
  revalidatePath("/parent/contracts", "layout");
}

export async function saveContractTemplate(id: string | null, input: ContractTemplateInput): Promise<FormsResult<{ id: string }>> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  if (id !== null && !isUuid(id)) return fail("forms.errors.invalidRequest");
  const p = contractTemplateSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const unknown = [...unknownMergeFields(v.body), ...unknownMergeFields(v.title)];
  if (unknown.length) return fail("forms.errors.unknownMergeField");
  const db = await formsDb();
  const row = { name: v.name, activity_type: v.activityType, program_id: v.programId, title: v.title, body: v.body, auto_issue: v.autoIssue };
  if (id) {
    const { data: cur } = await db.from("contract_templates").select("title,body,status").eq("id", id).eq("org_id", me.orgId).maybeSingle();
    if (!cur) return fail("forms.errors.notFound");
    // A text change on a published template needs a new publish (=> new version).
    const textChanged = cur.title !== v.title || cur.body !== v.body;
    const status = cur.status === "published" && textChanged ? "draft" : cur.status;
    const { error } = await db.from("contract_templates").update({ ...row, status }).eq("id", id).eq("org_id", me.orgId);
    if (error) return dbFail(error.message);
    await audit(me, "contracts.template.update", "contract_templates", id, { textChanged });
    revalidateContracts();
    return ok(textChanged && cur.status === "published" ? "forms.messages.templateNeedsPublish" : "forms.messages.saved", { id });
  }
  const { data, error } = await db.from("contract_templates").insert({ ...row, org_id: me.orgId, created_by: me.id, version: 1, status: "draft" }).select("id").single();
  if (error || !data) return dbFail(error?.message);
  await audit(me, "contracts.template.create", "contract_templates", data.id, { activityType: v.activityType });
  revalidateContracts();
  return ok("forms.messages.created", { id: data.id });
}

/** Publish: first publish is version 1, every later publish of changed text is the next version. */
export async function publishContractTemplate(id: string): Promise<FormsResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  if (!isUuid(id)) return fail("forms.errors.invalidRequest");
  const db = await formsDb();
  const { data: cur } = await db.from("contract_templates").select("version,published_at,status").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!cur) return fail("forms.errors.notFound");
  if (cur.status === "published") return ok("forms.messages.published");
  const version = cur.published_at ? cur.version + 1 : cur.version;
  const { error } = await db.from("contract_templates").update({ status: "published", version, published_at: new Date().toISOString() }).eq("id", id).eq("org_id", me.orgId);
  if (error) return dbFail(error.message);
  await audit(me, "contracts.template.publish", "contract_templates", id, { version });
  revalidateContracts();
  return ok("forms.messages.published");
}

export async function archiveContractTemplate(id: string): Promise<FormsResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  if (!isUuid(id)) return fail("forms.errors.invalidRequest");
  const db = await formsDb();
  const { data, error } = await db.from("contract_templates").update({ status: "archived" }).eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("forms.errors.notFound");
  await audit(me, "contracts.template.archive", "contract_templates", id);
  revalidateContracts();
  return ok("forms.messages.archived");
}

/** Admin issues a contract for a registration (merge data from it) or an athlete (club + family data only). */
export async function issueContract(input: IssueContractInput): Promise<FormsResult<{ id: string }>> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  const p = issueContractSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const v = p.data;
  const db = await formsDb();
  const { data: tpl } = await db.from("contract_templates").select("*").eq("id", v.templateId).eq("org_id", me.orgId).maybeSingle();
  if (!tpl || tpl.status !== "published") return fail("forms.errors.templateNotPublished");
  let data: MergeData;
  let familyId: string;
  let athleteId: string | null;
  let programId: string | null = null;
  if (v.registrationId) {
    const m = await mergeDataForRegistration(db, { orgId: me.orgId }, v.registrationId);
    if (!m) return fail("forms.errors.notFound");
    ({ data, familyId, athleteId, programId } = m);
  } else if (v.athleteId) {
    const { data: ath } = await db.from("athletes").select("id,first_name,last_name,family_id").eq("id", v.athleteId).eq("org_id", me.orgId).maybeSingle();
    if (!ath) return fail("forms.errors.notFound");
    const org = await getOrgEmailContext(me.orgId);
    const { data: fam } = await db.from("families").select("name,address,contact_name,contact_email").eq("id", ath.family_id).maybeSingle();
    data = {
      "athlete.first_name": ath.first_name, "athlete.last_name": ath.last_name, "athlete.full_name": `${ath.first_name} ${ath.last_name}`,
      "guardian.full_name": fam?.contact_name ?? "", "guardian.email": fam?.contact_email ?? "", "family.name": fam?.name ?? "",
      "family.address": fam?.address ?? "", "club.name": org.clubName ?? "", today: org.f.date(new Date().toISOString().slice(0, 10)),
    };
    familyId = ath.family_id;
    athleteId = ath.id;
  } else {
    return fail("forms.errors.targetRequired");
  }
  const r = await insertContract({ db, orgId: me.orgId, template: tpl, data, familyId, athleteId, registrationId: v.registrationId, programId, source: "admin", issuedBy: me.id });
  if ("error" in r) return dbFail(r.error);
  await audit(me, "contracts.issue", "contracts", r.id, { source: "admin", templateId: tpl.id, version: tpl.version });
  revalidateContracts(r.id);
  if (v.registrationId) revalidatePath(`/admin/registrations/${v.registrationId}`);
  return ok("forms.messages.contractIssued", { id: r.id });
}

/** Guardian accepts: typed name + timestamp + IP hash; then the signed PDF is stored privately. */
export async function signContract(input: SignContractInput): Promise<FormsResult> {
  const me = await requireMe(["parent"]);
  if (!me) return fail("forms.errors.notPermitted");
  const p = signContractSchema.safeParse(input);
  if (!p.success) return fail(zodKey(p.error));
  const db = await formsDb();
  const { error } = await db.rpc("sign_contract", { p_contract: p.data.contractId, p_signer_name: p.data.signerName, p_ip_hash: await requestIpHash(me.orgId) });
  if (error) return dbFail(error.message);
  const { data: c } = await formsAdminDb().from("contracts").select("*").eq("id", p.data.contractId).eq("org_id", me.orgId).maybeSingle();
  if (c) await storeSignedPdf(c);
  await audit(me, "contracts.sign", "contracts", p.data.contractId);
  revalidateContracts(p.data.contractId);
  return ok("forms.messages.contractSigned");
}

export async function voidContract(id: string, reason: string): Promise<FormsResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  if (!isUuid(id)) return fail("forms.errors.invalidRequest");
  const p = reasonSchema.safeParse({ reason });
  if (!p.success) return fail(zodKey(p.error));
  const db = await formsDb();
  const { data, error } = await db.from("contracts").update({ status: "void", void_reason: p.data.reason }).eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(error.message);
  if (!data?.length) return fail("forms.errors.notFound");
  await audit(me, "contracts.void", "contracts", id);
  revalidateContracts(id);
  return ok("forms.messages.contractVoided");
}

/** Void and issue a fresh contract from the template's current published version. */
export async function reissueContract(id: string, reason: string): Promise<FormsResult<{ id: string }>> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("forms.errors.notPermitted");
  if (!isUuid(id)) return fail("forms.errors.invalidRequest");
  const p = reasonSchema.safeParse({ reason });
  if (!p.success) return fail(zodKey(p.error));
  const db = await formsDb();
  const { data: old } = await db.from("contracts").select("*").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!old) return fail("forms.errors.notFound");
  const { data: tpl } = await db.from("contract_templates").select("*").eq("id", old.template_id).eq("org_id", me.orgId).maybeSingle();
  if (!tpl || tpl.status !== "published") return fail("forms.errors.templateNotPublished");
  // Fresh merge data where the source still exists; else the original values.
  let data = (old.merge_data ?? {}) as MergeData;
  if (old.registration_id) data = (await mergeDataForRegistration(db, { orgId: me.orgId }, old.registration_id))?.data ?? data;
  else if (old.purchase_id) data = (await mergeDataForPurchase(db, { orgId: me.orgId }, old.purchase_id))?.data ?? data;
  if (old.status !== "void") {
    const { error } = await db.from("contracts").update({ status: "void", void_reason: p.data.reason }).eq("id", id).eq("org_id", me.orgId);
    if (error) return dbFail(error.message);
  }
  const r = await insertContract({
    db, orgId: me.orgId, template: tpl, data, familyId: old.family_id, athleteId: old.athlete_id, registrationId: old.registration_id,
    purchaseId: old.purchase_id, programId: old.program_id, source: old.source as "registration" | "purchase" | "admin", issuedBy: me.id, reissuedFrom: id,
  });
  if ("error" in r) return dbFail(r.error);
  await audit(me, "contracts.reissue", "contracts", r.id, { from: id, version: tpl.version });
  revalidateContracts(id);
  return ok("forms.messages.contractReissued", { id: r.id });
}
