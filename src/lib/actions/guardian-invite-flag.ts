"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { inviteUser } from "@/lib/auth/invitations";
import { getTranslations } from "@/lib/i18n/server";
import { logError } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

export type InviteFlagResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * One-click "Invite a guardian" on a NO_GUARDIAN_LOGIN suggestion (migration
 * 20250420106300): staff-created athletes without a guardian login are
 * expected; the suggestion invites the family's contact e-mail through the
 * existing invitation flow (role parent, linked to the athlete's family).
 * Admins only; the flag, athlete and family are all read in the caller's club
 * (never from client ids beyond the flag id). The flag stays open (marked
 * invited) and resolves itself once the guardian signs in.
 */
export async function inviteGuardianForFlag(flagId: string): Promise<InviteFlagResult> {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId || !me.roles.includes("admin")) return { ok: false, error: t("adminAttendance.review.invite.forbidden") };
  if (!z.string().uuid().safeParse(flagId).success) return { ok: false, error: t("adminAttendance.review.invite.notFound") };
  const admin = createAdminClient();
  const { data: flag } = await admin.from("data_review_flags").select("id,entity_id,details,resolved_at")
    .eq("id", flagId).eq("org_id", me.orgId).eq("reason_code", "NO_GUARDIAN_LOGIN").maybeSingle();
  if (!flag || flag.resolved_at || !flag.entity_id) return { ok: false, error: t("adminAttendance.review.invite.notFound") };
  const { data: ath } = await admin.from("athletes").select("family_id").eq("id", flag.entity_id).eq("org_id", me.orgId).maybeSingle();
  if (!ath) return { ok: false, error: t("adminAttendance.review.invite.notFound") };
  const { data: fam } = await admin.from("families").select("id,contact_email").eq("id", ath.family_id).eq("org_id", me.orgId).maybeSingle();
  const email = (fam?.contact_email ?? "").trim().toLowerCase();
  if (!fam || !z.string().email().safeParse(email).success) return { ok: false, error: t("adminAttendance.review.invite.noEmail") };

  const res = await inviteUser({ email, role: "parent", familyId: fam.id, relation: "guardian" });
  if (!res.ok) {
    logError("dataReview.inviteGuardian", res.error);
    return { ok: false, error: t("adminAttendance.review.invite.failed") };
  }
  const details = { ...((flag.details ?? {}) as Record<string, unknown>), invited_at: new Date().toISOString(), invited_by: me.id };
  await admin.from("data_review_flags").update({ details } as never).eq("id", flag.id).eq("org_id", me.orgId);
  revalidatePath("/admin/data-review");
  return { ok: true, message: t("adminAttendance.review.invite.sent") };
}
