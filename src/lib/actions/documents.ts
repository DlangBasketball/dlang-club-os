"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";

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

  const sb = createAdminClient();
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${me.orgId}/${crypto.randomUUID()}-${safeName}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const up = await sb.storage.from(BUCKET).upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: false });
  if (up.error) return { ok: false, error: `Upload failed: ${up.error.message}` };

  const row: Record<string, unknown> = { org_id: me.orgId, kind, storage_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size, title, uploaded_by: me.id, athlete_id: null, family_id: null, program_id: null };
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
  revalidatePath("/admin/documents");
  return { ok: true };
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
