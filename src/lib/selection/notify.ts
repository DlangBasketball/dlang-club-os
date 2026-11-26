import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { getStandaloneI18n } from "@/lib/i18n/messages";
import { brandedMessage } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/resend";
import { getOrgAlertRecipients } from "@/lib/data/org-alert-recipients";
import { recipients } from "@/lib/plans/notify";
import { pushOnly } from "@/lib/family/notify";
import { logError } from "@/lib/log";
import { selectionAdminDb } from "./db";

/**
 * Family notices for selection programme applications: one in-app
 * notification + Web Push (if opted in) per guardian and an email in the
 * guardian's language, in the club's branded shell. Only the programme name,
 * the child's first name, the decision and the coach's message are included
 * (no medical or contact data). Never throws.
 */
export type SelectionNoticeKind = "applied" | "under_review" | "accepted" | "waitlisted" | "declined" | "enrolled" | "withdrawn";

export async function notifySelection(orgId: string, applicationId: string, kind: SelectionNoticeKind): Promise<number> {
  let sent = 0;
  try {
    const admin = createAdminClient();
    const { data: app } = await selectionAdminDb().from("program_applications")
      .select("id,org_id,family_id,program_id,athlete_id,decision_note,invoice_id")
      .eq("id", applicationId).eq("org_id", orgId).maybeSingle();
    const a = app as { id: string; family_id: string; program_id: string; athlete_id: string; decision_note: string | null; invoice_id: string | null } | null;
    if (!a) return 0;
    const [{ data: prog }, { data: ath }] = await Promise.all([
      admin.from("programs").select("name").eq("id", a.program_id).eq("org_id", orgId).maybeSingle(),
      admin.from("athletes").select("first_name").eq("id", a.athlete_id).eq("org_id", orgId).maybeSingle(),
    ]);
    const path = `/parent/programmes/${a.program_id}`;
    for (const r of await recipients(orgId, a.family_id)) {
      const org = await getOrgEmailContext(orgId, r.locale);
      const { t } = getStandaloneI18n({ locale: r.locale ?? undefined, currency: org.brand.currency ?? null, timeZone: org.f.timeZone });
      const params = { program: prog?.name ?? "", child: ath?.first_name ?? "", club: org.clubName ?? "" };
      const title = t.dynamic(`selection.email.${kind}.subject`, params);
      const intro = t.dynamic(`selection.email.${kind}.intro`, params);
      const msg = brandedMessage({
        ...org.brand, title, intro,
        rows: a.decision_note && (kind === "accepted" || kind === "declined" || kind === "waitlisted")
          ? [{ label: t("selection.email.message"), value: a.decision_note }] : [],
        cta: { label: t.dynamic(`selection.email.${kind}.cta`, params, t("selection.email.open")), url: org.link(path) },
        footer: t("selection.email.footer"),
      });
      if (r.profileId) {
        await admin.from("notifications").insert({ org_id: orgId, recipient_id: r.profileId, type: "registration", title, body: intro, link: path });
        await pushOnly({ orgId, profileIds: [r.profileId], category: "announcements", title, body: intro, path, tag: `selection-${a.id}` });
      }
      const res = await sendEmail({ to: r.email, subject: msg.subject, html: msg.html, fromName: org.senderName ?? org.clubName });
      if (res.ok) sent += 1;
    }
  } catch (e) {
    logError("selection.notify", e);
  }
  return sent;
}

/** New application: the club's alert recipients (staff only) and the programme's coaches in-app. Never throws. */
export async function notifyStaffNewApplication(orgId: string, programId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: prog } = await admin.from("programs").select("name").eq("id", programId).eq("org_id", orgId).maybeSingle();
    const org = await getOrgEmailContext(orgId);
    const { t } = getStandaloneI18n({ locale: org.f.locale, currency: org.brand.currency ?? null, timeZone: org.f.timeZone });
    const title = t("selection.email.staffNew.subject", { program: prog?.name ?? "" });
    const intro = t("selection.email.staffNew.intro", { program: prog?.name ?? "" });
    const msg = brandedMessage({ ...org.brand, title, intro, cta: { label: t("selection.email.staffNew.cta"), url: org.link(`/admin/selection/${programId}`) } });
    for (const to of await getOrgAlertRecipients(orgId)) {
      await sendEmail({ to, subject: msg.subject, html: msg.html, fromName: org.senderName ?? org.clubName });
    }
    const { data: pcs } = await selectionAdminDb().from("program_coaches").select("coach_id").eq("program_id", programId).eq("org_id", orgId);
    const coachIds = ((pcs ?? []) as { coach_id: string }[]).map((p) => p.coach_id);
    if (coachIds.length) {
      const { data: coaches } = await admin.from("coaches").select("profile_id").in("id", coachIds).eq("org_id", orgId);
      for (const c of coaches ?? []) {
        if (!c.profile_id) continue;
        await admin.from("notifications").insert({ org_id: orgId, recipient_id: c.profile_id, type: "registration", title, body: intro, link: `/coach/selection/${programId}` });
      }
    }
  } catch (e) {
    logError("selection.notifyStaff", e);
  }
}
