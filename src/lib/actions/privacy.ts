"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";
import { safeError } from "@/lib/log";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Parent: request erasure of their family's data (admin reviews & executes). */
export async function requestDeletion(reason: string): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!me?.orgId) return { ok: false, error: "Not signed in" };
  const admin = createAdminClient();
  const { data: fm } = await admin.from("family_members").select("family_id").eq("profile_id", me.id).limit(1).maybeSingle();
  if (!fm?.family_id) return { ok: false, error: "No family on record" };
  try {
    const { error } = await admin.from("deletion_requests").insert({ org_id: me.orgId, family_id: fm.family_id, requested_by: me.id, reason: reason.slice(0, 1000) });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/parent/account");
    return { ok: true };
  } catch (e) { return { ok: false, error: safeError("requestDeletion", e) }; }
}

/** Admin: approve (anonymise + complete) or reject a deletion request. */
export async function processDeletionRequest(id: string, approve: boolean): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return { ok: false, error: "Admins only" };
  const admin = createAdminClient();
  const { data: req } = await admin.from("deletion_requests").select("family_id,status").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!req) return { ok: false, error: "Request not found" };
  if (req.status !== "pending") return { ok: false, error: "Already processed" };
  try {
    if (approve) {
      const { error: rpcErr } = await admin.rpc("anonymise_family", { p_family: req.family_id });
      if (rpcErr) return { ok: false, error: rpcErr.message };
      await admin.from("deletion_requests").update({ status: "completed", reviewed_by: me.id, reviewed_at: new Date().toISOString(), completed_at: new Date().toISOString() }).eq("id", id);
      await admin.from("audit_logs").insert({ org_id: me.orgId, actor_id: me.id, action: "privacy.erasure_completed", target_table: "families", target_id: req.family_id, new_data: { request_id: id } });
    } else {
      await admin.from("deletion_requests").update({ status: "rejected", reviewed_by: me.id, reviewed_at: new Date().toISOString() }).eq("id", id);
    }
    revalidatePath("/admin/settings/privacy");
    return { ok: true };
  } catch (e) { return { ok: false, error: safeError("processDeletionRequest", e) }; }
}

/** Parent: GDPR/FADP data-portability export of their own family's records. */
export async function exportMyData(): Promise<ActionResult<{ json: string }>> {
  const me = await getSessionUser();
  if (!me?.orgId) return { ok: false, error: "Not signed in" };
  const session = await createClient(); // RLS-scoped: parent only ever reads their own family
  const [family, athletes, registrations, invoices, consents, documents] = await Promise.all([
    session.from("families").select("*"),
    session.from("athletes").select("id,first_name,last_name,dob,status"),
    session.from("registrations").select("id,program_id,status,created_at"),
    session.from("invoices").select("number,total_chf,status,due_date,issued_at"),
    session.from("consent_acceptances").select("consent_form_id,accepted_version,accepted_at,status,ip_address"),
    session.from("documents").select("file_name,kind,created_at"),
  ]);
  const payload = { exportedAt: new Date().toISOString(), subject: { id: me.id, email: me.email }, family: family.data, athletes: athletes.data, registrations: registrations.data, invoices: invoices.data, consents: consents.data, documents: documents.data };
  return { ok: true, data: { json: JSON.stringify(payload, null, 2) } };
}

/** Parent or admin: lawfully withdraw a consent (immutable record keeps its snapshot). */
export async function withdrawConsent(acceptanceId: string): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: "Not signed in" };
  const session = await createClient();
  const { error } = await session.rpc("withdraw_consent", { p_id: acceptanceId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/parent/documents");
  return { ok: true };
}
