import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchNotification } from "@/lib/notifications/dispatch";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { emailTranslator } from "@/lib/email/templates";
import { logError } from "@/lib/log";
import { participantsAdminDb } from "./db";

/**
 * Relative invitation and carer-consent notices through the existing dispatch
 * (logged e-mail; EMAIL_TEST_REDIRECT applies on staging). Data minimisation:
 * the invitee hears the child's FIRST name, the relation and the inviter's
 * name only; the family hears who consented (name + relation) and the
 * activity. Service role, always filtered by org. Never throws.
 */

type Invite = { id: string; org_id: string; athlete_id: string; invited_by: string | null; email: string; relation: string; expires_at: string; status: string };

/** The invitation e-mail with the one-time link (to the invited address only). */
export async function sendRelativeInvitation(orgId: string, invitationId: string, token: string): Promise<boolean> {
  try {
    const db = participantsAdminDb() as unknown as SupabaseClient;
    const { data } = await db.from("athlete_link_invitations").select("id,org_id,athlete_id,invited_by,email,relation,expires_at,status")
      .eq("id", invitationId).eq("org_id", orgId).maybeSingle();
    const i = data as Invite | null;
    if (!i || i.status !== "pending") return false;
    const [{ data: a }, { data: p }] = await Promise.all([
      db.from("athletes").select("first_name").eq("id", i.athlete_id).eq("org_id", orgId).maybeSingle(),
      i.invited_by ? db.from("profiles").select("full_name").eq("id", i.invited_by).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const res = await dispatchNotification({
      orgId, type: "relative_invitation", recipientProfileId: null, toEmail: i.email,
      vars: {
        athlete_name: (a as { first_name: string } | null)?.first_name ?? "",
        booker_name: (p as { full_name: string | null } | null)?.full_name ?? "",
        relation: i.relation, expires_at: i.expires_at,
        portal_path: `/link-invite/${encodeURIComponent(token)}`,
      },
    });
    return res.emailOk;
  } catch (e) {
    logError("participants.invite.notify", e);
    return false;
  }
}

/**
 * A linked relative consented themselves (club setting ON): the child's
 * family guardians who receive e-mails are told who, in which relation, for
 * which activity. Each in their own language.
 */
export async function notifyFamilyOfCarerConsent(orgId: string, athleteId: string, carerProfileId: string, relation: string, activity: string): Promise<void> {
  try {
    const db = participantsAdminDb() as unknown as SupabaseClient;
    const { data: a } = await db.from("athletes").select("family_id,first_name").eq("id", athleteId).eq("org_id", orgId).maybeSingle();
    const ath = a as { family_id: string; first_name: string } | null;
    if (!ath) return;
    const [{ data: members }, { data: carer }] = await Promise.all([
      db.from("family_members").select("profile_id,receives_emails").eq("family_id", ath.family_id),
      db.from("profiles").select("full_name").eq("id", carerProfileId).maybeSingle(),
    ]);
    const name = (carer as { full_name: string | null } | null)?.full_name ?? "";
    for (const m of (members ?? []) as { profile_id: string; receives_emails: boolean | null }[]) {
      if (m.receives_emails === false || m.profile_id === carerProfileId) continue;
      const { data: pr } = await db.from("profiles").select("email,locale,locale_set_at").eq("id", m.profile_id).maybeSingle();
      const prof = pr as { email: string | null; locale: string | null; locale_set_at: string | null } | null;
      const org = await getOrgEmailContext(orgId, prof?.locale_set_at ? prof.locale : null);
      const t = emailTranslator(org.brand);
      const rel = t.dynamic(`participants.childLinks.relations.${relation}`, undefined, relation);
      await dispatchNotification({
        orgId, type: "announcement", recipientProfileId: m.profile_id, toEmail: prof?.email ?? null,
        vars: {
          title: t("participants.carerConsent.notify.title", { child: ath.first_name }),
          message: t("participants.carerConsent.notify.body", { name, relation: rel, child: ath.first_name, activity }),
        },
      });
    }
  } catch (e) {
    logError("participants.carerConsent.notify", e);
  }
}
