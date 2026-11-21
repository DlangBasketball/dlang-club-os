"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";
import { logError, safeError } from "@/lib/log";
import type { FamilyClient } from "@/lib/family/db";
import { finishErase } from "@/lib/people/erase-cleanup";
import { revalidatePersonEverywhere } from "@/lib/people/revalidate";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Parent: request erasure of their family's data (admin reviews & executes). */
export async function requestDeletion(reason: string): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!me?.orgId) return { ok: false, error: "Not signed in" };
  const admin = createAdminClient();
  // A family of the CURRENT club (a person may be a guardian in several clubs).
  const { data: links } = await admin.from("family_members").select("family_id").eq("profile_id", me.id);
  const ids = (links ?? []).map((l) => l.family_id);
  const { data: fam } = ids.length ? await admin.from("families").select("id").in("id", ids).eq("org_id", me.orgId).limit(1).maybeSingle() : { data: null };
  const fm = fam ? { family_id: fam.id } : null;
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
      // The shared "remove a person everywhere" erase (session client: it
      // checks is_admin() and the family's org against the signed-in user).
      // Rosters, registrations, bookings and personal records go; accounting
      // records stay, anonymised. Already erased: just complete the request.
      const session = await createClient();
      const { data: erased, error: rpcErr } = await session.rpc("delete_family", { p_family: req.family_id, p_mode: "erase" });
      if (rpcErr && !rpcErr.message.includes("ALREADY_DELETED")) {
        logError("processDeletionRequest.erase", rpcErr);
        return { ok: false, error: rpcErr.message };
      }
      if (!rpcErr) await finishErase(erased as { files?: unknown; auth_user_ids?: unknown }, admin);
      revalidatePersonEverywhere(me.orgId);
      await admin.from("deletion_requests").update({ status: "completed", reviewed_by: me.id, reviewed_at: new Date().toISOString(), completed_at: new Date().toISOString() }).eq("id", id);
      // The linked rights request (filed from the parent app) is answered too.
      await (admin as unknown as FamilyClient).from("dsar_requests").update({ status: "completed", handled_by: me.id, response_summary: "erasure completed" } as never).eq("org_id", me.orgId).eq("deletion_request_id", id);
      await admin.from("audit_logs").insert({ org_id: me.orgId, actor_id: me.id, action: "privacy.erasure_completed", target_table: "families", target_id: req.family_id, new_data: { request_id: id } });
    } else {
      await admin.from("deletion_requests").update({ status: "rejected", reviewed_by: me.id, reviewed_at: new Date().toISOString() }).eq("id", id);
      await (admin as unknown as FamilyClient).from("dsar_requests").update({ status: "rejected", handled_by: me.id, rejection_reason: "rejected by the club" } as never).eq("org_id", me.orgId).eq("deletion_request_id", id);
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
  // Everything RLS lets the guardian see about themselves and their children
  // (GDPR Art. 15/20, nFADP Art. 25), health data included.
  const [profile, family, athletes, medical, registrations, invoices, consents, documents, attendance, bookings] = await Promise.all([
    session.from("profiles").select("*").eq("id", me.id),
    session.from("families").select("*"),
    session.from("athletes").select("*"),
    session.from("athlete_medical").select("*"),
    session.from("registrations").select("*"),
    session.from("invoices").select("*"),
    session.from("consent_acceptances").select("*"),
    session.from("documents").select("*"),
    session.from("attendance_marks").select("*"),
    session.from("training_bookings").select("*"),
  ]);
  const payload = {
    exportedAt: new Date().toISOString(),
    subject: { id: me.id, email: me.email },
    profile: profile.data?.[0] ?? null,
    family: family.data,
    athletes: athletes.data,
    medical: medical.data,
    registrations: registrations.data,
    invoices: invoices.data,
    consents: consents.data,
    documents: documents.data,
    attendance: attendance.data,
    bookings: bookings.data,
  };
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
