"use server";

import { revalidatePath } from "next/cache";
import { caDb } from "@/lib/club-admin/db";
import { audit, dbErrorKey, done, fail, removePrivateFile, requireMe, signedFileUrl, uploadPrivateFile, type CaResult } from "@/lib/club-admin/server";
import { certificateSchema, firstIssueKey, overrideSchema, uuid, verifySchema } from "@/lib/club-admin/validation";

/**
 * Staff compliance: certificates and checks with expiry (admin for every
 * coach; a coach for their own, pending until an admin verifies), document
 * upload to the private bucket, verification, assignment override.
 */
function revalidateCompliance() {
  revalidatePath("/admin/staff-compliance");
  revalidatePath("/coach/compliance");
}

async function myCoachId(profileId: string, orgId: string): Promise<string | null> {
  const { data } = await (await caDb()).from("coaches").select("id").eq("profile_id", profileId).eq("org_id", orgId).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : null;
};

/** Create or update a certificate (+ optional document). FormData: id?, coachId, kind, title, reference, issuedOn, validUntil, notes, file. */
export async function saveCertificate(fd: FormData): Promise<CaResult<{ id: string }>> {
  const me = await requireMe(["admin", "coach"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  const isAdmin = me.roles.includes("admin");
  const id = str(fd, "id") || null;
  if (id && !uuid.safeParse(id).success) return fail("clubadmin.errors.invalid");
  const p = certificateSchema.safeParse({
    coachId: str(fd, "coachId"), kind: str(fd, "kind"), title: str(fd, "title"), reference: str(fd, "reference"),
    issuedOn: str(fd, "issuedOn"), validUntil: str(fd, "validUntil"), notes: str(fd, "notes"),
  });
  if (!p.success) return fail(firstIssueKey(p.error));
  const v = p.data;
  if (!isAdmin && v.coachId !== (await myCoachId(me.id, me.orgId))) return fail("clubadmin.errors.forbidden");

  const db = await caDb();
  const { data: coach } = await db.from("coaches").select("id").eq("id", v.coachId).eq("org_id", me.orgId).maybeSingle();
  if (!coach) return fail("clubadmin.errors.notFound");
  let previousFile: string | null = null;
  if (id) {
    const { data: cur } = await db.from("staff_certificates").select("id,coach_id,file_path,status").eq("id", id).eq("org_id", me.orgId).maybeSingle();
    if (!cur || cur.coach_id !== v.coachId) return fail("clubadmin.errors.notFound");
    if (!isAdmin && cur.status !== "pending") return fail("clubadmin.errors.codes.CERT_LOCKED");
    previousFile = cur.file_path;
  }

  const file = fd.get("file");
  let upload: { path: string; name: string } | null = null;
  if (file instanceof File && file.size > 0) {
    const u = await uploadPrivateFile(me.orgId, "certificates", v.coachId, file);
    if (!u.ok) return fail(u.key);
    upload = u;
  }
  const row = {
    kind: v.kind, title: v.title, reference: v.reference, issued_on: v.issuedOn, valid_until: v.validUntil, notes: v.notes,
    ...(upload ? { file_path: upload.path, file_name: upload.name } : {}),
    // An edited certificate needs a new verification (admins keep their own).
    ...(id && !isAdmin ? { status: "pending" as const } : {}),
  };
  const res = id
    ? await db.from("staff_certificates").update(row).eq("id", id).eq("org_id", me.orgId).select("id").maybeSingle()
    : await db.from("staff_certificates").insert({ ...row, org_id: me.orgId, coach_id: v.coachId, status: "pending", created_by: me.id }).select("id").single();
  if (res.error || !res.data) {
    if (upload) await removePrivateFile(upload.path);
    return fail(res.error ? dbErrorKey(res.error.message) : "clubadmin.errors.notFound");
  }
  if (upload && previousFile) await removePrivateFile(previousFile);
  await audit(me, id ? "certificate.update" : "certificate.create", "staff_certificates", res.data.id, { kind: v.kind, file: !!upload });
  revalidateCompliance();
  return done("clubadmin.saved", { id: res.data.id });
}

export async function verifyCertificate(id: string, decision: "verified" | "rejected", reason?: string | null): Promise<CaResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  const p = verifySchema.safeParse({ id, decision, reason });
  if (!p.success) return fail(firstIssueKey(p.error));
  const verified = p.data.decision === "verified";
  const { data, error } = await (await caDb()).from("staff_certificates").update({
    status: p.data.decision, verified_by: verified ? me.id : null, verified_at: verified ? new Date().toISOString() : null,
    rejection_reason: verified ? null : p.data.reason,
  }).eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return fail(dbErrorKey(error.message));
  if (!data?.length) return fail("clubadmin.errors.notFound");
  await audit(me, `certificate.${p.data.decision}`, "staff_certificates", id);
  revalidateCompliance();
  return done(verified ? "clubadmin.compliance.verifiedDone" : "clubadmin.compliance.rejectedDone");
}

export async function deleteCertificate(id: string): Promise<CaResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  if (!uuid.safeParse(id).success) return fail("clubadmin.errors.invalid");
  const { data, error } = await (await caDb()).from("staff_certificates").delete().eq("id", id).eq("org_id", me.orgId).select("id,file_path");
  if (error) return fail(dbErrorKey(error.message));
  if (!data?.length) return fail("clubadmin.errors.notFound");
  await removePrivateFile(data[0].file_path);
  await audit(me, "certificate.delete", "staff_certificates", id);
  revalidateCompliance();
  return done("clubadmin.deleted");
}

/** Signed URL of a certificate document (admin, or the coach it belongs to — via RLS). */
export async function certificateFileUrl(id: string): Promise<CaResult<{ url: string }>> {
  const me = await requireMe(["admin", "coach"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  if (!uuid.safeParse(id).success) return fail("clubadmin.errors.invalid");
  const { data: c } = await (await caDb()).from("staff_certificates").select("id,coach_id,file_path").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!c) return fail("clubadmin.errors.notFound");
  const url = await signedFileUrl(me, "certificates", c.coach_id, c.file_path, "staff_certificates", id);
  return url ? { ok: true, data: { url } } : fail("clubadmin.errors.noFile");
}

/** Assign a coach to a youth team although mandatory checks are missing (reason recorded). */
export async function assignCoachWithOverride(input: { teamId: string; coachId: string; role?: string; reason: string }): Promise<CaResult> {
  const me = await requireMe(["admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  const p = overrideSchema.safeParse(input);
  if (!p.success) return fail(firstIssueKey(p.error));
  const { error } = await (await caDb()).rpc("assign_coach_with_override", {
    p_team: p.data.teamId, p_coach: p.data.coachId, p_role: p.data.role, p_reason: p.data.reason,
  });
  if (error) return fail(dbErrorKey(error.message));
  revalidateCompliance();
  revalidatePath("/admin/teams");
  return done("clubadmin.compliance.overrideDone");
}
