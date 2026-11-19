"use server";

import { revalidatePath } from "next/cache";
import { familyAdminDb, familyDb } from "@/lib/family/db";
import { audit, fail, failDb, ok, requireMember, type FamilyResult } from "@/lib/family/action-helpers";
import { billingSplitSchema, inviteGuardianSchema, setPermissionsSchema, uuid, type BillingSplitInput, type InviteGuardianInput, type SetPermissionsInput } from "@/lib/family/validation";
import { validateShares } from "@/lib/family/split";
import { splitOpenInvoicesForFamily } from "@/lib/family/split-runner";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { brandedMessage } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/resend";
import { getStandaloneI18n } from "@/lib/i18n/messages";
import { logError } from "@/lib/log";

function revalidateFamily() {
  revalidatePath("/parent/family");
  revalidatePath("/parent/children");
  revalidatePath("/admin/families");
  revalidatePath("/admin/family-billing");
}

/** The family must be in the caller's current club and the caller its primary guardian (or a club admin). */
async function loadManagedFamily(me: { id: string; orgId: string; roles: string[] }, familyId: string) {
  const db = familyAdminDb();
  const { data: fam } = await db.from("families").select("id,name,org_id").eq("id", familyId).eq("org_id", me.orgId).maybeSingle();
  if (!fam) return null;
  if (me.roles.includes("admin")) return fam;
  const { data: link } = await db.from("family_members").select("is_primary").eq("family_id", familyId).eq("profile_id", me.id).maybeSingle();
  return link?.is_primary ? fam : null;
}

/**
 * Primary guardian invites a second guardian (own login, same children).
 * New people get an account invitation; someone who already has a login
 * (in this or another club) is linked right away and told by email.
 * The chosen permissions are applied when the link is made.
 */
export async function inviteSecondGuardian(input: InviteGuardianInput): Promise<FamilyResult> {
  const me = await requireMember();
  if (!me) return fail("forbidden");
  const p = inviteGuardianSchema.safeParse(input);
  if (!p.success) return fail("invalid");
  const fam = await loadManagedFamily(me, p.data.familyId);
  if (!fam) return fail("NOT_ALLOWED");
  if (p.data.email === (me.email ?? "").toLowerCase()) return fail("selfInvite");

  const db = familyAdminDb();
  // Already a guardian of this family?
  const { data: existingProfile } = await db.from("profiles").select("id").eq("email", p.data.email).maybeSingle();
  if (existingProfile) {
    const { data: already } = await db.from("family_members").select("profile_id").eq("family_id", fam.id).eq("profile_id", existingProfile.id).maybeSingle();
    if (already) return fail("alreadyGuardian");
  }
  const { data: inv, error } = await db
    .from("invitations")
    .insert({
      org_id: me.orgId, email: p.data.email, role: "parent", family_id: fam.id, relation: p.data.relation, invited_by: me.id,
      guardian_permissions: {
        can_pay: p.data.permissions.canPay, can_see_medical: p.data.permissions.canSeeMedical, receives_emails: p.data.permissions.receivesEmails,
      },
    } as never)
    .select("id")
    .single();
  if (error || !inv) {
    if (error?.message.includes("uniq_invitations_pending")) return fail("invitePending");
    return failDb("family.inviteGuardian", error);
  }
  const invId = (inv as { id: string }).id;

  const org = await getOrgEmailContext(me.orgId);
  const redirectTo = `${org.link("/auth/callback")}?next=/parent/home`;
  try {
    if (existingProfile) {
      const { data: linked, error: linkErr } = await db.rpc("consume_invitation", { p_inv: invId, p_profile: existingProfile.id });
      if (linkErr || !linked) return failDb("family.inviteGuardian.link", linkErr);
      const { data: prof } = await db.from("profiles").select("locale,locale_set_at").eq("id", existingProfile.id).maybeSingle();
      const pr = prof as { locale?: string | null; locale_set_at?: string | null } | null;
      const { t } = getStandaloneI18n({ locale: pr?.locale_set_at ? pr.locale : null, timeZone: org.f.timeZone });
      const msg = brandedMessage({
        ...org.brand,
        title: t("family.email.guardianAdded.subject", { club: org.clubName ?? "" }),
        intro: t("family.email.guardianAdded.intro", { name: me.fullName ?? "", club: org.clubName ?? "" }),
        cta: { label: t("family.email.guardianAdded.cta"), url: org.link("/parent/home") },
        footer: t("family.email.footer"),
      });
      await sendEmail({ to: p.data.email, subject: msg.subject, html: msg.html, fromName: org.senderName ?? org.clubName });
    } else {
      const { error: invErr } = await db.auth.admin.inviteUserByEmail(p.data.email, { redirectTo, data: { invited_role: "parent" } });
      if (invErr && !/already/i.test(invErr.message)) logError("family.inviteGuardian.email", invErr);
    }
  } catch (e) {
    logError("family.inviteGuardian", e);
  }
  await audit(me, "family.guardian_invited", "families", fam.id, { invitation_id: invId });
  revalidateFamily();
  return ok("family.messages.inviteSent");
}

/** Primary guardian revokes a pending guardian invitation of their family. */
export async function revokeGuardianInvite(invitationId: string): Promise<FamilyResult> {
  const me = await requireMember();
  if (!me) return fail("forbidden");
  if (!uuid.safeParse(invitationId).success) return fail("invalid");
  const db = familyAdminDb();
  const { data: inv } = await db.from("invitations").select("id,family_id,status").eq("id", invitationId).eq("org_id", me.orgId).maybeSingle();
  const row = inv as { id: string; family_id: string | null; status: string } | null;
  if (!row?.family_id || row.status !== "pending") return fail("NOT_FOUND");
  if (!(await loadManagedFamily(me, row.family_id))) return fail("NOT_ALLOWED");
  const { error } = await db.from("invitations").update({ status: "revoked" }).eq("id", row.id).eq("org_id", me.orgId);
  if (error) return failDb("family.revokeInvite", error);
  await audit(me, "family.guardian_invite_revoked", "invitations", row.id);
  revalidateFamily();
  return ok("family.messages.inviteRevoked");
}

/** Per-guardian permissions (primary guardian or admin; enforced in the database). */
export async function setGuardianPermissions(input: SetPermissionsInput): Promise<FamilyResult> {
  const me = await requireMember();
  if (!me) return fail("forbidden");
  const p = setPermissionsSchema.safeParse(input);
  if (!p.success) return fail("invalid");
  const db = await familyDb();
  const { error } = await db.rpc("set_guardian_permissions", {
    p_family: p.data.familyId, p_profile: p.data.profileId,
    p_can_pay: p.data.canPay, p_can_see_medical: p.data.canSeeMedical, p_receives_emails: p.data.receivesEmails,
  });
  if (error) return failDb("family.setPermissions", error);
  revalidateFamily();
  return ok("family.messages.permissionsSaved");
}

/** Remove a (non-primary) guardian, or leave the family yourself. */
export async function removeGuardian(input: { familyId: string; profileId: string }): Promise<FamilyResult> {
  const me = await requireMember();
  if (!me) return fail("forbidden");
  if (!uuid.safeParse(input.familyId).success || !uuid.safeParse(input.profileId).success) return fail("invalid");
  const db = await familyDb();
  const { error } = await db.rpc("remove_family_guardian", { p_family: input.familyId, p_profile: input.profileId });
  if (error) return failDb("family.removeGuardian", error);
  revalidateFamily();
  return ok("family.messages.guardianRemoved");
}

/** Billing split per family: one payer, or a percentage per guardian (totals 100). */
export async function setBillingSplit(input: BillingSplitInput): Promise<FamilyResult> {
  const me = await requireMember();
  if (!me) return fail("forbidden");
  const p = billingSplitSchema.safeParse(input);
  if (!p.success) return fail("invalid");
  if (p.data.mode === "split") {
    const problem = validateShares(p.data.shares);
    if (problem === "TOTAL") return fail("SHARES_MUST_TOTAL_100");
    if (problem === "TWO_PAYERS") return fail("SPLIT_NEEDS_TWO_PAYERS");
    if (problem) return fail("INVALID_SHARES");
  }
  const shares = Object.fromEntries(p.data.shares.map((s) => [s.profileId, s.pct]));
  const db = await familyDb();
  const { error } = await db.rpc("set_family_billing_split", { p_family: p.data.familyId, p_mode: p.data.mode, p_shares: p.data.mode === "split" ? shares : null });
  if (error) return failDb("family.billingSplit", error);
  revalidateFamily();
  return ok("family.messages.splitSaved");
}

/** Finance: split this family's open, unpaid invoices by the family's split now. */
export async function splitFamilyInvoicesNow(familyId: string): Promise<FamilyResult<{ split: number }>> {
  const me = await requireMember();
  if (!me || !(me.roles.includes("admin") || me.roles.includes("finance"))) return fail("forbidden");
  if (!uuid.safeParse(familyId).success) return fail("invalid");
  const res = await splitOpenInvoicesForFamily(me.orgId, familyId, { session: true });
  await audit(me, "family.split_run", "families", familyId, { split: res.split, skipped: res.skipped });
  revalidateFamily();
  revalidatePath("/admin/invoices");
  return ok("family.messages.invoicesSplit", { split: res.split });
}
