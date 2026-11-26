import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { getStandaloneI18n } from "@/lib/i18n/messages";
import { brandedMessage } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/resend";
import { orgsWithFeature } from "@/lib/upgrades/server";
import { logError } from "@/lib/log";
import { alumniAdminDb } from "./db";

/**
 * Email from the club to an alumnus (or the guardian of a minor), in the
 * club's branded shell and from the club's sender. Reply-To is the staff
 * member who wrote it, so answers reach them directly. The caller has
 * already checked consent and "do not contact". The html is logged in
 * email_logs (audit / retry), like every other club email.
 */
export async function sendAlumniEmail(opts: {
  orgId: string;
  to: string;
  subject: string;
  body: string;
  replyTo: string | null;
  senderName: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const org = await getOrgEmailContext(opts.orgId);
  const { t } = getStandaloneI18n({ locale: org.f.locale, currency: org.brand.currency ?? null, timeZone: org.f.timeZone });
  const msg = brandedMessage({
    ...org.brand,
    title: opts.subject,
    intro: opts.body,
    footer: opts.senderName ? t("alumni.email.signature", { name: opts.senderName, club: org.clubName ?? "" }) : null,
  });
  // Keep the writer's line breaks (the shared template renders the intro as one paragraph).
  msg.html = msg.html.replace(/(<p style="[^"]*)(">)/, "$1;white-space:pre-line$2");
  const { data: logRow } = await admin.from("email_logs")
    .insert({ org_id: opts.orgId, recipient_id: null, to_email: opts.to, subject: msg.subject, template: "alumni_message", html: msg.html, status: "queued", attempts: 0 })
    .select("id").single();
  const res = await sendEmail({ to: opts.to, subject: msg.subject, html: msg.html, replyTo: opts.replyTo ?? undefined, fromName: org.senderName ?? org.clubName });
  const logId = (logRow as { id: string } | null)?.id;
  if (logId) {
    await admin.from("email_logs").update({
      status: res.ok ? "sent" : "failed", attempts: 1, error: res.ok ? null : res.error ?? "unknown",
      sent_at: res.ok ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
    }).eq("id", logId);
  }
  return res;
}

/**
 * Daily: remind the staff member who logged a contact that its follow-up is
 * due (in-app notification + email in their language). Each follow-up is
 * notified once (follow_up_notified_at); changing the date re-arms it. Only
 * clubs with the alumni_network feature, only authors who still have access
 * (admin, or coach with alumni access) in that club. Names only, no contact
 * details in the notice. Never throws.
 */
export async function runAlumniFollowUps(today = new Date().toISOString().slice(0, 10)): Promise<{ notified: number }> {
  let notified = 0;
  try {
    const orgs = await orgsWithFeature("alumni_network");
    if (!orgs.ids.length) return { notified };
    const db = alumniAdminDb();
    const { data: due } = await db.from("alumni_contacts")
      .select("id,org_id,alumni_id,by_user,follow_up_on,summary")
      .lte("follow_up_on", today).eq("follow_up_done", false).is("follow_up_notified_at", null)
      .in("org_id", orgs.ids).limit(500);
    const admin = createAdminClient();
    for (const c of (due ?? []) as { id: string; org_id: string; alumni_id: string; by_user: string | null; follow_up_on: string; summary: string }[]) {
      await db.from("alumni_contacts").update({ follow_up_notified_at: new Date().toISOString() }).eq("id", c.id).eq("org_id", c.org_id);
      if (!c.by_user) continue;
      const [{ data: prof }, { data: roles }, { data: coach }, { data: person }] = await Promise.all([
        admin.from("profiles").select("email,locale,locale_set_at,org_id").eq("id", c.by_user).maybeSingle(),
        admin.from("staff_roles").select("role").eq("profile_id", c.by_user).eq("org_id", c.org_id),
        db.from("coaches").select("alumni_access,is_active").eq("profile_id", c.by_user).eq("org_id", c.org_id).maybeSingle(),
        db.from("alumni").select("first_name,last_name").eq("id", c.alumni_id).eq("org_id", c.org_id).maybeSingle(),
      ]);
      const r = new Set(((roles ?? []) as { role: string }[]).map((x) => x.role));
      const isAdmin = r.has("admin");
      const coachOk = r.has("coach") && Boolean((coach as { alumni_access?: boolean; is_active?: boolean } | null)?.alumni_access && (coach as { is_active?: boolean }).is_active);
      if (!prof || !person || (!isAdmin && !coachOk)) continue;
      const p = prof as { email: string; locale: string | null; locale_set_at?: string | null };
      const org = await getOrgEmailContext(c.org_id, p.locale_set_at ? p.locale : null);
      const { t } = getStandaloneI18n({ locale: org.f.locale, currency: org.brand.currency ?? null, timeZone: org.f.timeZone });
      const path = `${isAdmin ? "/admin/alumni" : "/coach/alumni"}/${c.alumni_id}`;
      const name = `${person.first_name} ${person.last_name}`;
      const title = t("alumni.followUp.subject", { name });
      const intro = t("alumni.followUp.intro", { name, date: org.f.date(c.follow_up_on) });
      await admin.from("notifications").insert({ org_id: c.org_id, recipient_id: c.by_user, type: "system", title, body: intro, link: path });
      const msg = brandedMessage({ ...org.brand, title, intro, cta: { label: t("alumni.followUp.cta"), url: org.link(path) } });
      await sendEmail({ to: p.email, subject: msg.subject, html: msg.html, fromName: org.senderName ?? org.clubName });
      notified += 1;
    }
  } catch (e) {
    logError("alumni.followUps", e);
  }
  return { notified };
}
