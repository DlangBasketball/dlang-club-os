"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";
import { SITE_URL } from "@/lib/constants";
import type { AppRole } from "@/lib/auth/roles";

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
  if (!me || !me.roles.includes("admin")) {
    return { ok: false, error: "Only admins can invite users." };
  }

  const supabase = await createClient();
  const { error: insertError } = await supabase.from("invitations").insert({
    org_id: me.orgId,
    email: input.email,
    role: input.role,
    family_id: input.familyId ?? null,
    coach_id: input.coachId ?? null,
    relation: input.relation ?? null,
    invited_by: me.id,
  });
  if (insertError) return { ok: false, error: insertError.message };

  const admin = createAdminClient();
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
    const { data: list } = await admin.auth.admin.listUsers();
    const existing = list?.users.find(
      (u) => u.email?.toLowerCase() === input.email.toLowerCase(),
    );
    if (!existing) return { ok: false, error: inviteError.message };

    if (input.familyId) {
      await admin.from("family_members").upsert({
        family_id: input.familyId,
        profile_id: existing.id,
        relation: input.relation ?? "guardian",
      });
    }
    if (input.role !== "parent") {
      await admin
        .from("staff_roles")
        .upsert({ org_id: me.orgId!, profile_id: existing.id, role: input.role });
    }
    if (input.coachId) {
      await admin
        .from("coaches")
        .update({ profile_id: existing.id })
        .eq("id", input.coachId);
    }
    await admin
      .from("invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_by: existing.id })
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
