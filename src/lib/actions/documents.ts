"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";
import { requireRole, writeAudit, type ActionResult as PeopleResult } from "@/lib/people/server";
import {
  documentMetaSchema,
  scopeColumns,
  firstIssueKey,
  MAX_DOCUMENT_BYTES,
  type DocumentMetaInput,
  type DocumentScope,
} from "@/lib/people/validation";
import { logError } from "@/lib/log";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const BUCKET = "documents";

async function admin() {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return null;
  return me as typeof me & { orgId: string };
}

export async function uploadDocument(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const me = await admin();
  if (!me) return { ok: false, error: "Admins only" };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a file to upload" };
  if (file.size > 25 * 1024 * 1024) return { ok: false, error: "File too large (max 25 MB)" };

  const scope = String(formData.get("scope") ?? "global");
  const targetId = (formData.get("targetId") as string) || null;
  const kind = String(formData.get("kind") ?? "other");
  const title = (formData.get("title") as string)?.trim() || null;
  const rawExpiry = String(formData.get("expiresAt") ?? "").trim();
  const expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(rawExpiry) ? rawExpiry : null;

  const sb = createAdminClient();
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${me.orgId}/${crypto.randomUUID()}-${safeName}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const up = await sb.storage.from(BUCKET).upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: false });
  if (up.error) return { ok: false, error: `Upload failed: ${up.error.message}` };

  const row: Record<string, unknown> = { org_id: me.orgId, kind, storage_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size, title, expires_at: expiresAt, uploaded_by: me.id, athlete_id: null, family_id: null, program_id: null };
  if (scope === "athlete") row.athlete_id = targetId;
  else if (scope === "family") row.family_id = targetId;
  else if (scope === "program") row.program_id = targetId;
  if (scope !== "global" && !targetId) return { ok: false, error: "Select a target for this scope" };

  const { data, error } = await sb.from("documents").insert(row).select("id").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/documents");
  return { ok: true, data: { id: (data as { id: string }).id } };
}

export async function deleteDocument(id: string): Promise<ActionResult> {
  const me = await admin();
  if (!me) return { ok: false, error: "Admins only" };
  const sb = createAdminClient();
  const { data } = await sb.from("documents").select("storage_path").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (data?.storage_path) await sb.storage.from(BUCKET).remove([data.storage_path]);
  const { error } = await sb.from("documents").delete().eq("id", id).eq("org_id", me.orgId);
  if (error) return { ok: false, error: error.message };
  if (data) await writeAudit(me, "document.delete", "documents", id);
  revalidatePath("/admin/documents");
  return { ok: true };
}

/** Resolve a document target inside the caller's org (never trust the client id). */
async function targetInOrg(scope: DocumentScope, targetId: string | null, orgId: string): Promise<boolean> {
  if (scope === "global") return true;
  if (!targetId) return false;
  const sb = createAdminClient();
  const table = scope === "athlete" ? "athletes" : scope === "family" ? "families" : "programs";
  const { data } = await sb.from(table).select("id").eq("id", targetId).eq("org_id", orgId).maybeSingle();
  return !!data;
}

/** Admin: edit title, kind, expiry and visibility (scope + target) of a document. */
export async function updateDocumentMeta(id: string, input: DocumentMetaInput): Promise<PeopleResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const p = documentMetaSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(firstIssueKey(p.error)) };
  if (!(await targetInOrg(p.data.scope, p.data.targetId, me.orgId))) return { ok: false, error: t("editPeople.errors.notFound") };
  const sb = createAdminClient();
  const { data, error } = await sb
    .from("documents")
    .update({
      title: p.data.title,
      kind: p.data.kind,
      expires_at: p.data.expiresAt,
      ...scopeColumns(p.data.scope, p.data.targetId),
      updated_by: me.id,
    })
    .eq("id", id)
    .eq("org_id", me.orgId)
    .select("id");
  if (error) {
    logError("updateDocumentMeta", error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  if (!data?.length) return { ok: false, error: t("editPeople.errors.notFound") };
  await writeAudit(me, "document.update", "documents", id, { kind: p.data.kind, scope: p.data.scope, expires_at: p.data.expiresAt });
  revalidatePath("/admin/documents");
  return { ok: true, message: t("editPeople.saved") };
}

/** Admin: replace a document's file, keeping its metadata and id. */
export async function replaceDocumentFile(formData: FormData): Promise<PeopleResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const id = String(formData.get("id") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: t("editPeople.documents.chooseFile") };
  if (file.size > MAX_DOCUMENT_BYTES) return { ok: false, error: t("editPeople.documents.tooLarge") };
  const sb = createAdminClient();
  const { data: doc } = await sb.from("documents").select("id,storage_path").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!doc) return { ok: false, error: t("editPeople.errors.notFound") };

  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
  const path = `${me.orgId}/${crypto.randomUUID()}-${safeName}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const up = await sb.storage.from(BUCKET).upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: false });
  if (up.error) {
    logError("replaceDocumentFile.storage", up.error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  const { error } = await sb
    .from("documents")
    .update({ storage_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size, updated_by: me.id })
    .eq("id", id)
    .eq("org_id", me.orgId);
  if (error) {
    logError("replaceDocumentFile.row", error);
    await sb.storage.from(BUCKET).remove([path]);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  if (doc.storage_path && doc.storage_path.startsWith(`${me.orgId}/`)) {
    const rm = await sb.storage.from(BUCKET).remove([doc.storage_path]);
    if (rm.error) logError("replaceDocumentFile.removeOld", rm.error);
  }
  await writeAudit(me, "document.replace_file", "documents", id, { size_bytes: file.size, mime_type: file.type || null });
  revalidatePath("/admin/documents");
  return { ok: true, message: t("editPeople.documents.replaced") };
}

/** Mint a short-lived signed URL — authorization piggybacks on documents RLS. */
export async function getDocumentUrl(id: string): Promise<ActionResult<{ url: string }>> {
  const session = await createClient();
  const { data: doc } = await session.from("documents").select("storage_path").eq("id", id).maybeSingle();
  if (!doc?.storage_path) return { ok: false, error: "Not found or not permitted" };
  const sb = createAdminClient();
  const signed = await sb.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60);
  if (signed.error || !signed.data) return { ok: false, error: "Could not generate link" };
  return { ok: true, data: { url: signed.data.signedUrl } };
}
