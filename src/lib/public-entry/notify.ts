import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchNotification } from "@/lib/notifications/dispatch";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { emailTranslator } from "@/lib/email/templates";
import { logError } from "@/lib/log";
import { entryAdminDb } from "./db";

/**
 * Guardian consent notices through the existing dispatch (logged e-mail +
 * in-app row where the recipient has a login), each in the recipient's
 * language. Data minimisation: the guardian hears the participant's first
 * name, the activity, dates and the booker's NAME (never their contact
 * details); the booker hears only the name they typed and the outcome.
 * Staging: EMAIL_TEST_REDIRECT applies in sendEmail(). Never throws.
 */

type Req = {
  id: string; org_id: string; athlete_id: string; booker_profile_id: string; guardian_name: string; guardian_email: string;
  existing_child: boolean; expires_at: string | null; status: string; registration_ids: string[]; booking_ids: string[];
};

async function loadRequest(orgId: string, requestId: string): Promise<Req | null> {
  const { data } = await entryAdminDb().from("guardian_consent_requests")
    .select("id,org_id,athlete_id,booker_profile_id,guardian_name,guardian_email,existing_child,expires_at,status,registration_ids,booking_ids")
    .eq("id", requestId).eq("org_id", orgId).maybeSingle();
  return (data as Req | null) ?? null;
}

/** Activity names + dates of the held items, formatted for the recipient. */
async function describeItems(r: Req, locale: string | null): Promise<{ activity: string; when: string }> {
  const admin = createAdminClient();
  const { f } = await getOrgEmailContext(r.org_id, locale);
  const names: string[] = [];
  const dates: string[] = [];
  if (r.registration_ids.length) {
    const { data } = await admin.from("registrations").select("program_id,camp_edition_id").eq("org_id", r.org_id).in("id", r.registration_ids);
    for (const g of (data ?? []) as unknown as { program_id: string; camp_edition_id: string | null }[]) {
      const [{ data: p }, { data: e }] = await Promise.all([
        admin.from("programs").select("name").eq("id", g.program_id).eq("org_id", r.org_id).maybeSingle(),
        g.camp_edition_id ? admin.from("camp_editions").select("starts_on,ends_on").eq("id", g.camp_edition_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (p) names.push((p as { name: string }).name);
      const ed = e as { starts_on: string; ends_on: string } | null;
      if (ed) dates.push(f.dateRange(ed.starts_on, ed.ends_on));
    }
  }
  if (r.booking_ids.length) {
    const { data } = await admin.from("training_bookings").select("service_id,slot_start").eq("org_id", r.org_id).in("id", r.booking_ids);
    for (const b of (data ?? []) as { service_id: string; slot_start: string | null }[]) {
      const { data: s } = await admin.from("training_services").select("name").eq("id", b.service_id).maybeSingle();
      if (s) names.push((s as { name: string }).name);
      if (b.slot_start) dates.push(f.dateTime(b.slot_start));
    }
  }
  return { activity: Array.from(new Set(names)).join(", "), when: dates.join(", ") };
}

async function firstName(orgId: string, athleteId: string): Promise<string> {
  const { data } = await createAdminClient().from("athletes").select("first_name").eq("id", athleteId).eq("org_id", orgId).maybeSingle();
  return (data as { first_name: string } | null)?.first_name ?? "";
}

async function profile(id: string): Promise<{ full_name: string | null; email: string | null; locale: string | null } | null> {
  const { data } = await createAdminClient().from("profiles").select("full_name,email,locale,locale_set_at").eq("id", id).maybeSingle();
  const p = data as { full_name: string | null; email: string | null; locale: string | null; locale_set_at: string | null } | null;
  return p ? { full_name: p.full_name, email: p.email, locale: p.locale_set_at ? p.locale : null } : null;
}

/**
 * The consent request e-mail with the one-time link. A new child: to the
 * guardian e-mail the booker typed (e-mail only: the address is not linked to
 * any account). A child who already existed in the club: to that child's
 * existing guardians only (their own accounts, e-mail + in-app).
 */
export async function sendConsentRequest(orgId: string, requestId: string, token: string): Promise<void> {
  try {
    const r = await loadRequest(orgId, requestId);
    if (!r || r.status !== "pending") return;
    const [child, booker] = await Promise.all([firstName(orgId, r.athlete_id), profile(r.booker_profile_id)]);
    const path = `/consent/${encodeURIComponent(token)}`;
    if (!r.existing_child) {
      const { activity, when } = await describeItems(r, null);
      await dispatchNotification({
        orgId, type: "guardian_consent_request", recipientProfileId: null, toEmail: r.guardian_email,
        vars: { parent_name: r.guardian_name, athlete_name: child, booker_name: booker?.full_name ?? "", program_name: activity, when,
                expires_at: r.expires_at ?? undefined, portal_path: path },
      });
      return;
    }
    const admin = createAdminClient();
    const { data: a } = await admin.from("athletes").select("family_id").eq("id", r.athlete_id).eq("org_id", orgId).maybeSingle();
    const familyId = (a as { family_id: string } | null)?.family_id;
    if (!familyId) return;
    const { data: members } = await admin.from("family_members").select("profile_id,receives_emails").eq("family_id", familyId);
    for (const m of (members ?? []) as unknown as { profile_id: string; receives_emails: boolean | null }[]) {
      if (m.receives_emails === false || m.profile_id === r.booker_profile_id) continue;
      const p = await profile(m.profile_id);
      if (!p) continue;
      const { activity, when } = await describeItems(r, p.locale);
      await dispatchNotification({
        orgId, type: "guardian_consent_request", recipientProfileId: m.profile_id, toEmail: p.email,
        vars: { parent_name: p.full_name ?? "", athlete_name: child, booker_name: booker?.full_name ?? "", program_name: activity, when,
                expires_at: r.expires_at ?? undefined, portal_path: path },
      });
    }
  } catch (e) {
    logError("publicEntry.notify.request", e);
  }
}

/**
 * Outcome notices: accepted / declined / expired to the booker (in-app +
 * e-mail, the name they typed only); expired also to the guardian e-mail.
 */
export async function notifyConsentOutcome(orgId: string, requestId: string): Promise<void> {
  try {
    const r = await loadRequest(orgId, requestId);
    if (!r || !["accepted", "declined", "expired"].includes(r.status)) return;
    const { data: pb } = await entryAdminDb().from("participant_bookers").select("display_name")
      .eq("athlete_id", r.athlete_id).eq("profile_id", r.booker_profile_id).eq("org_id", orgId).maybeSingle();
    const name = (pb as { display_name: string } | null)?.display_name ?? "";
    const b = await profile(r.booker_profile_id);
    if (b) {
      const org = await getOrgEmailContext(orgId, b.locale);
      const t = emailTranslator(org.brand);
      const { activity } = await describeItems(r, b.locale);
      const k = r.status as "accepted" | "declined" | "expired";
      await dispatchNotification({
        orgId, type: "announcement", recipientProfileId: r.booker_profile_id, toEmail: b.email,
        vars: { title: t(`consentRequest.notify.${k}Title`), message: t(`consentRequest.notify.${k}Body`, { name, activity }) },
      });
    }
    if (r.status === "expired" && !r.existing_child) {
      const org = await getOrgEmailContext(orgId, null);
      const t = emailTranslator(org.brand);
      const { activity } = await describeItems(r, null);
      await dispatchNotification({
        orgId, type: "announcement", recipientProfileId: null, toEmail: r.guardian_email,
        vars: { parent_name: r.guardian_name, title: t("consentRequest.notify.guardianExpiredTitle"),
                message: t("consentRequest.notify.guardianExpiredBody", { activity }) },
      });
    }
    if (r.status !== "accepted") await entryAdminDb().rpc("guardian_consent_mark_notified", { p_request: r.id });
  } catch (e) {
    logError("publicEntry.notify.outcome", e);
  }
}

/** Scheduled job: expire due holds everywhere, then send the pending outcome notices. */
export async function runConsentExpiry(): Promise<{ expired: number; notified: number }> {
  const { data, error } = await entryAdminDb().rpc("guardian_consent_expire", {});
  if (error) {
    logError("publicEntry.expire", error);
    return { expired: 0, notified: 0 };
  }
  const res = (data ?? {}) as { expired?: number; to_notify?: { id: string; org_id: string }[] };
  let notified = 0;
  for (const x of res.to_notify ?? []) {
    await notifyConsentOutcome(x.org_id, x.id);
    notified += 1;
  }
  return { expired: Number(res.expired ?? 0), notified };
}
