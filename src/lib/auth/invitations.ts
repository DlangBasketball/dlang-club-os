"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";
import { SITE_URL } from "@/lib/constants";
import type { AppRole } from "@/lib/auth/roles";
import type { FamilyClient } from "@/lib/family/db";

export type InviteInput = {
  email: string;
  role: AppRole;
  familyId?: string | null;
  coachId?: string | null;
  relation?: string | null;
};

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Admin invites a user. Flow:
 *  1) Record the invitation (RLS allows admins only) — this is what the
 *     handle_new_user trigger reads to auto-link the user on first sign-in.
 *  2) Send the Supabase invite email via the service role.
 * If the email already has an account, we link them directly instead.
 */
export async function inviteUser(input: InviteInput): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!me || !me.orgId || !me.roles.includes("admin")) {
    return { ok: false, error: "Only admins can invite users." };
  }
  const orgId = me.orgId;

  // Linked records must belong to the inviting club: never trust ids from the
  // client (the DB trigger trg_invitations_same_org enforces the same rule).
  const admin = createAdminClient();
  if (input.familyId) {
    const { data: fam } = await admin
      .from("families")
      .select("id")
      .eq("id", input.familyId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!fam) return { ok: false, error: "Family not found." };
  }
  if (input.coachId) {
    const { data: coach } = await admin
      .from("coaches")
      .select("id")
      .eq("id", input.coachId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!coach) return { ok: false, error: "Coach not found." };
  }

  const supabase = await createClient();
  const { error: insertError } = await supabase.from("invitations").insert({
    org_id: orgId,
    email: input.email,
    role: input.role,
    family_id: input.familyId ?? null,
    coach_id: input.coachId ?? null,
    relation: input.relation ?? null,
    invited_by: me.id,
  });
  if (insertError) return { ok: false, error: insertError.message };

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    input.email,
    {
      redirectTo: `${SITE_URL}/auth/callback?next=/onboarding`,
      data: { invited_role: input.role },
    },
  );

  // If the user already exists, the invite email errors. The invitation row
  // is in place; link an existing user immediately so they're ready on login.
  if (inviteError) {
    // listUsers() returns one page (50 accounts): on a platform with more
    // users an existing account was "not found" and the invitation failed.
    // The profile row carries the account id and e-mail.
    const existing = await findAccountByEmail(admin, input.email);
    if (!existing) return { ok: false, error: inviteError.message };

    // An existing account may only be linked when it belongs to this club or
    // to no club yet. A member of another club is never given roles here:
    // roles and family links in a foreign org would be a tenant hop.
    const { data: profile } = await admin
      .from("profiles")
      .select("org_id")
      .eq("id", existing.id)
      .maybeSingle();
    // A member of another club gets a MEMBERSHIP in this club (one login,
    // several clubs). Roles and family links are created in this club only,
    // by consume_invitation(); their current club does not change.
    if (profile?.org_id && profile.org_id !== orgId) {
      const { data: inv } = await admin
        .from("invitations")
        .select("id")
        .eq("org_id", orgId)
        .eq("email", input.email)
        .eq("status", "pending")
        .maybeSingle();
      if (!inv) return { ok: false, error: "Invitation not found." };
      const famDb = admin as unknown as FamilyClient;
      const { data: linked, error: linkErr } = await famDb.rpc("consume_invitation", { p_inv: inv.id, p_profile: existing.id });
      if (linkErr || !linked) return { ok: false, error: linkErr?.message ?? "Invitation could not be linked." };
      revalidatePath("/admin/invitations");
      return { ok: true };
    }
    if (profile && !profile.org_id) {
      const { error: homeError } = await admin
        .from("profiles")
        .update({ org_id: orgId })
        .eq("id", existing.id)
        .is("org_id", null);
      if (homeError) return { ok: false, error: homeError.message };
    }

    if (input.familyId) {
      const { error: famErr } = await admin.from("family_members").upsert(
        { family_id: input.familyId, profile_id: existing.id, relation: input.relation ?? "guardian" },
        { onConflict: "family_id,profile_id", ignoreDuplicates: true },
      );
      if (famErr) return { ok: false, error: famErr.message };
    }
    if (input.role !== "parent") {
      // Unique (org_id, profile_id, role): re-inviting someone who already
      // holds the role is a no-op, not an error.
      const { error: roleErr } = await admin
        .from("staff_roles")
        .upsert({ org_id: orgId, profile_id: existing.id, role: input.role }, { onConflict: "org_id,profile_id,role", ignoreDuplicates: true });
      if (roleErr) return { ok: false, error: roleErr.message };
    }
    if (input.coachId) {
      const { error: coachErr } = await admin
        .from("coaches")
        .update({ profile_id: existing.id })
        .eq("id", input.coachId)
        .eq("org_id", orgId);
      if (coachErr) return { ok: false, error: coachErr.message };
    }
    await admin
      .from("invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_by: existing.id })
      .eq("org_id", orgId)
      .eq("email", input.email)
      .eq("status", "pending");
  }

  revalidatePath("/admin/invitations");
  return { ok: true };
}

/** Admin revokes a still-pending invitation. */
export async function revokeInvitation(id: string): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!me || !me.roles.includes("admin")) {
    return { ok: false, error: "Only admins can revoke invitations." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", id)
    .eq("status", "pending");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/invitations");
  return { ok: true };
}

/**
 * The auth account of an e-mail address: its profile row (same id), else a
 * paged search of the auth users (an account whose profile is missing).
 */
async function findAccountByEmail(admin: ReturnType<typeof createAdminClient>, email: string): Promise<{ id: string } | null> {
  const wanted = email.trim().toLowerCase();
  const { data: profs } = await admin.from("profiles").select("id,email").ilike("email", wanted.replace(/[\\%_]/g, (c) => `\\${c}`)).limit(5);
  const hit = (profs ?? []).find((p) => (p.email ?? "").toLowerCase() === wanted);
  if (hit) return { id: hit.id };
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data) return null;
    const u = data.users.find((x) => x.email?.toLowerCase() === wanted);
    if (u) return { id: u.id };
    if (data.users.length < 1000) return null;
  }
  return null;
}
